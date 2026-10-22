---
title: "AWS HealthOmics에서 nf-core/sarek 3.9.0 실행하기"
---

# AWS HealthOmics에서 nf-core/sarek 3.9.0 실행하기

이 가이드는 [HealthOmics MCP server](https://github.com/awslabs/mcp)와 AWS CLI를 사용하여
[nf-core/sarek](https://nf-co.re/sarek/3.9.0) 3.9.0 germline/somatic 변이 분석 파이프라인을
**AWS HealthOmics**에 등록하고 성공적으로 실행하는 데 필요한 모든 내용을 담고 있습니다.
이 문서는 `COMPLETED` 상태로 깔끔하게 완료된 end-to-end 실행 경험을 바탕으로 작성되었으며,
그 과정에서 만난 다섯 가지 블로커 각각의 근본 원인과 정확한 해결책을 다룹니다.

아래의 모든 결과는 `us-west-2`의 실제 실행에서 검증되었습니다. 계정 ID, VPC/서브넷/보안 그룹
ID, private 엔드포인트는 플레이스홀더로 대체되었습니다:

| Placeholder | 의미 |
|---|---|
| `<ACCOUNT_ID>` | 12자리 AWS 계정 ID |
| `<REGION>` | 실행하는 AWS 리전 (이 가이드에서는 `us-west-2` 사용) |
| `<OUTPUT_BUCKET>` | `<REGION>`에 소유한 S3 버킷 (정의, 입력, 출력용) |
| `<OMICS_RUN_ROLE_ARN>` | HealthOmics가 실행 시 assume하는 IAM 역할 |
| `<VPC_CONFIG_NAME>` | HealthOmics VPC 네트워킹 구성 (ACTIVE) |
| `<ECR>` | `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com` |

---

## TL;DR — 실제로 필요한 것

sarek 3.9.0은 `nextflowVersion = '!>=25.10.2'`를 고정하므로 HealthOmics는 **Nextflow 26.04.0**
엔진에서 실행됩니다. 깔끔한 실행을 위해서는 파이프라인 문서만으로는 파악하기 어려운 다섯 가지
독립적인 문제를 해결해야 했습니다:

| # | 증상 | 근본 원인 | 해결책 |
|---|---------|-----------|-----|
| 1 | 어떤 태스크도 실행되기 전에 `ValidationException ... StartRun: S3 object not found` 발생 | nf-schema가 기본 `snpeff_cache = 's3://annotation-cache/...'` 파라미터(스키마 `format: directory-path`)를 *stat*하여 검증할 때 HealthOmics S3 프로바이더가 non-object 키에서 예외를 던짐 | `validate_params = false`로 실행 |
| 2 | 컨테이너 해석 시 `ECR_PERMISSION_ERROR` 발생 | Wave 이미지가 **수동으로 생성된** ECR 레포지토리에 미러링되었으며, 이 레포지토리에는 `omics.amazonaws.com`의 pull 접근을 허용하는 **레포지토리 정책이 없음** | 미러링된 모든 레포지토리에 `set-repository-policy` 적용 |
| 3 | 2개 태스크 후 `INVALID_TASK_RESOURCE_VALUE` 발생 | `BWAMEM1_INDEX`가 `memory { 6.B * fasta.size() }`를 요청할 때 작은 테스트 게놈에서 **1 GiB 미만**의 값이 나와 HealthOmics 최솟값 기준에 미달 | `conf/healthomics.config`에서 리소스 하한값 설정 |
| 4 | 최종 태스크에서 `multiqc: command not found` 발생 | sarek의 MULTIQC 컨테이너는 **Seqera Wave "pixi" 이미지**로, 바이너리가 이미지 `ENTRYPOINT`를 통해서만 `PATH`에 추가되지만 HealthOmics는 이를 **무시** | MULTIQC를 `quay.io/biocontainers` 이미지로 오버라이드 |
| — | (3.9.0에서는 해당 없음) 설정 파싱 | 3.9.0은 엄격한 **v2 파서** 기반으로 작성됨 (26.04.0의 기본값) | `syntaxVersion=v1` 불필요 |

그리고 구조적인 사실 하나: **ECR pull-through cache는 `community.wave.seqera.io`를 지원하지 않습니다.**
sarek은 컨테이너의 절반가량을 이곳에서 가져오므로, 해당 이미지들은 수동으로 private ECR에 미러링해야 합니다.

최종 검증 결과: **23/23 태스크 `COMPLETED`** 완료, Strelka VCF, 재보정된 CRAM, 전체 MultiQC 리포트 생성.

---

## 0. 사전 요구사항

| 요구사항 | 비고 |
|---|---|
| AWS 계정 + HealthOmics 지원 리전 | 이 가이드에서는 `us-west-2` 사용 |
| **AWS CLI v2**, 최신 버전 | `omics start-run --engine-settings`를 지원해야 함 |
| **Docker** 실행 중, 여유 디스크 ~50 GB | Seqera Wave 이미지를 ECR에 미러링하기 위해 필요 |
| `git`, `zip` | 파이프라인 클론 및 패키징에 필요 |
| **HealthOmics 실행 역할** (`<OMICS_RUN_ROLE_ARN>`) | `omics.amazonaws.com` 신뢰; 권한은 §0.1 참조 |
| **VPC 네트워킹 구성** (`<VPC_CONFIG_NAME>`, ACTIVE) | private 서브넷 + NAT (GitHub에 호스팅된 테스트 데이터를 가져오기 위한 인터넷 출구 필요) |
| `AWSServiceRoleForHealthOmics` SLR | 최초 omics 사용 시 자동 생성 |

### 0.1 실행 역할 권한

HealthOmics가 실행 시 assume하는 역할에는 다음 권한이 필요합니다:

- **S3**: 워크플로우 정의 및 입력 읽기, 출력 위치 읽기+쓰기.
- **CloudWatch Logs**: `/aws/omics/*`에 쓰기.
- **ECR**: `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`,
  `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage` (캐시/미러링된 이미지용).

> 참고: HealthOmics는 **서비스 주체(service principal)**로서 각 ECR 레포지토리의
> *리소스 정책*을 통해 컨테이너 이미지를 pull합니다 — 실행 역할만으로는 충분하지 않습니다.
> 이 차이가 블로커 #2(§4)의 근본 원인입니다.

### 0.2 HealthOmics MCP 서버 구성

MCP 서버는 에이전트 기반 워크플로우를 위해 HealthOmics API를 래핑합니다. 온보딩 시
다음과 같은 소규모 설정 파일이 생성됩니다:

```toml
# .healthomics/config.toml
omics_iam_role  = "<OMICS_RUN_ROLE_ARN>"
run_output_uri  = "s3://<OUTPUT_BUCKET>/healthomics-outputs/"
run_storage_type = "DYNAMIC"
```

MCP 서버는 `uvx awslabs.aws-healthomics-mcp-server@latest`로 실행됩니다. 워크플로우
생성(`CreateAHOWorkflow`, `CreateAHOWorkflowVersion`), 실행(`StartAHORun`, `GetAHORun`,
`ListAHORunTasks`), 진단(`DiagnoseAHORunFailure`), 컨테이너/ECR 헬퍼
(`CreatePullThroughCacheForHealthOmics`, `CreateContainerRegistryMap`,
`ValidateHealthOmicsECRConfig`) 도구를 제공합니다.

> **사전에 알아야 할 MCP 제한 사항:** `StartAHORun` 도구에는 **`engineSettings` 인수가 없습니다**.
> `-profile` 또는 `syntaxVersion`을 전달하려면 AWS CLI(`aws omics start-run --engine-settings`)를
> 사용하세요. 나머지는 모두 MCP 도구를 통해 처리할 수 있습니다.

---

## 1. HealthOmics를 시작하기 전에 파이프라인 이해하기

sarek 3.9.0에 관한 몇 가지 사실이 이후의 모든 결정에 영향을 미칩니다. 기억에 의존하지 말고
소스에서 직접 확인하세요:

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

핵심 사항:

- **엔진**: `!>=25.10.2`는 강제 버전 고정입니다. HealthOmics가 지원하는 버전
  (`22.04.01 / 23.10.0 / 24.10.8 / 25.10.0 / 26.04.0`) 중 **26.04.0**만 조건을 충족합니다.
  26.04.0은 **엄격한 (v2) 문법 파서**를 기본값으로 사용합니다.
- **v2 파서 호환성**: sarek 3.8.1(`if () {}` 블록 안에 `withName` 셀렉터를 중첩시켜
  `syntaxVersion=v1`이 필요했음)과 달리, sarek 3.9.0의 설정은 v2 호환 — 229개의 `withName`
  셀렉터가 모두 `process {}` 최상위에 있으며 `if ()`는 클로저(`ext.args = { ... }`) 내부에만
  등장합니다. **`syntaxVersion` 오버라이드가 필요하지 않습니다.**
- **컨테이너는 두 레지스트리에 걸쳐 있습니다**:
  - `quay.io/biocontainers/*` — 익명 pull 가능; ECR **pull-through cache**를 통해 사용 가능.
  - `community.wave.seqera.io/library/*` (Seqera Wave) — **~27개 이미지**; ECR PTC는 이
    업스트림을 **지원하지 않으므로**, private ECR에 **수동으로 미러링**해야 합니다.
- **테스트 프로파일은 HTTPS를 통해 소규모 공개 데이터를 사용합니다**: `conf/test.config`는
  `genome = 'testdata.nf-core.sarek'`을 설정하고 `input` / `igenomes_base`를
  `https://raw.githubusercontent.com/nf-core/test-datasets/...`로 지정합니다. 이는 크로스 리전
  iGenomes(`s3://ngi-igenomes`, eu-west-1) 문제를 의도적으로 피하지만, `raw.githubusercontent.com`에
  접근하려면 여전히 **NAT egress가 있는 VPC 네트워킹**이 필요합니다.

---

## 2. 컨테이너 전략 (가장 어려운 부분)

HealthOmics는 **동일 계정 및 리전의 private ECR**에서만 태스크 컨테이너를 pull합니다. sarek의
컨테이너는 업스트림에 있으므로, 두 가지 방법으로 연결합니다.

### 2.1 quay.io/biocontainers → ECR pull-through cache

MCP 도구는 캐시 규칙을 생성하고 *동시에* HealthOmics 권한(레지스트리 정책 + 레포지토리 생성
템플릿)을 한 번의 호출로 설정합니다:

```
CreatePullThroughCacheForHealthOmics(upstream_registry="quay", ecr_repository_prefix="quay")
```

이후 모든 `quay.io/biocontainers/foo:tag`는 `<ECR>/quay/biocontainers/foo:tag`에서 접근할 수
있으며, 캐시가 자동 생성한 레포지토리는 생성 템플릿에서 omics pull 정책을 **자동 상속**합니다.

### 2.2 community.wave.seqera.io → ECR에 수동 미러링

ECR pull-through cache는 `community.wave.seqera.io`를 **거부합니다**:

```
UnsupportedUpstreamRegistryException: The upstream registry URL
community.wave.seqera.io is invalid.
```

따라서 각 Wave 이미지를 Docker로 미러링합니다. 먼저 파이프라인이 참조하는 이미지를 정확히
열거하여 필요한 것만 미러링합니다:

```bash
git clone --depth 1 --branch 3.9.0 https://github.com/nf-core/sarek.git sarek-390
cd sarek-390
grep -rhoE "community\.wave\.seqera\.io/library/[^'\"]+" modules/ \
  | grep -v '/data$' | sort -u > /tmp/wave_images.txt
wc -l /tmp/wave_images.txt      # 27 references (25 distinct Docker images; see note below)
```

그런 다음 pull → retag → push 순서로 `community.wave.seqera.io/library/...`를
`wave/library/...`로 평탄화합니다:

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

미러링된 23개의 레포지토리(일부는 여러 태그 포함)는 다음과 같습니다:

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

> **두 개의 Wave multiqc 태그는** Docker로 pull되지 않습니다 — 이는 **Singularity SIF**
> 아티팩트(`application/vnd.sylabs.sif.config.v1+json`)이기 때문입니다. 예상된 동작으로,
> HealthOmics는 Docker/OCI 이미지를 실행하며 MULTIQC 모듈의 Docker 경로는 다른 태그를 사용합니다.
> SIF 태그는 건너뛰세요.

### 2.3 미러링된 레포지토리에 `omics.amazonaws.com` pull 접근 권한 부여 (블로커 #2)

이 부분이 미묘합니다. `aws ecr create-repository`로 생성한 레포지토리에는 **레포지토리 정책이
없으므로**, 이미지가 존재하고 실행 역할에 ECR 권한이 있더라도 HealthOmics 서비스 주체가 pull하지
못해 `ECR_PERMISSION_ERROR`로 실행이 실패합니다. (*pull-through cache*가 생성한 레포지토리는
생성 템플릿에서 이 정책을 자동으로 받지만, 수동 생성 레포지토리는 그렇지 않습니다.) 미러링된
모든 레포지토리에 동일한 정책을 적용합니다:

```bash
POLICY='{"Version":"2012-10-17","Statement":[{"Sid":"omics workflow access",
  "Effect":"Allow","Principal":{"Service":"omics.amazonaws.com"},
  "Action":["ecr:GetDownloadUrlForLayer","ecr:BatchGetImage","ecr:BatchCheckLayerAvailability"]}]}'

for R in $(aws ecr describe-repositories --region <REGION> \
    --query 'repositories[?starts_with(repositoryName,`wave/`)].repositoryName' --output text); do
  aws ecr set-repository-policy --repository-name "$R" --region <REGION> --policy-text "$POLICY"
done
```

### 2.4 컨테이너 레지스트리 맵

워크플로우는 HealthOmics에게 업스트림 이미지 참조를 ECR로 재작성하는 방법을 알려주는 맵이
필요합니다:

- **`registryMappings`** — pull-through cache의 접두사 재작성(`quay.io` → `quay`).
- **`imageMappings`** — 미러링된 Wave 이미지에 대한 이미지별 명시적 재작성.

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

`registryMappings` 부분은 MCP 도구 `CreateContainerRegistryMap`으로 발견된 pull-through cache에서
자동 생성할 수 있으며, 미러 목록에서 생성한 Wave `imageMappings`를 이어 붙이면 됩니다. ECR 구성은
언제든지 `ValidateHealthOmicsECRConfig`로 검증할 수 있습니다.

---

## 3. HealthOmics 호환성 설정

두 가지 파이프라인 동작이 HealthOmics와 호환되지 않으며, 워크플로우에 포함된 소규모 추가 설정
파일로 해결하는 것이 가장 좋습니다. `conf/healthomics.config`를 생성합니다:

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

`nextflow.config`에 한 줄을 추가하여 파이프라인에 연결합니다:

```bash
printf "\n// AWS HealthOmics resource floors + container overrides\nincludeConfig 'conf/healthomics.config'\n" >> nextflow.config
```

> **왜 이 두 가지인가**
>
> - **블로커 #3 — 리소스 하한값.** `modules/nf-core/bwa/index/main.nf`는
>   `memory { 6.B * fasta.size() }`를 선언합니다. 작은 테스트 게놈(~수 KB)에서는 수 KB로
>   평가되어 HealthOmics가 `INVALID_TASK_RESOURCE_VALUE`("... less than the minimum value of 1")로
>   **1 GiB 미만**을 요청하는 태스크를 거부합니다. 하한값 설정으로 요청이 유효해집니다. 이 패턴은
>   입력 크기 기반 메모리 수식이 있는 경우에도 동일하게 발생할 수 있습니다.
> - **블로커 #4 — MULTIQC 컨테이너.** Wave "pixi" 이미지는 `multiqc`를
>   `/opt/wave/.pixi/envs/default/bin/multiqc`에 배치하고, `ENTRYPOINT`(`/bin/bash
>   /shell-hook.sh`)를 통해 환경을 활성화하고 `PATH`에 추가합니다. **HealthOmics는 컨테이너
>   `ENTRYPOINT`를 무시하고** 태스크 명령을 직접 실행하므로, `PATH`에 pixi 바이너리가 포함되지
>   않아 `multiqc: command not found`가 발생합니다. biocontainers 이미지는 `multiqc`를
>   `/usr/local/bin`에 배치하므로 entrypoint 훅이 필요 없습니다. 이 문제는 **다른 pixi 기반 Wave
>   이미지**에도 동일하게 적용될 가능성이 높습니다 — Wave 이미지가 entrypoint 훅에 의존하는 경우
>   biocontainers 동등 이미지를 선호하세요.

---

## 4. 워크플로우 등록

파이프라인(`conf/healthomics.config` 포함)을 패키징하고 등록합니다. CodeConnection을 통해 Git
레포지토리에서 직접 등록하거나 S3 zip에서 등록할 수 있습니다. 이 가이드는 S3-zip 방식을 사용합니다
(Console OAuth 단계를 생략하고 나머지 인프라와 동일한 리전에 정의를 보관할 수 있음):

```bash
cd sarek-390
zip -qr /tmp/sarek-3.9.0.zip . -x "*.git*" ".git/*"
aws s3 cp /tmp/sarek-3.9.0.zip s3://<OUTPUT_BUCKET>/workflow-defs/sarek-3.9.0.zip --region <REGION>
```

그런 다음 MCP 도구 `CreateAHOWorkflow`로 워크플로우를 생성하며, 다음을 전달합니다:

- `definition_uri = s3://<OUTPUT_BUCKET>/workflow-defs/sarek-3.9.0.zip`
- `engine = NEXTFLOW`, `path_to_main = main.nf`, `storage_type = DYNAMIC`
- `container_registry_map = { ... }` (§2.4 참조)
- **파라미터 템플릿** (`optional` 세부 사항은 §5 참조)

`GetAHOWorkflow`로 워크플로우가 `ACTIVE` 상태에 도달하는지 확인합니다 — 이는 정의가 26.04.0에서
파싱되고 레지스트리 맵이 수락되었음을 검증합니다.

### 4.1 파라미터 템플릿 — `-profile` 사용 시 `input`/`outdir`을 optional로 설정

HealthOmics는 **required** 파라미터 템플릿 항목을 `StartRun` 시점에, Nextflow 실행 *이전*에
강제 확인합니다 — 프로파일이 값을 제공할 예정이더라도 마찬가지입니다. `input`이 required이고
`-profile test`에 의존한다면 StartRun이 실패합니다:

```
ValidationException: Missing workflow parameters: input
```

프로파일 기반 테스트 실행을 위해 템플릿에서 `input`과 `outdir`을 **optional**로 표시합니다.
최소한의 템플릿:

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

## 5. 파이프라인 실행

### 5.1 깔끔한 방법 — `engineSettings.profile`

HealthOmics는 `engineSettings.profile`을 Nextflow에 `-profile`로 전달합니다. 이를 통해 sarek의
`conf/test.config`가 샘플시트, 게놈, 도구, 참조 기본 경로를 제공하므로 프로파일이 *설정하지
않는* 것만 전달하면 됩니다. MCP `StartAHORun` 도구에는 `engineSettings` 인수가 없으므로 CLI를
사용합니다:

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

두 파라미터는 여전히 명시적으로 지정해야 합니다(명시적 실행 파라미터가 프로파일 값을 오버라이드함):

- **`outdir = /mnt/workflow/output/`** — `test.config`는 `outdir`을 설정하지 않으며, HealthOmics에서는
  이 로컬 export 경로여야만 합니다(`s3://` URI는 불가). HealthOmics는 `/mnt/workflow/output/` 아래에
  작성된 모든 파일을 자동으로 실행의 S3 출력 위치로 export합니다. (태스크 출력에는
  `publishDir '/mnt/workflow/pubdir'`을 사용합니다.)
- **`validate_params = false`** — nf-schema의 즉각적인 파라미터 검증을 비활성화합니다. 이 검증은
  기본 `snpeff_cache`/`vep_cache` `s3://annotation-cache/...` 접두사를 stat 확인하여 블로커 #1을
  유발합니다. (테스트는 `tools = strelka`를 사용하므로 annotation cache가 필요하지 않습니다.)

### 5.2 명시적 방법 — `test.config` 파라미터를 직접 복제

프로파일에 의존하지 않으려 하거나(또는 템플릿에서 `input`을 required로 유지하는 경우), 테스트
프로파일 값을 직접 전달합니다. 더 장황하지만 동일한 결과입니다:

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

여기서 샘플시트는 `tests/csv/3.0/fastq_single.csv`(`patient,sex,status,sample,lane,fastq_1,fastq_2`
열)를 미러링하며 FASTQ URL은 공개 `nf-core/test-datasets` 레포지토리를 가리킵니다. HTTPS URL이므로
실행에는 여전히 VPC 네트워킹이 필요합니다.

### 5.3 모니터링

```bash
aws omics get-run --id <RUN_ID> --region <REGION> \
  --query '{status:status,engineVersion:engineVersion,failureReason:failureReason}'

aws omics list-run-tasks --id <RUN_ID> --region <REGION> \
  --query 'items[].{name:name,status:status}'
```

실패 시, MCP `DiagnoseAHORunFailure` 도구(또는 CloudWatch `run/<id>/engine` 로그 스트림)에서
실제 원인을 확인할 수 있습니다. `failureReason`은 일반적인(`WORKFLOW_RUN_FAILED`) 내용이며,
manifest 로그의 `statusMessage`와 첫 번째 비-SDK 스택 프레임이 실패한 태스크와 호출 위치를
정확히 가리킵니다.

---

## 6. 검증된 결과

두 실행 방식 모두 `COMPLETED`로 깔끔하게 완료됩니다:

| 실행 방식 | 엔진 | 태스크 | 결과 | 출력 오브젝트 수 |
|---|---|---|---|---|
| 명시적 파라미터 (§5.2) | 26.04.0 | 21/21 | `COMPLETED` | 349 |
| `profile=test` (§5.1)  | 26.04.0 | 23/23 | `COMPLETED` | 357 |

`profile=test` 실행은 `conf/test.config`가 추가 QC를 활성화하므로 몇 가지 태스크가 더 예약됩니다.
출력물(실행의 `runOutputUri` 아래)에는 다음이 포함됩니다:

- `variant_calling/strelka/test/test.strelka.variants.vcf.gz` — 변이 호출 결과
- `preprocessing/recalibrated/test/test.recal.cram` — 정렬, 중복 표시, BQSR 재보정된 리드
- `multiqc/multiqc_report.html` — 통합 QC 리포트
- `pipeline_info/` — 실행 리포트, 타임라인, DAG, BCO 출처 매니페스트

성공적으로 실행된 태스크는 전체 파이프라인에 걸쳐 있습니다: `BWAMEM1_INDEX`, interval prep,
`FASTQC`, `BWAMEM1_MEM`, `GATK4_MARKDUPLICATES`, `GATK4_BASERECALIBRATOR`, `GATK4_APPLYBQSR`,
`STRELKA_SINGLE`, `BCFTOOLS_STATS`, `VCFTOOLS_*`, `MOSDEPTH`, `SAMTOOLS_STATS`, `MULTIQC`.

---

## 7. AWS 문서와의 교차 검증

AWS 가이드 [*Nextflow workflow definition specifics*](https://docs.aws.amazon.com/omics/latest/dev/workflow-definition-nextflow.html)는
핵심 결정 사항을 뒷받침하며 알아둘 만한 운영 메모를 몇 가지 추가합니다:

- **플러그인은 사전 설치 및 고정됩니다.** 26.04.0은 `nf-schema@2.7.2`, `nf-core-utils@0.4.0`,
  `nf-prov@1.7.0`, `nf-fgbio@1.0.1`을 제공합니다. *"워크플로우 실행 중 추가 플러그인을 가져올
  수 없습니다. HealthOmics는 `nextflow.config` 파일에 지정된 다른 플러그인 버전을 무시합니다."*
  (이는 `nf-validation`에 의존하는 구버전 sarek이 26.04.0에서 실패하는 이유이기도 합니다 —
  해당 플러그인은 제공되지 않습니다.)
- **`params.outdir` / export.** `/mnt/workflow/output/`에 작성된 파일은 실행의 S3 출력으로
  export됩니다. 태스크 출력에는 `publishDir '/mnt/workflow/pubdir'`을 사용합니다. §5.1을
  확인합니다.
- **프로파일은 지원됩니다** — `engineSettings.profile`을 통해, 워크플로우 zip 내부에 정의되어야
  하며, 명시적 실행 파라미터가 프로파일 값을 오버라이드합니다. §5.1을 확인합니다.
- **v2 파서**는 26.04.0의 기본값입니다. `engineSettings.syntaxVersion = "v1"`으로 레거시로
  되돌릴 수 있습니다. sarek 3.9.0에는 오버라이드가 필요 없습니다.
- **격리된 네트워크.** *"HealthOmics 워크플로우는 외부 인터넷 접근이 없는 격리된 네트워크에서
  실행됩니다."* 태스크 노드는 VPC 구성의 NAT를 통해서만 인터넷에 접근할 수 있습니다 — 이것이
  §0에서 GitHub에 호스팅된 테스트 데이터를 준비하기 위해 VPC 네트워킹이 필요한 이유입니다.
- **리포트에는 컨테이너 내 `ps`가 필요합니다.** `report`/`timeline`/`trace` 옵저버를 활성화하는
  경우, 각 태스크 컨테이너에 `ps`(`procps`/`procps-ng`)가 포함되어야 합니다. 그렇지 않으면
  Nextflow가 태스크별 메트릭을 수집할 수 없습니다. `container` 디렉티브가 없는 컨테이너는 `ps`가
  이미 포함된 HealthOmics 기본값을 사용합니다.
- **DAG 다이어그램 형식.** `dag.file`을 PDF/PNG/SVG로 사용하려면 Graphviz가 필요합니다(포함되지
  않음). `.dot` 파일로 폴백됩니다. `.html`, `.mmd`, `.dot`를 권장합니다.

AWS Nextflow 페이지가 **문서화하지 않은 한 가지** — 그리고 여기서 가장 어려운 두 가지 블로커 —
는 Seqera Wave 이미지의 컨테이너 처리입니다: ECR pull-through cache가 `community.wave.seqera.io`를
캐시할 수 없다는 점, 그리고 Wave "pixi" 이미지가 HealthOmics의 컨테이너 실행 방식과 호환되지
않는다는 점입니다. 이 사실들(§2.2 및 §3/블로커 #4)은 실험을 통해 확인되었습니다.

---

## 8. HealthOmics에서 모든 nf-core 파이프라인에 재사용 가능한 체크리스트

1. **엔진 맞추기.** `manifest.nextflowVersion`을 확인합니다. 강제 고정으로 인해 26.04.0(엄격한
   v2 파서)이 요구될 수 있습니다. 설정이 v2 호환인지 아니면 `syntaxVersion=v1`이 필요한지
   확인합니다.
2. **컨테이너.** `quay.io`/Docker Hub 이미지는 pull-through cache 사용; Seqera Wave 이미지는
   private ECR에 **미러링**하고 `imageMappings` 추가; 그런 다음 수동으로 생성한 레포지토리에
   **레포지토리 정책 설정**하여 `omics.amazonaws.com`이 pull할 수 있도록 합니다.
3. **즉각적인 S3 검증 건너뛰기.** 파이프라인 스키마의 `directory-path` 기본값이 `s3://` 접두사를
   가리키는 경우 `validate_params=false`로 실행합니다.
4. **리소스 하한값 설정.** CPU/메모리가 입력 크기에서 계산되어 1-GiB/1-CPU 최솟값 이하로 떨어질
   수 있는 태스크에 대해 `conf/healthomics.config`를 추가합니다.
5. **ENTRYPOINT 의존 컨테이너 수정.** HealthOmics가 `ENTRYPOINT`를 무시하므로, Wave "pixi"(또는
   entrypoint 훅을 사용하는 이미지)를 biocontainers 동등 이미지로 오버라이드합니다.
6. **`outdir=/mnt/workflow/output/`** — `s3://` URI는 절대 사용하지 않습니다.
7. **저렴하게 테스트합니다.** `engineSettings.profile=test`(템플릿에서 `input`/`outdir`을
   optional로 표시)와 GitHub에 호스팅된 테스트 데이터용 VPC 네트워킹을 조합하는 것을 권장합니다.

---

## 9. 참고 자료

- [nf-core/sarek 3.9.0](https://nf-co.re/sarek/3.9.0)
- [HealthOmics — Nextflow workflow definition specifics](https://docs.aws.amazon.com/omics/latest/dev/workflow-definition-nextflow.html)
- [HealthOmics — Nextflow version support](https://docs.aws.amazon.com/omics/latest/dev/workflows-lang-versions.html)
- [HealthOmics — engine settings (profile / syntaxVersion / engineVersion)](https://docs.aws.amazon.com/omics/latest/dev/starting-a-run.html#start-run-api-engine-settings)
- [HealthOmics — VPC networking](https://docs.aws.amazon.com/omics/latest/dev/workflows-vpc-networking.html)
- [HealthOmics — ECR pull-through cache for workflows](https://docs.aws.amazon.com/omics/latest/dev/workflows-ecr.html)
- [AWS HealthOmics MCP server](https://github.com/awslabs/mcp)
- [nf-schema plugin](https://github.com/nextflow-io/nf-schema)
- [Seqera strict (v2) syntax](https://docs.seqera.io/nextflow/strict-syntax)
