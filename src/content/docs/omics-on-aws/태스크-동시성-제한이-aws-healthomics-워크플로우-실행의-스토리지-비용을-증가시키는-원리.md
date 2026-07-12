---
title: "태스크 동시성 제한이 AWS HealthOmics 워크플로우 실행의 스토리지 비용을 증가시키는 원리"
sidebar:
  order: 2
---

AWS HealthOmics에서 유전체 워크플로우를 실행할 때, 비용 관리나 팀 간 용량 공유를 위해 **Run Group**의 `maxCpus`로 태스크 동시성을 제어할 수 있습니다. 하지만 여기에는 중요한 부작용이 있습니다: **동시성을 제한하면 오히려 총 실행 비용이 증가할 수 있으며**, 특히 스토리지 요금에서 그 영향이 나타납니다.

이 효과를 측정하고 과금 메커니즘을 검증하기 위해 통제된 실험을 수행했습니다.

## 요약 (TL;DR)

- 50개 태스크 워크플로우의 동시성을 완전 병렬에서 2개 동시 실행으로 제한하면 실행 시간이 **5.67배** 증가
- 스토리지 비용이 **5.67배** 증가 ($0.049 → $0.278), 실행 시간과 정확히 비례
- 컴퓨팅 비용은 거의 동일 ($0.220 → $0.217, -1.2%)
- 총 비용이 **84%** 증가 ($0.269 → $0.496)

## 배경: HealthOmics 과금 방식

HealthOmics 실행 비용은 근본적으로 다른 과금 모델을 가진 두 가지 독립적인 구성 요소로 이루어져 있습니다:

### 컴퓨팅 비용 (태스크 단위)

각 태스크는 할당된 인스턴스 유형의 초당 요금으로, **실제 실행 시간**(시작~종료) 기준으로 과금됩니다(최소 60초). 태스크가 병렬로 실행되든 순차적으로 실행되든, 각 태스크의 실행 시간은 동일하므로 **총 컴퓨팅 비용은 동시성과 무관하게 동일**합니다.

```
컴퓨팅_비용 = Σ max(태스크_실행_시간(초), 60) × 인스턴스_초당_요금
```

### 스토리지 비용 (실행 단위)

실행 스토리지는 실행이 "Running" 상태에 진입할 때 프로비저닝되며, "Stopping"으로 전환될 때까지 유지됩니다. STATIC 스토리지의 경우, **전체 프로비저닝된 용량**(최소 1,200 GiB)에 대해 **전체 벽시계 시간(wall-clock duration)** 동안 비용을 지불합니다:

```
스토리지_비용 = $0.0001918/GB-시간 × 프로비저닝된_GiB × 실행_시간(시간)
```

즉, **실행 시간을 연장하는 모든 요인 — 동시성 제한 포함 — 이 스토리지 비용을 직접적으로 증가시킵니다.**

## 실험 설계

### 워크플로우

50개의 scatter 태스크를 가진 커스텀 WDL 워크플로우를 작성했습니다. 각 태스크는:
- 2 CPU, 4 GB 메모리 요청 (`omics.c.large`에 매핑)
- 100 MB 랜덤 파일 생성 (스토리지 I/O 시뮬레이션)
- ~120초의 CPU 집약적 작업 수행 (`md5sum` 체크섬)

마지막 `AggregateResults` 태스크가 모든 출력을 수집합니다.

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

### 두 번의 실행, 하나의 변수

동시성 제약만 다르게 하여 동일한 워크플로우를 두 번 실행했습니다:

| 파라미터 | Run A (높은 동시성) | Run B (낮은 동시성) |
|---|---|---|
| **Run Group** | 없음 (기본 제한) | `maxCpus=4` |
| **실효 병렬도** | ~50개 태스크 (전부 동시) | 2개 태스크씩 |
| **스토리지 유형** | STATIC (1,200 GiB) | STATIC (1,200 GiB) |
| **워크플로우 및 파라미터** | 동일 | 동일 |
| **리전** | us-east-1 | us-east-1 |

`maxCpus=4`이고 각 태스크가 2 CPU를 요청하므로, Run B는 동시에 2개 태스크만 실행할 수 있었습니다. 두 실행은 10초 이내 간격으로 시작되었습니다.

