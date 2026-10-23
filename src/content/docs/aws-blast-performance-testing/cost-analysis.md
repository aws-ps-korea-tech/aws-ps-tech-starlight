---
title: "비용 분석 (Cost Analysis)"
---

# 비용 분석 (Cost Analysis)

# AWS BLAST Performance Testing - Detailed Cost Analysis

**Region**: ap-northeast-2 (Seoul)

---

## 1. Amazon EFS (Elastic File System) Costs

### Storage Configuration

| Parameter | Value |
|-----------|-------|
| File System ID | fs-0d2d032d1cca25f3f |
| Name | blast-perf-test-efs-nt-db |
| Total Size | **254.32 GB** (273,049,319,424 bytes) |
| Storage Class | Standard |
| Throughput Mode | **Elastic** |
| Performance Mode | General Purpose |
| Encrypted | Yes (KMS) |

### EFS Pricing (ap-northeast-2)

| Cost Type | Price | Unit |
|-----------|-------|------|
| Standard Storage | $0.36 | per GB-month |
| Elastic Throughput - Read | $0.043 | per GB transferred |
| Elastic Throughput - Write | $0.086 | per GB transferred |

### Today's EFS Usage

| Metric | Value |
|--------|-------|
| Data Read | **1,635.61 GB** (1,756,004,236,096 bytes) |
| Data Write | ~0 GB |
| Total I/O | **1,635.66 GB** (1,756,058,129,368 bytes) |

### EFS Cost Breakdown

#### Monthly Storage Cost
```
254.32 GB x $0.36/GB = $91.56/month
Daily: $91.56 / 30 = $3.05/day
```

#### Today's Throughput Cost (Read Operations)
```
1,635.61 GB x $0.043/GB = $70.33
```

#### Total EFS Cost (Today)
| Component | Cost |
|-----------|------|
| Storage (daily) | $3.05 |
| Read Throughput | $70.33 |
| Write Throughput | ~$0 |
| **Total** | **$73.38** |

---

## 2. Amazon S3 Costs

### S3 Bucket Configuration

| Parameter | Value |
|-----------|-------|
| Bucket Name | blast-perf-test-queries-664263524008 |
| Total Size | **236.05 MB** (247,421,178 bytes) |
| Storage Class | Standard |
| Number of Objects | 10 |

### S3 Objects Detail

