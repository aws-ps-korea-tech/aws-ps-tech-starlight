---
title: "How Task Concurrency Limits Increase Storage Costs in AWS HealthOmics Workflow Runs"
sidebar:
  order: 1
---

When running genomic workflows on AWS HealthOmics, you might use **Run Groups** with `maxCpus` to control task concurrency — for example, to manage costs or share capacity across teams. But there's an important side effect: **limiting concurrency can actually increase your total run cost**, specifically through storage charges.

We ran a controlled experiment to measure this effect and verify the underlying billing mechanics.

## TL;DR

- Throttling a 50-task workflow from full parallelism down to 2 concurrent tasks increased run duration by **5.67x**
- Storage cost increased by **5.67x** ($0.049 → $0.278), tracking duration exactly
- Compute cost stayed flat ($0.220 → $0.217, just -1.2%)
- Total cost increased by **84%** ($0.269 → $0.496)

## Background: How HealthOmics Billing Works

HealthOmics run costs have two independent components with fundamentally different billing models:

### Compute Cost (per task)

Each task is billed based on its **actual execution time** (start to stop), with a 60-second minimum, at the per-second rate of the assigned instance type. Whether tasks run in parallel or sequentially, each task still executes for the same duration — so **total compute cost is the same regardless of concurrency**.

```
compute_cost = Σ max(task_runtime_seconds, 60) × instance_rate_per_second
```

### Storage Cost (per run)

Run storage is provisioned when the run enters the "Running" state and persists until the run transitions to "Stopping". For STATIC storage, you pay for the **full provisioned capacity** (minimum 1,200 GiB) for the **entire wall-clock duration**:

```
storage_cost = $0.0001918/GB-hour × provisioned_GiB × run_duration_hours
```

This means: **anything that extends run duration — including concurrency throttling — directly increases storage cost.**

## Experiment Design

### Workflow

We created a custom WDL workflow with 50 scatter tasks. Each task:
- Requests 2 CPUs and 4 GB memory (maps to `omics.c.large`)
- Generates a 100 MB random file (simulating storage I/O)
- Runs ~120 seconds of CPU-bound work (`md5sum` checksums)

A final `AggregateResults` task collects all outputs.

```wdl
version 1.0

workflow ScatterStorageCostTest {
    input {
        Int num_tasks = 50
        Int task_duration_seconds = 120
        Int file_size_mb = 100
    }

    scatter (i in range(num_tasks)) {
        call ComputeTask {
            input:
                task_id = i,
                duration_seconds = task_duration_seconds,
                file_size_mb = file_size_mb
        }
    }

    call AggregateResults {
        input:
            results = ComputeTask.result_file
    }

    output {
        File final_report = AggregateResults.report
    }
}

task ComputeTask {
    input {
        Int task_id
        Int duration_seconds
        Int file_size_mb
    }

    command <<<
        echo "Task ~{task_id} starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        dd if=/dev/urandom of=output_~{task_id}.bin bs=1M count=~{file_size_mb} 2>/dev/null

        end_time=$((SECONDS + ~{duration_seconds}))
        while [ $SECONDS -lt $end_time ]; do
            md5sum output_~{task_id}.bin > /dev/null 2>&1
        done

        echo "Task ~{task_id} completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "task_~{task_id}: duration=~{duration_seconds}s, file_size=~{file_size_mb}MB" > result_~{task_id}.txt
    >>>

    runtime {
        docker: "<ecr-uri>/ubuntu:20.04"
        cpu: 2
        memory: "4 GB"
    }

    output {
        File result_file = "result_~{task_id}.txt"
    }
}

task AggregateResults {
    input {
        Array[File] results
    }

    command <<<
        echo "=== Scatter Storage Cost Test Results ==="
        echo "Aggregation started at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "Number of tasks: $(ls ~{sep=' ' results} | wc -w)"
        echo ""
        cat ~{sep=' ' results}
        echo ""
        echo "Aggregation completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    >>>

    runtime {
        docker: "<ecr-uri>/ubuntu:20.04"
        cpu: 1
        memory: "2 GB"
    }

    output {
        File report = stdout()
    }
}
```

### Two Runs, One Variable

We executed two identical runs with the only difference being the concurrency constraint:

| Parameter | Run A (High Concurrency) | Run B (Low Concurrency) |
|---|---|---|
| **Run Group** | None (default limits) | `maxCpus=4` |
| **Effective Parallelism** | ~50 tasks (all at once) | 2 tasks at a time |
| **Storage Type** | STATIC (1,200 GiB) | STATIC (1,200 GiB) |
| **Workflow & Parameters** | Identical | Identical |
| **Region** | us-east-1 | us-east-1 |

With `maxCpus=4` and each task requesting 2 CPUs, Run B could only execute 2 tasks simultaneously. Both runs started within 10 seconds of each other.

## Results

### Duration

| | Run A (High) | Run B (Low) | Ratio |
|---|---|---|---|
| **Total Duration** | 12 min 48 sec (768.6s) | 1 hr 12 min 35 sec (4,355.0s) | **5.67x** |

### Cost Breakdown

| Cost Component | Run A (High) | Run B (Low) | Ratio |
|---|---|---|---|
| **Compute Cost** | $0.2198 | $0.2171 | 0.99x (-1.2%) |
| **Storage Cost** | $0.0491 | $0.2784 | **5.67x** (+467%) |
| **Total Cost** | $0.2690 | $0.4955 | **1.84x** (+84%) |

### Storage as Percentage of Total