## 결과

### 실행 시간

| | Run A (높은 동시성) | Run B (낮은 동시성) | 비율 |
|---|---|---|---|
| **총 실행 시간** | 12분 48초 (768.6초) | 1시간 12분 35초 (4,355.0초) | **5.67배** |

### 비용 분석

| 비용 항목 | Run A (높은 동시성) | Run B (낮은 동시성) | 비율 |
|---|---|---|---|
| **컴퓨팅 비용** | $0.2198 | $0.2171 | 0.99배 (-1.2%) |
| **스토리지 비용** | $0.0491 | $0.2784 | **5.67배** (+467%) |
| **총 비용** | $0.2690 | $0.4955 | **1.84배** (+84%) |

### 총 비용 대비 스토리지 비율

| | Run A (높은 동시성) | Run B (낮은 동시성) |
|---|---|---|
| **스토리지** | 18.3% | **56.2%** |
| **컴퓨팅** | 81.7% | 43.8% |

낮은 동시성에서 스토리지가 **지배적인 비용 항목**이 되었습니다 — 총 비용의 1/5 미만에서 절반 이상으로 역전되었습니다.

## 수학적 검증

실행 매니페스트의 실제 태스크 시작/종료 타임스탬프를 사용하여 보고된 비용을 과금 공식과 대조 검증했습니다.

### 컴퓨팅 비용 검증

각 `ComputeTask` (2 CPU, 4 GiB)는 `omics.c.large` 인스턴스에 매핑되며, 시간당 **$0.1148** (초당 $0.00003188)입니다.

| | Run A | Run B |
|---|---|---|
| 총 태스크 수 | 51 | 51 |
| 총 과금 시간(초) | 6,893.7초 | 6,806.9초 |
| ComputeTask 평균 실행 시간 | 136.7초 | 134.9초 |
| **계산된 컴퓨팅 비용** | **$0.2197** | **$0.2170** |
| 보고된 컴퓨팅 비용 | $0.2198 | $0.2171 |

총 과금 시간의 차이는 두 실행 간 -1.3%에 불과합니다. Run B의 태스크가 동시 실행 태스크가 2개뿐이어서 리소스 경합이 줄어 약간 더 빠르게 실행되었지만(태스크당 ~1.8초 감소), 이 효과는 무시할 수 있는 수준입니다.

**결론:** 컴퓨팅 비용은 개별 태스크 실행 시간의 합에 의존하며, 전체 실행 시간과는 무관합니다. 병렬도는 이 합계를 변경하지 않습니다.

### 스토리지 비용 검증

```
스토리지 비용 = $0.0001918/GB-시간 × 1,200 GiB × 실행_시간(시간)
```

| | Run A | Run B |
|---|---|---|
| 실행 시간 | 768.6초 (0.2135시간) | 4,355.0초 (1.2097시간) |
| **계산된 스토리지 비용** | **$0.0491** | **$0.2784** |
| 보고된 스토리지 비용 | $0.0491 | $0.2784 |

센트 단위까지 정확히 일치합니다. 스토리지 비용은 벽시계 시간에 정확히 비례합니다.

### 사용된 요금 단가

| 항목 | 요금 | 출처 |
|---|---|---|
| omics.c.large (2 vCPU, 4 GiB) | $0.1148/시간 | omics.c.4xlarge ($0.9180/시간, 16 vCPU)에서 산출 |
| STATIC Run Storage | $0.0001918/GB-시간 | AWS HealthOmics 요금표 (us-east-1) |
| DYNAMIC Run Storage | $0.0004110/GB-시간 | AWS HealthOmics 요금표 (us-east-1) |
| 최소 태스크 과금 시간 | 60초 | AWS HealthOmics 요금표 |

## 태스크 실행 패턴

### Run A: 모든 태스크 병렬 실행

50개의 `ComputeTask` 인스턴스가 ~70초 이내에 모두 시작되어 ~4분 이내에 완료되었습니다. `AggregateResults` 태스크가 즉시 이어서 실행되었습니다.

```
시간 (시작 후 분)        0    1    2    3    4    5    6    7
                        |----|----|----|----|----|----|----| 
Task 00-49              [========================================]  (50개 전부 병렬)
AggregateResults                                          [==]
```