| File | Size | Purpose |
|------|------|---------|
| queries/query.fasta | 75 KB | Original query (500 seqs) |
| queries/query_5000.fasta | 755 KB | 5,000 sequences |
| queries/query_50000.fasta | 7.4 MB | 50,000 sequences |
| queries/query_500000.fasta | 73.7 MB | 500,000 sequences |
| results/* (6 files) | 154 MB | BLAST output files |

### S3 Pricing (ap-northeast-2)

| Cost Type | Price | Unit |
|-----------|-------|------|
| Standard Storage | $0.025 | per GB-month |
| PUT/COPY/POST/LIST | $0.0045 | per 1,000 requests |
| GET/SELECT | $0.0004 | per 1,000 requests |
| Data Transfer (to Internet) | $0.126 | per GB (after 100GB free) |
| Data Transfer (to Same Region) | $0.00 | Free |

### S3 Cost Breakdown

#### Monthly Storage Cost
```
0.236 GB x $0.025/GB = $0.006/month (~$0.0002/day)
```

#### Today's Request Costs (Estimated)

| Request Type | Count | Cost |
|--------------|-------|------|
| PUT (uploads) | ~10 | $0.000045 |
| GET (downloads by Batch) | ~8 | $0.0000032 |
| LIST | ~20 | $0.00009 |
| **Total Requests** | **~38** | **$0.00014** |

#### Data Transfer
- S3 to EC2 (same region): **Free**
- EC2 to S3 (same region): **Free**

#### Total S3 Cost (Today)
| Component | Cost |
|-----------|------|
| Storage (daily) | $0.0002 |
| API Requests | $0.0001 |
| Data Transfer | $0.00 |
| **Total** | **< $0.01** |

---

## 3. Amazon EC2 Costs (via AWS Batch)

### Instance Configuration

| Instance Type | vCPU | Memory | On-Demand Price/hr |
|---------------|------|--------|-------------------|
| r6i.24xlarge | 96 | 768 GB | $7.776 |
| r7i.24xlarge | 96 | 768 GB | $8.1648 |

### Performance Test Execution Costs

| Test | Sequences | Runtime | Instance | EC2 Cost |
|------|-----------|---------|----------|----------|
| Test 1 | 500 | 3m 56s | r6i.24xlarge | $0.51 |
| Test 2 | 5,000 | 4m 46s | r6i.24xlarge | $0.62 |
| Test 3 | 50,000 | 5m 59s | r6i.24xlarge | $0.78 |
| Test 4 | 500,000 | 25m 9s | r6i.24xlarge | $3.27 |
| **Total** | **555,500** | **~40m** | | **$5.18** |

### Cost Calculation Formula
```
EC2 Cost = (Runtime in hours) x (Hourly rate)
Example: 3m 56s = 0.0656 hours x $7.776 = $0.51
```

---

## 4. AWS API Costs

### AWS Batch API
- **Cost**: Free (no charge for Batch API calls)
- Usage: Job submission, status checks, describe operations

### CloudWatch Logs
| Component | Cost |
|-----------|------|
| Log Ingestion | $0.76 per GB |
| Log Storage | $0.0314 per GB-month |
| Estimated daily logs | ~10 MB |
| **Daily Cost** | **~$0.008** |

### CloudWatch Metrics
- **Basic Metrics**: Free (EC2, EFS, S3 standard metrics)
- **Custom Metrics**: Not used

### Other API Costs
| Service | Cost |
|---------|------|
| IAM API | Free |
| EC2 API | Free |
| EFS API | Free |
| S3 API | Included in request costs |

---

## 5. Total Cost Summary (Today's Performance Test)

### Direct Costs

| Service | Cost | Notes |
|---------|------|-------|
| EC2 (Batch) | $5.18 | 4 jobs, ~40 min total |
| EFS Storage | $3.05 | Daily portion of $91.56/month |
| EFS Throughput | $70.33 | 1.6 TB read (BLAST DB) |
| S3 Storage | < $0.01 | 236 MB |
| S3 Requests | < $0.01 | ~38 requests |
| CloudWatch | ~$0.01 | Logs & metrics |
| **Total Direct** | **$78.57** | |

### Cost Distribution

```
EFS Throughput:   89.5% ($70.33)
EC2 Compute:       6.6% ($5.18)
EFS Storage:       3.9% ($3.05)
Other:             0.0% ($0.01)
```

---

## 6. Per-Sequence Cost Analysis

| Sequences | Total Cost* | Cost per 1,000 Seqs | EFS Read per Job |
|-----------|-------------|---------------------|------------------|
| 500 | $18.11 | $36.22 | ~400 GB |
| 5,000 | $18.22 | $3.64 | ~400 GB |
| 50,000 | $18.38 | $0.37 | ~400 GB |
| 500,000 | $20.87 | $0.04 | ~435 GB |

*Includes estimated EFS read costs (~$17.60 per job for ~409 GB average read)

### Key Insight
- **EFS throughput is the dominant cost** (89% of total)
- Each BLAST job reads ~400+ GB from EFS (database loading + search)
- EC2 compute cost is relatively small (6.6%)

---

## 7. Cost Optimization Recommendations

### Immediate Optimizations

1. **EFS Throughput Mode**
   - Current: Elastic ($0.043/GB read)
   - Alternative: Provisioned Throughput
   - **Savings**: If consistent usage, provisioned may be cheaper

2. **Database Caching Strategy**
   - Use instance store or EBS for frequently accessed DB portions
   - Potential savings: 50-70% on EFS throughput

3. **Batch Job Consolidation**
   - Run multiple query files in single job
   - Amortize database loading cost across more sequences

### Long-term Optimizations

| Strategy | Potential Savings | Complexity |
|----------|-------------------|------------|
| Use Spot Instances | 60-80% on EC2 | Low |
| EBS-backed BLAST DB | 70%+ on storage I/O | Medium |
| Smaller instance types | Variable | Low |
| Reserved Instances | 30-50% on EC2 | Medium |

### Recommended Architecture for Production

```
                    +---------------------+
                    |   EBS Snapshot      |
                    |   (BLAST Database)  |
                    +----------+----------+
                               | Attach on launch
                               v
+-------------+    +---------------------+
| S3 (queries)|---→|  EC2 Spot Instance  |
+-------------+    |  + EBS Volume       |
                   |  (local DB copy)    |
                   +----------+----------+
                              |
                              v
                   +---------------------+
                   |   S3 (results)      |
                   +---------------------+
```

**Estimated savings with EBS**: $70+ per day (eliminating EFS throughput)

---

## 8. Monthly Cost Projection

### Current Architecture (with EFS Elastic)

| Component | Monthly Cost | Assumptions |
|-----------|--------------|-------------|
| EFS Storage | $91.56 | 254 GB Standard |
| EFS Throughput | $2,110+ | 50 TB read/month |
| EC2 (Batch) | $155+ | ~20 hours/month |
| S3 | < $1 | Minimal storage |
| **Total** | **~$2,360/month** | |

### Optimized Architecture (with EBS)

| Component | Monthly Cost | Assumptions |
|-----------|--------------|-------------|
| EBS Snapshot | $12.70 | 254 GB @ $0.05/GB |
| EBS Volume Usage | ~$50 | Attached during jobs |
| EC2 Spot | $31+ | 60% savings |
| S3 | < $1 | |
| **Total** | **~$95/month** | |

**Potential Monthly Savings: ~$2,265 (96%)**

---

## Appendix: Pricing References

- [EFS Pricing (ap-northeast-2)](https://aws.amazon.com/efs/pricing/)
- [S3 Pricing (ap-northeast-2)](https://aws.amazon.com/s3/pricing/)
- [EC2 Pricing (ap-northeast-2)](https://aws.amazon.com/ec2/pricing/on-demand/)
- [CloudWatch Pricing](https://aws.amazon.com/cloudwatch/pricing/)