| | Run A (High) | Run B (Low) |
|---|---|---|
| **Storage** | 18.3% | **56.2%** |
| **Compute** | 81.7% | 43.8% |

At low concurrency, storage became the **dominant cost component** — flipping from less than one-fifth to more than half of total cost.

## Verifying the Math

We verified the reported costs against the billing formulas using actual task start/stop timestamps from the run manifests.

### Compute Cost Verification

Each `ComputeTask` (2 CPUs, 4 GiB) maps to an `omics.c.large` instance at **$0.1148/hour** ($0.00003188/second).

| | Run A | Run B |
|---|---|---|
| Total tasks | 51 | 51 |
| Total billed seconds | 6,893.7s | 6,806.9s |
| Avg ComputeTask runtime | 136.7s | 134.9s |
| **Calculated compute cost** | **$0.2197** | **$0.2170** |
| Reported compute cost | $0.2198 | $0.2171 |

The total billed seconds differ by only -1.3% between runs. Run B tasks ran marginally faster (~1.8s less per task) due to reduced resource contention with only 2 concurrent tasks, but this effect is negligible.

**Conclusion:** Compute cost depends on the sum of individual task execution times, not on overall run duration. Parallelism does not change this sum.

### Storage Cost Verification

```
Storage cost = $0.0001918/GB-hr × 1,200 GiB × run_duration_hours
```

| | Run A | Run B |
|---|---|---|
| Run duration | 768.6s (0.2135 hr) | 4,355.0s (1.2097 hr) |
| **Calculated storage cost** | **$0.0491** | **$0.2784** |
| Reported storage cost | $0.0491 | $0.2784 |

Both match to the penny. Storage cost tracks wall-clock duration exactly.

### Pricing Rates Used

| Component | Rate | Source |
|---|---|---|
| omics.c.large (2 vCPU, 4 GiB) | $0.1148/hour | Derived from omics.c.4xlarge ($0.9180/hr for 16 vCPU) |
| STATIC Run Storage | $0.0001918/GB-hour | AWS HealthOmics Pricing (us-east-1) |
| DYNAMIC Run Storage | $0.0004110/GB-hour | AWS HealthOmics Pricing (us-east-1) |
| Minimum task billing | 60 seconds | AWS HealthOmics Pricing |

## Task Execution Patterns

### Run A: All Tasks in Parallel

All 50 `ComputeTask` instances launched within a ~70-second window and completed within ~4 minutes. The `AggregateResults` task ran immediately after.

```
Time (min from start)   0    1    2    3    4    5    6    7
                        |----|----|----|----|----|----|----| 
Task 00-49              [========================================]  (all 50 parallel)
AggregateResults                                          [==]
```

### Run B: Serialized in Batches of 2

Tasks executed in 25 sequential batches, each taking ~2.5 minutes (135s execution + ~20s scheduling overhead). Total task execution spanned ~58 minutes.

```
Time (min from start)   0    5    10   15   20  ...  55   60   65
                        |----|----|----|----|---- ... |----|----|----|
Batch 1  (T43,T39)     [====]
Batch 2  (T22,T35)          [====]
Batch 3  (T44,T49)               [====]
...
Batch 25 (T31)                                       [====]
AggregateResults                                            [=]
```

## Generalized Formula

From the verified results, we can derive a general model for storage cost overhead:

```
Hourly storage burn rate (STATIC 1,200 GiB):
  $0.0001918/GB-hr × 1,200 GiB = $0.2302/hour

Storage cost multiplier ≈ duration_throttled / duration_full_concurrency

Every additional hour of run duration from concurrency throttling
adds ~$0.23 in storage cost.
```

The actual multiplier in our test (5.67x) was less than the theoretical maximum (50 tasks / 2 concurrent = 25x) because:
- Run A still had ~70s of scheduling overhead spreading tasks across staggered launches
- Run B had ~20s of scheduling gaps between each batch
- These overheads compress the ratio compared to the naive `N / C_max` estimate

## Recommendations

1. **Ensure sufficient concurrency headroom.** Set your Run Group's `maxCpus` high enough to avoid serializing scatter tasks. The HealthOmics default limits (3,000 concurrent CPUs, 10 concurrent tasks per run) are generally adequate, but custom Run Groups with low `maxCpus` can trigger this issue.

2. **Consider DYNAMIC storage for shorter runs.** If your workflow completes in under 2 hours, DYNAMIC storage ($0.0004110/GB-hr) charges only for actual GB-hours consumed rather than 1,200 GiB of provisioned capacity, potentially reducing the storage cost impact.

3. **Monitor run duration as a cost signal.** An unexpectedly long run duration may indicate concurrency throttling. Comparing expected vs actual duration can help detect storage cost inflation early.

4. **Use the Run Analyzer for diagnostics.** The HealthOmics Run Analyzer (available via [aws-healthomics-tools](https://github.com/awslabs/aws-healthomics-tools)) provides detailed cost breakdowns including the storage vs compute split, making concurrency-related cost inflation easy to identify.

## Conclusion

Our experiment confirms that **task concurrency limits directly increase HealthOmics run storage costs** by extending run duration, while compute costs remain constant. The storage cost scales linearly with wall-clock duration: a 5.67x longer run resulted in a 5.67x higher storage cost and an 84% increase in total cost.

For production genomic workflows with more tasks and longer runtimes, this effect becomes even more significant. Understanding the two distinct billing models — per-task compute vs per-duration storage — is key to optimizing HealthOmics workflow costs.

---

*Tested on AWS HealthOmics in us-east-1 using a custom WDL workflow. Cost analysis performed using the HealthOmics Run Analyzer.*