### Run B: 2개씩 순차 배치 실행

태스크가 25개의 순차 배치로 실행되었으며, 각 배치는 ~2.5분 소요 (135초 실행 + ~20초 스케줄링 오버헤드). 전체 태스크 실행에 ~58분이 소요되었습니다.

```
시간 (시작 후 분)        0    5    10   15   20  ...  55   60   65
                        |----|----|----|----|---- ... |----|----|----|
배치 1  (T43,T39)       [====]
배치 2  (T22,T35)            [====]
배치 3  (T44,T49)                 [====]
...
배치 25 (T31)                                         [====]
AggregateResults                                              [=]
```

## 일반화된 공식

검증된 결과로부터 스토리지 비용 오버헤드에 대한 일반 모델을 도출할 수 있습니다:

```
시간당 스토리지 소진율 (STATIC 1,200 GiB):
  $0.0001918/GB-시간 × 1,200 GiB = $0.2302/시간

스토리지 비용 배수 ≈ 제한된_실행시간 / 완전_동시성_실행시간

동시성 제한으로 인한 실행 시간 1시간 추가마다
~$0.23의 스토리지 비용이 추가됩니다.
```

실험에서의 실제 배수(5.67배)가 이론적 최대값(50 태스크 / 2 동시 = 25배)보다 작은 이유:
- Run A에서도 태스크가 시차를 두고 시작되면서 ~70초의 스케줄링 오버헤드 발생
- Run B에서 각 배치 사이에 ~20초의 스케줄링 간격 존재
- 이러한 오버헤드가 단순 `N / C_max` 추정 대비 비율을 압축

## 권장 사항

1. **충분한 동시성 여유를 확보하세요.** Run Group의 `maxCpus`를 scatter 태스크가 직렬화되지 않을 만큼 충분히 높게 설정하세요. HealthOmics 기본 제한(동시 3,000 CPU, 실행당 동시 10개 태스크)은 일반적으로 적절하지만, 낮은 `maxCpus`의 커스텀 Run Group은 이 문제를 유발할 수 있습니다.

2. **짧은 실행에는 DYNAMIC 스토리지를 고려하세요.** 워크플로우가 2시간 이내에 완료된다면, DYNAMIC 스토리지($0.0004110/GB-시간)는 1,200 GiB의 프로비저닝된 용량 대신 실제 소비된 GB-시간만 과금하므로 스토리지 비용 영향을 줄일 수 있습니다.

3. **실행 시간을 비용 신호로 모니터링하세요.** 예상보다 긴 실행 시간은 동시성 제한을 나타낼 수 있습니다. 예상 대비 실제 실행 시간을 비교하면 스토리지 비용 인플레이션을 조기에 감지할 수 있습니다.

4. **진단에 Run Analyzer를 활용하세요.** HealthOmics Run Analyzer([aws-healthomics-tools](https://github.com/awslabs/aws-healthomics-tools)에서 제공)는 스토리지 대 컴퓨팅 비율을 포함한 상세 비용 분석을 제공하여, 동시성 관련 비용 인플레이션을 쉽게 식별할 수 있습니다.

## 결론

이 실험은 **태스크 동시성 제한이 실행 시간을 연장함으로써 HealthOmics 실행 스토리지 비용을 직접적으로 증가시키며**, 컴퓨팅 비용은 일정하게 유지됨을 확인합니다. 스토리지 비용은 벽시계 시간에 선형적으로 비례합니다: 5.67배 긴 실행은 5.67배 높은 스토리지 비용과 84%의 총 비용 증가를 초래했습니다.

더 많은 태스크와 더 긴 실행 시간을 가진 프로덕션 유전체 워크플로우에서는 이 효과가 더욱 두드러집니다. 태스크 단위 컴퓨팅 과금과 실행 시간 단위 스토리지 과금이라는 두 가지 서로 다른 과금 모델을 이해하는 것이 HealthOmics 워크플로우 비용 최적화의 핵심입니다.

---

*us-east-1 리전의 AWS HealthOmics에서 커스텀 WDL 워크플로우로 테스트되었습니다. 비용 분석은 HealthOmics Run Analyzer를 사용하여 수행되었습니다.*