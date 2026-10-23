---
title: "Running nf-core/sarek 3.9.0 on AWS HealthOmics"
---

# Running nf-core/sarek 3.9.0 on AWS HealthOmics

This guide documents everything required to register and successfully run the
[nf-core/sarek](https://nf-co.re/sarek/3.9.0) 3.9.0 germline/somatic variant-calling pipeline on
**AWS HealthOmics**, using the [HealthOmics MCP server](https://github.com/awslabs/mcp) plus the
AWS CLI. It is written from an end-to-end run that reached a clean `COMPLETED` status, and it
covers the five distinct blockers encountered along the way — each with its root cause and the
exact fix.

Every result below was verified on a real run in `us-west-2`. Account IDs, VPC/subnet/security-group
IDs, and private endpoints are replaced with placeholders:

| Placeholder | Meaning |
|---|---|
| `<ACCOUNT_ID>` | your 12-digit AWS account ID |
| `<REGION>` | the AWS Region you run in (this guide used `us-west-2`) |
| `<OUTPUT_BUCKET>` | an S3 bucket you own in `<REGION>` for definitions, inputs, and outputs |
| `<OMICS_RUN_ROLE_ARN>` | the IAM role HealthOmics assumes for the run |
| `<VPC_CONFIG_NAME>` | a HealthOmics VPC networking configuration (ACTIVE) |
| `<ECR>` | `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com` |

---

## TL;DR — What it actually takes

sarek 3.9.0 pins `nextflowVersion = '!>=25.10.2'`, so HealthOmics runs it on the **Nextflow 26.04.0**
engine. Getting a clean run required solving five independent problems, none of which is obvious
from the pipeline docs:

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | `ValidationException ... StartRun: S3 object not found` before any task | nf-schema validates the default `snpeff_cache = 's3://annotation-cache/...'` param (schema `format: directory-path`) by *stat-ing* the S3 prefix; HealthOmics' S3 provider throws on non-object keys | Run with `validate_params = false` |
| 2 | `ECR_PERMISSION_ERROR` at container resolution | Wave images were mirrored to **manually-created** ECR repos, which have **no repository policy** granting `omics.amazonaws.com` pull access | `set-repository-policy` on every mirrored repo |
| 3 | `INVALID_TASK_RESOURCE_VALUE` after 2 tasks | `BWAMEM1_INDEX` requests `memory { 6.B * fasta.size() }`; a tiny test genome yields **< 1 GiB**, below the HealthOmics minimum | Floor resources in a `conf/healthomics.config` |
| 4 | `multiqc: command not found` on the final task | sarek's MULTIQC container is a **Seqera Wave "pixi" image**; its binary is on `PATH` only via the image `ENTRYPOINT`, which HealthOmics **ignores** | Override MULTIQC to the `quay.io/biocontainers` image |
| — | (not an issue for 3.9.0) config parse | 3.9.0 is written for the strict **v2 parser** (default on 26.04.0) | No `syntaxVersion=v1` needed |

Plus one structural fact: **ECR pull-through cache does not support `community.wave.seqera.io`**,
which is where sarek pulls ~half its containers — so those must be mirrored into private ECR by hand.

Final verified result: a run with **23/23 tasks `COMPLETED`**, producing Strelka VCFs, recalibrated
CRAMs, and a full MultiQC report.

---

## 0. Prerequisites

| Requirement | Notes |
|---|---|
| AWS account + a HealthOmics Region | this guide used `us-west-2` |
| **AWS CLI v2**, recent | must accept `omics start-run --engine-settings` |
| **Docker** running, ~50 GB free disk | to mirror Seqera Wave images into ECR |
| `git`, `zip` | clone + package the pipeline |
| **HealthOmics run role** (`<OMICS_RUN_ROLE_ARN>`) | trust `omics.amazonaws.com`; permissions in §0.1 |
| **VPC networking configuration** (`<VPC_CONFIG_NAME>`, ACTIVE) | private subnets + NAT, for internet egress to fetch GitHub-hosted test data |
| `AWSServiceRoleForHealthOmics` SLR | auto-created on first omics use |

### 0.1 Run-role permissions

The role HealthOmics assumes for the run needs:

- **S3**: read the workflow definition and inputs, read+write the output location.
- **CloudWatch Logs**: write to `/aws/omics/*`.
- **ECR**: `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`,
  `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage` (for the cached/mirrored images).

> Note: HealthOmics pulls container images **as the service principal**, using each ECR repo's
> *resource policy* — not only via the run role. This distinction is the root of blocker #2 (§4).

### 0.2 Configure the HealthOmics MCP server

The MCP server wraps the HealthOmics API for agent-driven workflows. Onboarding writes a small
config:

```toml
# .healthomics/config.toml
omics_iam_role  = "<OMICS_RUN_ROLE_ARN>"
run_output_uri  = "s3://<OUTPUT_BUCKET>/healthomics-outputs/"
run_storage_type = "DYNAMIC"
```

The MCP server is launched with `uvx awslabs.aws-healthomics-mcp-server@latest`. It exposes tools
for workflow creation (`CreateAHOWorkflow`, `CreateAHOWorkflowVersion`), runs (`StartAHORun`,
`GetAHORun`, `ListAHORunTasks`), diagnostics (`DiagnoseAHORunFailure`), and container/ECR helpers
(`CreatePullThroughCacheForHealthOmics`, `CreateContainerRegistryMap`, `ValidateHealthOmicsECRConfig`).

> **MCP limitation to know up front:** the `StartAHORun` tool has **no `engineSettings` argument**.
> To pass `-profile` or `syntaxVersion`, use the AWS CLI (`aws omics start-run --engine-settings`).
> Everything else can go through the MCP tools.

---

## 1. Understand the pipeline before you touch HealthOmics

A few facts about sarek 3.9.0 drive every decision below. Read them from the source, not from memory:

```bash
# Manifest: engine pin + version
curl -sSL https://raw.githubusercontent.com/nf-core/sarek/3.9.0/nextflow.config \
  | grep -E "nextflowVersion|version *=" 
# -> nextflowVersion = '!>=25.10.2'   version = '3.9.0'

# Container registry defaults
curl -sSL https://raw.githubusercontent.com/nf-core/sarek/3.9.0/nextflow.config \
  | grep -E "docker.registry"
# -> docker.registry = 'quay.io'   (so bare `biocontainers/x` means quay.io/biocontainers/x)
```

Key takeaways:

- **Engine**: `!>=25.10.2` is a hard pin. Of the HealthOmics-supported versions
  (`22.04.01 / 23.10.0 / 24.10.8 / 25.10.0 / 26.04.0`), only **26.04.0** qualifies. 26.04.0 defaults
  to the **strict (v2) syntax parser**.
- **v2 parser compatibility**: unlike sarek 3.8.1 (which nested `withName` selectors inside
  `if () {}` blocks and needed `syntaxVersion=v1`), sarek 3.9.0's config is v2-clean — all 229
  `withName` selectors are top-level in `process {}`, and `if ()` appears only inside closures
  (`ext.args = { ... }`). **No `syntaxVersion` override is required.**
- **Containers span two registries**:
  - `quay.io/biocontainers/*` — anonymous-pullable; works via an ECR **pull-through cache**.
  - `community.wave.seqera.io/library/*` (Seqera Wave) — **~27 images**; ECR PTC does **not**
    support this upstream, so these must be **mirrored** into private ECR.
- **Test profile uses tiny, public data over HTTPS**: `conf/test.config` sets
  `genome = 'testdata.nf-core.sarek'` and points `input` / `igenomes_base` at
  `https://raw.githubusercontent.com/nf-core/test-datasets/...`. This deliberately avoids the
  cross-Region iGenomes (`s3://ngi-igenomes`, eu-west-1) problem — but the run still needs
  **VPC networking with NAT egress** to reach `raw.githubusercontent.com`.

---

## 2. Container strategy (the hard part)

HealthOmics only pulls task containers from **private ECR in the same account and Region**. sarek's
containers live upstream, so you bridge them two ways.

### 2.1 quay.io/biocontainers → ECR pull-through cache

The MCP tool creates the cache rule *and* wires up the HealthOmics permissions (registry policy +
repository-creation template) in one call:

```
CreatePullThroughCacheForHealthOmics(upstream_registry="quay", ecr_repository_prefix="quay")
```

After this, any `quay.io/biocontainers/foo:tag` is reachable at `<ECR>/quay/biocontainers/foo:tag`,
and repos auto-created by the cache **inherit** the omics pull policy from the creation template.

### 2.2 community.wave.seqera.io → manual mirror into ECR

ECR pull-through cache **rejects** `community.wave.seqera.io`:

```
UnsupportedUpstreamRegistryException: The upstream registry URL
community.wave.seqera.io is invalid.
```

So mirror each Wave image with Docker. First enumerate exactly what the pipeline references (so you
mirror only what's needed):

```bash
git clone --depth 1 --branch 3.9.0 https://github.com/nf-core/sarek.git sarek-390
cd sarek-390
grep -rhoE "community\.wave\.seqera\.io/library/[^'\"]+" modules/ \
  | grep -v '/data$' | sort -u > /tmp/wave_images.txt
wc -l /tmp/wave_images.txt      # 27 references (25 distinct Docker images; see note below)
```

Then pull → retag → push, flattening `community.wave.seqera.io/library/...` to `wave/library/...`:

```bash
REG="<ECR>"
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin "$REG"

while IFS= read -r SRC; do
  REPO_PATH="wave/${SRC#community.wave.seqera.io/}"   # wave/library/foo:tag
  REPO_NAME="${REPO_PATH%%:*}"
  DEST="$REG/$REPO_PATH"
  aws ecr create-repository --repository-name "$REPO_NAME" --region <REGION> \
    --image-tag-mutability MUTABLE 2>/dev/null || true
  docker pull -q "$SRC" && docker tag "$SRC" "$DEST" && docker push -q "$DEST"
  docker rmi "$SRC" "$DEST" >/dev/null 2>&1 || true
done < /tmp/wave_images.txt
```

The 23 mirrored repositories (some hold multiple tags) are:

```
wave/library/ascat_cancerit-allelecount        wave/library/manta_python
wave/library/bbmap_pigz                        wave/library/multiqc
wave/library/bcftools                          wave/library/muse
wave/library/bcftools_htslib                   wave/library/sentieon
wave/library/bwa-mem2_htslib_samtools          wave/library/snpeff
wave/library/bwa_htslib_samtools               wave/library/varlociraptor
wave/library/coreutils_grep_gzip_lbzip2_pruned wave/library/vcflib
wave/library/ensembl-vep_perl-math-cdf_htslib  wave/library/yte
wave/library/fastp                             wave/library/htslib
wave/library/fgbio                             wave/library/htslib_muse
wave/library/gatk4_gcnvkernel                  wave/library/htslib_snpsift
wave/library/gatk4_gcnvkernel_htslib_samtools
```

> **Two Wave multiqc tags won't pull** with Docker — they are **Singularity SIF** artifacts
> (`application/vnd.sylabs.sif.config.v1+json`). That's expected: HealthOmics runs Docker/OCI
> images, and the MULTIQC module's Docker path uses a different tag. Skip the SIF tags.

### 2.3 Grant `omics.amazonaws.com` pull access to the mirrored repos (blocker #2)

This is the subtle one. Repos you create with `aws ecr create-repository` have **no repository
policy**, so the HealthOmics service principal cannot pull them — the run fails with
`ECR_PERMISSION_ERROR` even though the images exist and the run role has ECR permissions. (Repos
created *by the pull-through cache* get this policy automatically from the creation template; manual
ones do not.) Apply the same policy to every mirrored repo:

```bash
POLICY='{"Version":"2012-10-17","Statement":[{"Sid":"omics workflow access",
  "Effect":"Allow","Principal":{"Service":"omics.amazonaws.com"},
  "Action":["ecr:GetDownloadUrlForLayer","ecr:BatchGetImage","ecr:BatchCheckLayerAvailability"]}]}'

for R in $(aws ecr describe-repositories --region <REGION> \
    --query 'repositories[?starts_with(repositoryName,`wave/`)].repositoryName' --output text); do
  aws ecr set-repository-policy --repository-name "$R" --region <REGION> --policy-text "$POLICY"
done
```

### 2.4 The container registry map

The workflow needs a map telling HealthOmics how to rewrite upstream image references to your ECR:

- **`registryMappings`** — a prefix rewrite for the pull-through cache (`quay.io` → `quay`).
- **`imageMappings`** — explicit per-image rewrites for the mirrored Wave images.

```json
{
  "registryMappings": [
    { "upstreamRegistryUrl": "quay.io", "ecrRepositoryPrefix": "quay" }
  ],
  "imageMappings": [
    {
      "sourceImage": "community.wave.seqera.io/library/fastp:0.24.0--62c97b06e8447690",
      "destinationImage": "<ECR>/wave/library/fastp:0.24.0--62c97b06e8447690"
    }
    // ... one entry per mirrored Wave image ...
  ]
}
```

You can scaffold the `registryMappings` half from discovered pull-through caches with the MCP tool
`CreateContainerRegistryMap`, then append the Wave `imageMappings` generated from your mirror list.
Validate the ECR side any time with `ValidateHealthOmicsECRConfig`.

---

## 3. HealthOmics compatibility config

Two pipeline behaviors are incompatible with HealthOmics and are best fixed with a small extra
config file bundled into the workflow. Create `conf/healthomics.config`:

```groovy
/*
 * HealthOmics compatibility overrides.
 *
 * 1) Resource floors: some nf-core modules compute memory from input size
 *    (e.g. BWA index: `6.B * fasta.size()`). Tiny test genomes yield < 1 GiB,
 *    which HealthOmics rejects (INVALID_TASK_RESOURCE_VALUE). Floor them.
 *
 * 2) MULTIQC container override: sarek's default MULTIQC container is a Seqera
 *    Wave "pixi" image whose binary lives in /opt/wave/.pixi/... and is put on
 *    PATH only by the image ENTRYPOINT (/shell-hook.sh). HealthOmics runs the
 *    task command directly and IGNORES ENTRYPOINT, so `multiqc` is not found.
 *    Use the standard biocontainers image (binary on /usr/local/bin), pulled
 *    via the quay.io ECR pull-through cache.
 */
process {
    withName: '.*:BWAMEM1_INDEX'    { memory = { 2.GB * task.attempt }; cpus = 2 }
    withName: '.*:BWAMEM2_INDEX'    { memory = { 6.GB };                cpus = 2 }
    withName: '.*:DRAGMAP_HASHTABLE'{ memory = { 4.GB * task.attempt }; cpus = 2 }

    withName: '.*:MULTIQC' {
        container = 'quay.io/biocontainers/multiqc:1.35--pyhdfd78af_0'
    }
}
```

Wire it into the pipeline by appending one line to `nextflow.config`:

```bash
printf "\n// AWS HealthOmics resource floors + container overrides\nincludeConfig 'conf/healthomics.config'\n" >> nextflow.config
```

> **Why these two, specifically**
>
> - **Blocker #3 — resource floor.** `modules/nf-core/bwa/index/main.nf` declares
>   `memory { 6.B * fasta.size() }`. For the tiny test genome (~a few KB) this evaluates to a few
>   KB, and HealthOmics rejects any task requesting **less than 1 GiB** with
>   `INVALID_TASK_RESOURCE_VALUE` ("... less than the minimum value of 1"). The floor makes the
>   request valid. The same pattern can bite any size-derived memory formula.
> - **Blocker #4 — MULTIQC container.** The Wave "pixi" image ships `multiqc` at
>   `/opt/wave/.pixi/envs/default/bin/multiqc` and relies on its `ENTRYPOINT` (`/bin/bash
>   /shell-hook.sh`) to activate the env and prepend it to `PATH`. **HealthOmics ignores the
>   container `ENTRYPOINT`** and runs the task command directly, so `PATH` never includes the pixi
>   bin → `multiqc: command not found`. The biocontainers image puts `multiqc` on `/usr/local/bin`
>   and needs no entrypoint hook. This likely affects **other pixi-based Wave images** too — prefer
>   biocontainers equivalents when a Wave image relies on an entrypoint hook.

---

## 4. Register the workflow

Package the pipeline (now including `conf/healthomics.config`) and register it. You can register
directly from a Git repository via a CodeConnection, or from an S3 zip. This guide uses the S3-zip
path (it avoids a Console OAuth step and keeps the definition in the same Region as the rest of the
infrastructure):

```bash
cd sarek-390
zip -qr /tmp/sarek-3.9.0.zip . -x "*.git*" ".git/*"
aws s3 cp /tmp/sarek-3.9.0.zip s3://<OUTPUT_BUCKET>/workflow-defs/sarek-3.9.0.zip --region <REGION>
```

Then create the workflow with the MCP tool `CreateAHOWorkflow`, passing:

- `definition_uri = s3://<OUTPUT_BUCKET>/workflow-defs/sarek-3.9.0.zip`
- `engine = NEXTFLOW`, `path_to_main = main.nf`, `storage_type = DYNAMIC`
- `container_registry_map = { ... }` from §2.4
- a **parameter template** (see §5 for the important `optional` detail)

Confirm the workflow reaches `ACTIVE` with `GetAHOWorkflow` — this validates that the definition
parses on 26.04.0 and the registry map is accepted.

### 4.1 Parameter template — make `input`/`outdir` optional if you use `-profile`

HealthOmics enforces **required** parameter-template entries at `StartRun` time, *before* Nextflow
runs — even if a profile would supply them. If `input` is required and you rely on `-profile test`
to provide it, StartRun fails:

```
ValidationException: Missing workflow parameters: input
```

So for the profile-driven test run, mark `input` and `outdir` **optional** in the template. A
minimal template:

```json
{
  "input":           { "description": "Samplesheet CSV (supplied by -profile test if omitted)", "optional": true },
  "outdir":          { "description": "Output dir — use /mnt/workflow/output/ on HealthOmics",   "optional": true },
  "genome":          { "description": "iGenomes key", "optional": true },
  "tools":           { "description": "Variant callers, e.g. strelka", "optional": true },
  "validate_params": { "description": "Enable/disable nf-schema param validation", "optional": true },
  "snpeff_cache":    { "description": "snpEff cache dir", "optional": true },
  "vep_cache":       { "description": "VEP cache dir", "optional": true }
}
```

---

## 5. Run the pipeline

### 5.1 The clean way — `engineSettings.profile`

HealthOmics forwards `engineSettings.profile` to Nextflow as `-profile`. This lets sarek's own
`conf/test.config` supply the samplesheet, genome, tools, and reference base paths — so you pass
only what the profile *doesn't* set. Because the MCP `StartAHORun` tool has no `engineSettings`
argument, use the CLI:

```bash
aws omics start-run --region <REGION> \
  --workflow-id <WORKFLOW_ID> --workflow-version-name v-profile \
  --workflow-type PRIVATE --role-arn <OMICS_RUN_ROLE_ARN> \
  --name sarek-3.9.0-profile-test \
  --output-uri s3://<OUTPUT_BUCKET>/healthomics-outputs/sarek-3.9.0-profile/ \
  --parameters '{"outdir":"/mnt/workflow/output/","validate_params":false}' \
  --engine-settings '{"profile":"test"}' \
  --storage-type DYNAMIC \
  --networking-mode VPC --configuration-name <VPC_CONFIG_NAME>
```

Two params still must be explicit (explicit run parameters override profile values):

- **`outdir = /mnt/workflow/output/`** — `test.config` doesn't set `outdir`, and on HealthOmics it
  **must** be this local export path, never an `s3://` URI. HealthOmics auto-exports everything
  written under `/mnt/workflow/output/` to the run's S3 output location. (Task output uses
  `publishDir '/mnt/workflow/pubdir'`.)
- **`validate_params = false`** — this disables nf-schema's eager parameter validation, which
  otherwise stat-checks the default `snpeff_cache`/`vep_cache` `s3://annotation-cache/...` prefixes
  and trips blocker #1. (The test uses `tools = strelka`, so no annotation cache is needed.)

### 5.2 The explicit way — replicate `test.config` params by hand

If you prefer not to depend on the profile (or your template keeps `input` required), pass the
test-profile values directly. This is more verbose but equivalent:

```bash
--parameters '{
  "input":"s3://<OUTPUT_BUCKET>/sarek390-test/samplesheet.csv",
  "outdir":"/mnt/workflow/output/",
  "genome":"testdata.nf-core.sarek",
  "tools":"strelka",
  "split_fastq":0,
  "validate_params":false,
  "igenomes_base":"https://raw.githubusercontent.com/nf-core/test-datasets/modules/data/",
  "modules_testdata_base_path":"https://raw.githubusercontent.com/nf-core/test-datasets/modules/data/",
  "bcftools_annotations":"https://raw.githubusercontent.com/nf-core/test-datasets/modules/data/genomics/sarscov2/illumina/vcf/test2.vcf.gz",
  "bcftools_annotations_tbi":"https://raw.githubusercontent.com/nf-core/test-datasets/modules/data/genomics/sarscov2/illumina/vcf/test2.vcf.gz.tbi"
}'
```

Here the samplesheet mirrors `tests/csv/3.0/fastq_single.csv` (columns
`patient,sex,status,sample,lane,fastq_1,fastq_2`) with FASTQ URLs pointing at the public
`nf-core/test-datasets` repo. Because those are HTTPS URLs, the run still needs VPC networking.

### 5.3 Monitor

```bash
aws omics get-run --id <RUN_ID> --region <REGION> \
  --query '{status:status,engineVersion:engineVersion,failureReason:failureReason}'

aws omics list-run-tasks --id <RUN_ID> --region <REGION> \
  --query 'items[].{name:name,status:status}'
```

On failure, the MCP `DiagnoseAHORunFailure` tool (or the CloudWatch `run/<id>/engine` log stream)
gives the real cause. `failureReason` is generic (`WORKFLOW_RUN_FAILED`); the manifest log's
`statusMessage` and the first non-SDK stack frame pinpoint the failing task and call site.

---

## 6. Verified results

Both run styles reach a clean `COMPLETED`:

| Run style | Engine | Tasks | Result | Output objects |
|---|---|---|---|---|
| Explicit params (§5.2) | 26.04.0 | 21/21 | `COMPLETED` | 349 |
| `profile=test` (§5.1)  | 26.04.0 | 23/23 | `COMPLETED` | 357 |

The `profile=test` run schedules a couple more tasks because `conf/test.config` enables extra QC.
Outputs (under the run's `runOutputUri`) include:

- `variant_calling/strelka/test/test.strelka.variants.vcf.gz` — the variant calls
- `preprocessing/recalibrated/test/test.recal.cram` — aligned, dup-marked, BQSR-recalibrated reads
- `multiqc/multiqc_report.html` — the aggregated QC report
- `pipeline_info/` — execution report, timeline, DAG, and a BCO provenance manifest

Tasks that ran successfully span the whole pipeline: `BWAMEM1_INDEX`, interval prep, `FASTQC`,
`BWAMEM1_MEM`, `GATK4_MARKDUPLICATES`, `GATK4_BASERECALIBRATOR`, `GATK4_APPLYBQSR`,
`STRELKA_SINGLE`, `BCFTOOLS_STATS`, `VCFTOOLS_*`, `MOSDEPTH`, `SAMTOOLS_STATS`, and `MULTIQC`.

---

## 7. Cross-checked against the AWS documentation

The AWS guide [*Nextflow workflow definition specifics*](https://docs.aws.amazon.com/omics/latest/dev/workflow-definition-nextflow.html)
corroborates the key decisions and adds a few operational notes worth knowing:

- **Plugins are pre-installed and pinned.** 26.04.0 ships `nf-schema@2.7.2`, `nf-core-utils@0.4.0`,
  `nf-prov@1.7.0`, `nf-fgbio@1.0.1`. *"You cannot retrieve additional plugins during a workflow
  run. HealthOmics ignores any other plugin versions that you specify in the `nextflow.config`
  file."* (This is also why older sarek that depends on `nf-validation` fails on 26.04.0 — that
  plugin isn't provided.)
- **`params.outdir` / exports.** Files written to `/mnt/workflow/output/` are exported to the run's
  S3 output; task output uses `publishDir '/mnt/workflow/pubdir'`. Confirms §5.1.
- **Profiles are supported** via `engineSettings.profile`, must be defined inside the workflow zip,
  and explicit run parameters override profile values. Confirms §5.1.
- **v2 parser** is the 26.04.0 default; `engineSettings.syntaxVersion = "v1"` opts back to legacy.
  sarek 3.9.0 needs no override.
- **Isolated network.** *"HealthOmics workflows run in an isolated network with no outbound internet
  access."* Task nodes reach the internet only through your VPC configuration's NAT — which is why
  §0 requires VPC networking to stage the GitHub-hosted test data.
- **Reports need `ps` in the container.** If you enable the `report`/`timeline`/`trace` observers,
  each task container must include `ps` (`procps`/`procps-ng`); otherwise Nextflow can't collect
  per-task metrics. Containers without a `container` directive use a HealthOmics default that
  already has `ps`.
- **DAG diagram formats.** `dag.file` as PDF/PNG/SVG needs Graphviz (not present); it falls back to
  a `.dot` file. Prefer `.html`, `.mmd`, or `.dot`.

The one thing the AWS Nextflow page does **not** document — and the two hardest blockers here — is
container handling for Seqera Wave images: that ECR pull-through cache can't cache
`community.wave.seqera.io`, and that Wave "pixi" images are incompatible with how HealthOmics
launches containers. Those (§2.2 and §3/blocker #4) were established empirically.

---

## 8. Reusable checklist for any nf-core pipeline on HealthOmics

1. **Match the engine.** Read `manifest.nextflowVersion`; a hard pin can force 26.04.0 (strict v2
   parser). Check whether the config is v2-clean or needs `syntaxVersion=v1`.
2. **Containers.** Pull-through cache for `quay.io`/Docker Hub images; **mirror** Seqera Wave images
   into private ECR and add `imageMappings`; then **set repository policies** on the manually
   created repos so `omics.amazonaws.com` can pull.
3. **Skip eager S3 validation.** Run with `validate_params=false` if the pipeline's schema
   `directory-path` defaults point at `s3://` prefixes.
4. **Floor resources.** Add a `conf/healthomics.config` for any task whose CPU/memory is computed
   from input size (can drop below the 1-GiB/1-CPU minimum).
5. **Fix entrypoint-dependent containers.** Override Wave "pixi" (or any entrypoint-hook) images to
   biocontainers equivalents, since HealthOmics ignores `ENTRYPOINT`.
6. **`outdir=/mnt/workflow/output/`**, never an `s3://` URI.
7. **Test cheaply.** Prefer `engineSettings.profile=test` (mark `input`/`outdir` optional in the
   template) with VPC networking for the GitHub-hosted test data.

---

## 9. References

- [nf-core/sarek 3.9.0](https://nf-co.re/sarek/3.9.0)
- [HealthOmics — Nextflow workflow definition specifics](https://docs.aws.amazon.com/omics/latest/dev/workflow-definition-nextflow.html)
- [HealthOmics — Nextflow version support](https://docs.aws.amazon.com/omics/latest/dev/workflows-lang-versions.html)
- [HealthOmics — engine settings (profile / syntaxVersion / engineVersion)](https://docs.aws.amazon.com/omics/latest/dev/starting-a-run.html#start-run-api-engine-settings)
- [HealthOmics — VPC networking](https://docs.aws.amazon.com/omics/latest/dev/workflows-vpc-networking.html)
- [HealthOmics — ECR pull-through cache for workflows](https://docs.aws.amazon.com/omics/latest/dev/workflows-ecr.html)
- [AWS HealthOmics MCP server](https://github.com/awslabs/mcp)
- [nf-schema plugin](https://github.com/nextflow-io/nf-schema)
- [Seqera strict (v2) syntax](https://docs.seqera.io/nextflow/strict-syntax)
