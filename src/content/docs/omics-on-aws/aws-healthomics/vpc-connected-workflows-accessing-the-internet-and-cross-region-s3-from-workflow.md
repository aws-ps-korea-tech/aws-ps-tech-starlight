---
title: "VPC-Connected Workflows: Accessing the Internet and Cross-Region S3 from Workflows"
sidebar:
  order: 14
---

## Overview

In March 2026, AWS HealthOmics introduced **VPC-Connected Workflows**. This feature allows HealthOmics workflows to route network traffic through a customer-managed VPC, removing the network restrictions of the default RESTRICTED mode.

This post covers how the feature works, real-world test results, and how to set up the infrastructure using CDK.

---

## Limitations of RESTRICTED Mode

The default networking mode for HealthOmics workflows is **RESTRICTED**. In this mode, workflow tasks can only access S3 and ECR within the same region — all other network communication is blocked.

This restricts common bioinformatics workflow scenarios:

- **No access to public databases**: Cannot download reference data from NCBI, Ensembl, or other public bioinformatics databases
- **No external API calls**: Cannot connect to license servers, REST APIs, notification webhooks, etc.
- **No cross-region S3 access**: Cannot access genomic datasets stored in S3 buckets in other AWS regions

For cross-region S3 specifically, RESTRICTED mode validates S3 bucket regions at `StartRun` API call time — if any S3 URI references a different region, the workflow won't even start.

---

## VPC Mode: How It Works

In VPC mode, HealthOmics creates ENIs (Elastic Network Interfaces) for workflow tasks in the customer's VPC private subnets. Traffic flows through the VPC's NAT gateway to reach the internet or AWS services in other regions.

```
┌──────────────────────────────────────────────────────┐
│  VPC (10.0.0.0/16)                                   │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Private Sub-a│  │ Private Sub-b│  │Private Sub-c│ │
│  │  HealthOmics │  │  HealthOmics │  │ HealthOmics│  │
│  │  ENIs        │  │  ENIs        │  │ ENIs       │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘  │
│         └─────────────────┼────────────────┘         │
│                           │                          │
│                  ┌────────▼────────┐                 │
│                  │   NAT Gateway   │                 │
│                  │  (Public Subnet) │                │
│                  └────────┬────────┘                 │
│                           │                          │
│  S3 Gateway Endpoint ─── Same-region S3 (no cost)    │
│  Security Group: Outbound HTTPS 443 only             │
└───────────────────────────┼──────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  Public      │ │ Cross-region │ │ External     │
    │  Internet    │ │ S3 Buckets   │ │ REST APIs    │
    │ (NCBI, etc.) │ │ (us-east-1)  │ │ (GitHub etc.)│
    └──────────────┘ └──────────────┘ └──────────────┘
```

**Traffic path summary**:
- **Same-region S3**: Direct access via S3 Gateway endpoint (no data transfer cost)
- **Internet/Cross-region**: Private subnet → NAT gateway → Internet gateway

> **Note**: Every HealthOmics workflow run executes inside a VPC owned and managed by the HealthOmics service. Configuring VPC mode creates additional ENIs in your VPC to extend network access — it has no effect on the HealthOmics-managed VPC itself.

---

## Viewing in the Console

You can see the difference between the two modes in the HealthOmics console Run summary.

### RESTRICTED Mode Run

When running in RESTRICTED mode, the **Networking mode** field shows `Restricted`. No Configuration field is displayed, and the workflow runs in HealthOmics' default network environment. Only same-region S3 and ECR are accessible; external internet connectivity is not available.

[![restricted-networking-mode.png](./_images/restricted-networking-mode.png)](https://www.aws-ps-tech.kr/uploads/images/gallery/2026-04/restricted-networking-mode.png)


### VPC Mode Run

When running in VPC mode, the **Networking mode** field shows `Virtual Private Cloud (VPC)`, with an additional **Configuration** field below it. This displays the linked VPC Configuration name (e.g., `tutorial-vpc-config`) as a clickable link, leading to the Configuration details (VPC ID, subnets, security groups, etc.).

Both runs used the same workflow (`vpc-connectivity-test-v3`, WDL), with similar execution times (RESTRICTED: 5m 49s, VPC: 5m 21s).

[![vpc-mode.png](./_images/vpc-mode.png)](https://www.aws-ps-tech.kr/uploads/images/gallery/2026-04/vpc-mode.png)

---

## Test Results

We ran the same WDL workflow in both RESTRICTED and VPC modes in the ap-northeast-2 (Seoul) region to compare connectivity.

### Test Cases

**Category A — Internet Access**:
- A1: `curl https://checkip.amazonaws.com` (outbound HTTPS + NAT public IP verification)
- A2: `wget https://ftp.ncbi.nlm.nih.gov/robots.txt` (NCBI public resource download)
- A3: `curl https://api.github.com` (external REST API access)

**Category B — Cross-Region S3 Access** (us-east-1 → ap-northeast-2):
- B1: `aws s3 cp` (cross-region file download)
- B2: `aws s3 ls` (cross-region bucket listing)

### Results Comparison

| Test | RESTRICTED Mode | VPC Mode |
|------|----------------|----------|
| A1 — checkip.amazonaws.com | **FAIL** (timeout) | **PASS** (NAT IP returned) |
| A2 — NCBI robots.txt download | **FAIL** (timeout) | **PASS** (file downloaded) |
| A3 — GitHub API call | **FAIL** (timeout) | **PASS** (HTTP 200) |
| B1 — Cross-region S3 download | **Blocked at API** | **PASS** (file downloaded) |
| B2 — Cross-region S3 listing | **Blocked at API** | **PASS** (object list returned) |

In RESTRICTED mode, all internet tests fail with timeouts, and cross-region S3 is rejected at the `StartRun` API call with `ValidationException: S3 bucket not located in ap-northeast-2 region`.

In VPC mode, all 5 tests pass.

---

## Infrastructure Setup with CDK

To use VPC mode, you need to create a VPC meeting HealthOmics requirements and a HealthOmics Configuration. The **HealthOmicsVpc CDK L3 Construct** simplifies this process.

This CDK Construct creates everything with a single `cdk deploy`:

- **VPC**: Public/private subnets automatically placed in HealthOmics-supported AZs
- **NAT Gateway**: Choose development (1) or production (1 per AZ) mode
- **Security Group**: Least privilege principle (outbound HTTPS 443 only)
- **S3 Gateway Endpoint**: No data transfer cost for same-region S3 access
- **VPC Flow Logs**: Automatically sent to CloudWatch Logs
- **HealthOmics Configuration**: Automatically created and lifecycle-managed via Custom Resource

### Usage Example

```typescript
import { HealthOmicsVpc } from './lib';

new HealthOmicsVpc(stack, 'HealthOmicsVpc', {
  networkingConfigurationName: 'my-vpc-config',
  deploymentMode: 'development',    // 1 NAT GW (cost savings)
  vpcEndpoints: ['s3'],             // S3 Gateway endpoint
});
```

### Deployment Steps

```bash
# Set environment variables
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# CDK deployment
cd healthomics-vpc-cdk-main
npm install
npx cdk bootstrap aws://${AWS_ACCOUNT_ID}/${AWS_REGION}
npx cdk deploy --require-approval never
```

Once the Configuration reaches `ACTIVE` status (up to 15 minutes), you can run workflows in VPC mode.

---

## Running Workflows

### RESTRICTED Mode (Default)

```bash
aws omics start-run \
    --workflow-id <WORKFLOW_ID> \
    --role-arn <ROLE_ARN> \
    --output-uri s3://my-bucket/output/ \
    --parameters '{"output_s3_uri": "s3://my-bucket/report.json"}'
```

### VPC Mode

```bash
aws omics start-run \
    --workflow-id <WORKFLOW_ID> \
    --role-arn <ROLE_ARN> \
    --output-uri s3://my-bucket/output/ \
    --networking-mode VPC \
    --configuration-name my-vpc-config \
    --parameters '{
        "output_s3_uri": "s3://my-bucket/report.json",
        "cross_region_s3_uri": "s3://bucket-in-other-region/data.txt"
    }'
```

The only difference is the addition of `--networking-mode VPC` and `--configuration-name`.

---

## Things to Know

### Container Image Configuration

HealthOmics supports container images hosted in **Amazon ECR private repositories**. The ECR repository must be in the **same region** as the workflow, and only x86_64 architecture is supported (ARM containers are not supported). On ARM-based local machines such as Apple Mac, use `docker build --platform amd64` to build images.

**Using public registry images**: While you cannot directly reference public images from Docker Hub, Public ECR, etc., you can use **ECR Pull Through Cache** to automatically synchronize these images to your private repository. Supported upstream registries include:

- Amazon ECR Public
- Docker Hub
- Quay
- GitHub Container Registry
- GitLab Container Registry
- Kubernetes container image registry
- Microsoft Azure Container Registry

With Pull Through Cache, there's no need to manually migrate images — upstream registry changes are automatically synchronized. HealthOmics also automatically maps ECR private URIs to upstream registry URIs, so you don't need to manually update URIs in your workflow definitions.

**ECR repository access policy**: In addition to IAM role permissions, you must set an access policy on the ECR repository itself for the `omics.amazonaws.com` service principal.

```bash
aws ecr set-repository-policy \
    --repository-name my-repo \
    --policy-text '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "omics.amazonaws.com"},
            "Action": [
                "ecr:BatchGetImage",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchCheckLayerAvailability"
            ]
        }]
    }'
```

**Container image considerations**:
- Do not specify an `ENTRYPOINT` in your container image. The HealthOmics workflow engine injects bash scripts as a command override.
- A shared filesystem is mounted at `/tmp`, so any data or tooling built into the container image at this location will be overridden.
- The workflow definition is available via a read-only mount at `/mnt/workflow`.

### S3 Parameter Validation

HealthOmics validates S3 URIs in workflow parameters at `StartRun` call time:
- Referenced S3 objects must **exist** (for output paths, create a placeholder)
- In RESTRICTED mode, S3 buckets must be in the **same region**

### Configuration Details

- Configuration creation takes **up to 15 minutes** to transition from `CREATING` to `ACTIVE` status.
- Workflow runs use a **snapshot of the configuration as it existed when the run started**. You can safely modify or delete configurations during run execution without affecting active runs.
- You cannot delete a configuration that is currently in use by active workflow runs.

### ENI Considerations

- ENIs created by HealthOmics in your VPC are tagged with `Service: HealthOmics` and `eniType: CUSTOMER`.
- **Do not modify or delete ENIs created by HealthOmics.** This can cause service delays or disruptions to your workflow runs.
- The default ENI limit is 5,000 per region. Monitor your ENI usage in the EC2 console as the number of required ENIs varies by workload.

### Performance Impact

- VPC mode adds approximately 30–60 seconds to startup time due to ENI provisioning. There is no significant difference in workflow task execution time itself.
- Network throughput **starts at 10 Gbps and scales to 100 Gbps over time**. For immediate high-throughput needs, plan ahead and request pre-warming.

### Cost Considerations

| Resource | Cost | Notes |
|----------|------|-------|
| NAT Gateway | ~$0.045/hr + data processing | Largest cost component |
| S3 Gateway Endpoint | Free | Same-region S3 access |
| VPC Flow Logs | CloudWatch Logs ingestion cost | Useful for troubleshooting |

For testing or development, use development mode (1 NAT gateway) and **clean up resources immediately after testing** to avoid unnecessary costs. For AWS service access, use **VPC endpoints** instead of NAT Gateway to reduce data processing costs.

### VPC Networking Quotas

| Resource | Default Limit | Adjustable |
|----------|--------------|------------|
| Max configurations per account | 10 | Yes |
| Max security groups per configuration | 5 | No |
| Max subnets per configuration | 16 | No |
| Max subnets per Availability Zone | 1 | No |
| ENIs per region (customer VPC) | 5,000 | Yes |

### Supported Regions

| Region | AZ Count |
|--------|----------|
| us-east-1 (N. Virginia) | 4 |
| us-west-2 (Oregon) | 3 |
| eu-west-1 (Ireland) | 3 |
| eu-west-2 (London) | 3 |
| eu-central-1 (Frankfurt) | 3 |
| ap-southeast-1 (Singapore) | 3 |
| ap-northeast-2 (Seoul) | 3 |
| il-central-1 (Tel Aviv) | 3 |

---

## Summary

VPC-Connected Workflows significantly expand the network accessibility of HealthOmics workflows. This feature is particularly useful for bioinformatics pipelines that require access to external databases, API calls, or cross-region data. Using the CDK L3 Construct, you can complete the complex VPC infrastructure setup with a single command.

### References

Please see our [What’s New post](https://aws.amazon.com/about-aws/whats-new/2026/03/aws-healthomics-vpc-connected-workflows/) and [Documentation](https://docs.aws.amazon.com/omics/latest/dev/workflows-vpc-networking.html) and let us know if you have any questions!

- [Container images for private workflows](https://docs.aws.amazon.com/omics/latest/dev/workflows-ecr.html)