---
title: "Lessons Learned: WARP ExomeGermlineSingleSample → AWS HealthOmics 마이그레이션"
---

# Lessons Learned: WARP ExomeGermlineSingleSample → AWS HealthOmics 마이그레이션

## 요약

Broad Institute의 WARP (Workflow Analysis Research Pipelines) `ExomeGermlineSingleSample v3.2.7`을 AWS HealthOmics에 성공적으로 배포하고 실행하였다. 14개 WDL 파일로 구성된 GATK Best Practices 파이프라인을 GCP/Azure 전용 환경에서 HealthOmics RESTRICTED 모드로 포팅하는 과정에서 발생한 문제와 해결 방법을 정리한다.

> **⚠️ 범위 안내**: 이 문서는 워크플로우의 **배포 및 실행 성공(파이프라인 이식성, 런 완료)** 관점에서의 마이그레이션 경험만을 다룹니다. **산출된 결과 데이터(GVCF, CRAM, QC metrics 등)의 정확성·생물학적 유효성에 대한 검증은 포함하지 않습니다.** 결과 데이터의 정합성 검증은 별도의 검증 절차를 통해 수행되어야 합니다.

---

## 워크플로우 등록 과정

### Step 1: WDL 번들 다운로드 및 구조 파악

```
ExomeGermlineSingleSample.wdl (메인)
├── UnmappedBamToAlignedBam.wdl
├── AggregatedBamQC.wdl
├── BamProcessing.wdl
├── BamToCram.wdl
├── VariantCalling.wdl
├── GermlineVariantDiscovery.wdl
├── Alignment.wdl
├── DragmapAlignment.wdl
├── SplitLargeReadGroup.wdl
├── DragenTasks.wdl
├── Qc.wdl
├── Utilities.wdl
└── DNASeqStructs.wdl
```

### Step 2: 컨테이너 이미지 ECR 미러링

GCR (Google Container Registry) 이미지는 ECR Pull-Through Cache를 지원하지 않으므로, `crane`으로 직접 복사:

```bash
crane copy "us.gcr.io/broad-gatk/gatk:4.6.1.0" \
  "<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/broad-gatk/gatk:4.6.1.0"
```

미러링한 이미지 (8개):

| 원본 (GCR) | 용도 |
|------------|------|
| `broad-gatk/gatk:4.6.1.0` | GATK 4.6 (메인 도구) |
| `broad-gotc-prod/picard-cloud:2.26.10` | Picard tools |
| `broad-gotc-prod/picard-python:1.0.0-2.26.10` | Picard + Python |
| `broad-gotc-prod/samtools-picard-bwa:1.0.2-0.7.15-2.26.10` | BWA + samtools + picard |
| `broad-gotc-prod/verify-bam-id:1.0.1` | VerifyBamID (contamination check) |
| `broad-gotc-prod/gatk:1.3.0-4.2.6.1` | GATK 3.5 (legacy HaplotypeCaller) |
| `broad-gotc-prod/bedtools:2.27.1` | bedtools (interval operations) |
| `biocontainers/samtools:1.3.1` | samtools (Docker Hub) |

각 리포지토리에 HealthOmics 서비스 프린시펄 접근 권한 부여:

```json
{
  "Principal": {"Service": "omics.amazonaws.com"},
  "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
}
```

### Step 3: WDL Docker URI 치환

모든 `us.gcr.io/...` → `{account}.dkr.ecr.{region}.amazonaws.com/...` 일괄 치환.

### Step 4: ZIP 패키징 구조

**핵심**: HealthOmics는 **최상위에 메인 WDL 1개만** 허용. 나머지는 서브디렉토리에 배치:

```
ExomeGermlineSingleSample.wdl          ← 최상위 (유일)
tasks/
  ├── UnmappedBamToAlignedBam.wdl
  ├── BamProcessing.wdl
  ├── ...
```

메인 WDL의 import를 `"tasks/"` 접두사로 변경:

```wdl
import "tasks/UnmappedBamToAlignedBam.wdl" as ToBam
```

서브 WDL들 간의 import는 같은 디렉토리 내이므로 변경 불필요.

### Step 5: HealthOmics 워크플로우 생성

```bash
aws omics create-workflow \
  --name "ExomeGermlineSingleSample-v3.2.7" \
  --engine WDL_LENIENT \
  --definition-zip "fileb://path/to/bundle.zip" \
  --storage-type DYNAMIC
```

`WDL_LENIENT` 엔진을 사용한 이유: Cromwell에서 사용하는 비표준 WDL 패턴 호환.

### Step 6: 참조 데이터 준비

| 데이터 소스 | 위치 | VPC 필요? |
|------------|------|-----------|
| `s3://broad-references/hg38/v0/` (AWS Open Data) | us-east-1 | ❌ |
| `s3://gatk-test-data/` (AWS) | us-east-1 | ❌ |
| GCS에서 복사한 파일 (haplotype DB, intervals 등) | 자체 S3 버킷 | ❌ |

### Step 7: 입력 JSON 형식

HealthOmics는 **네임스페이스 접두사 없이** 파라미터 전달:

```json
// ❌ Cromwell 스타일
{"ExomeGermlineSingleSample.references": {...}}

// ✅ HealthOmics 스타일
{"references": {...}}
```

### Step 8: 런 시작

```bash
aws omics start-run \
  --workflow-id <WORKFLOW_ID> \
  --workflow-version-name v6 \
  --storage-type DYNAMIC \
  --scratch-storage-mode LOCAL \
  --parameters file://test-inputs.json
```

---

## 발견한 문제와 해결 방법

### Issue 1: 최상위 WDL 파일 제한

**증상**: `"Zip file contains multiple top-level workflow definition files"`

**원인**: HealthOmics는 ZIP 최상위에 `.wdl` 파일이 1개만 있어야 함.

**해결**: 메인 WDL만 최상위, 나머지는 `tasks/` 서브디렉토리로 이동 + import 경로 수정.

---

### Issue 2: 컨테이너 도구 경로 불일치

**증상**: `/app/bedtools: No such file or directory`

**원인**: `GenerateSubsettedContaminationResources` 태스크가 `/app/bedtools`를 실행하는데, 이 경로는 `broad-gotc-prod/bedtools:2.27.1` 이미지에만 존재. GATK 이미지로 잘못 대체했음.

**해결**: 태스크별로 필요한 도구 경로를 분석하여 올바른 컨테이너에 매핑:

| 도구 경로 | 올바른 컨테이너 |
|-----------|----------------|
| `/app/bedtools` | `broad-gotc-prod/bedtools:2.27.1` |
| `/usr/gitc/bwa`, `/usr/gitc/picard.jar` | `broad-gotc-prod/samtools-picard-bwa` |
| `/usr/gitc/VerifyBamID` | `broad-gotc-prod/verify-bam-id` |
| `/usr/gitc/gatk4/gatk`, `/usr/gitc/GATK35.jar` | `broad-gotc-prod/gatk:1.3.0` |
| `gatk` (standalone) | `broad-gatk/gatk:4.6.1.0` |

**교훈**: Docker 이미지를 범용 이미지로 대체할 때, 태스크의 실제 바이너리 경로를 반드시 확인할 것.

---

### Issue 3: Java 17 호환성 — deprecated GC 옵션

**증상**: `Unrecognized VM option 'PrintGCTimeStamps'` → JVM 시작 실패

**원인**: GATK 4.6.1.0 이미지는 Java 17 사용. Java 17에서 제거된 GC 로깅 옵션:

- `-XX:+PrintGCTimeStamps`
- `-XX:+PrintGCDateStamps`
- `-XX:+PrintGCDetails`
- `-XX:+PrintFlagsFinal`
- `-Xloggc:gc_log.log`

**해결**: BamProcessing.wdl에서 해당 옵션 제거. GC 로깅은 진단 목적이므로 기능에 영향 없음.

**교훈**: 컨테이너 이미지 버전 업그레이드 시 Java 버전 호환성 확인 필수. GATK 4.5+ 는 Java 17.

---

### Issue 4: Python 인덴트 파괴

**증상**: `IndentationError: expected an indented block after 'with' statement`

**원인**: `sed 's/  */ /g'`로 연속 공백을 단일 공백으로 치환 → WDL 내 Python heredoc의 인덴트 파괴.

**해결**: 공백 정리를 하지 않고, 정확한 패턴만 매칭하여 치환.

**교훈**: WDL 파일 내에 Python/bash heredoc이 포함되어 있으므로, 전역 공백 치환은 절대 금물. 정밀 타겟팅만 사용.

---

### Issue 5: bash associative array 문법 에러

**증상**: `syntax error: invalid arithmetic operator (error token is ".gcr.io/...")`

**원인**: bash associative array의 key에 `.`과 `/`가 포함되면 산술 연산자로 해석됨.

**해결**: associative array 대신 `sed -e` 다중 옵션으로 일괄 치환.

**교훈**: 도커 URI처럼 특수문자가 많은 문자열은 bash associative array 키로 부적합. 단순 sed 방식이 안전.

---

### Issue 6: HealthOmics 파라미터 네임스페이스

**증상**: `Missing and unexpected workflow parameters: ExomeGermlineSingleSample.references...`

**원인**: Cromwell은 `WorkflowName.param` 형식을 허용하지만, HealthOmics는 워크플로우 입력 이름만 사용.

**해결**: 입력 JSON에서 `ExomeGermlineSingleSample.` 접두사 제거.

---

### Issue 7: Cromwell task-level override 미지원

**증상**: `Unexpected workflow parameters: disable_sanity_check`

**원인**: Cromwell에서는 `Workflow.SubWorkflow.Task.input` 형식으로 task-level 입력을 override 가능하지만, HealthOmics는 최상위 워크플로우 입력만 지원.

**해결**: task-level override 파라미터를 입력 JSON에서 제거.

---

## 핵심 체크리스트: WARP/Cromwell WDL → HealthOmics

- [ ] ZIP 구조: 메인 WDL 1개만 최상위, 나머지 서브디렉토리
- [ ] Docker URI: 모든 GCR/Azure → ECR (HealthOmics 서비스 접근 정책 포함)
- [ ] 컨테이너 도구 경로: 태스크별 실제 바이너리 위치 확인
- [ ] Java 옵션: Java 17 호환 확인 (GATK 4.5+)
- [ ] Python/bash heredoc: 공백 치환 시 인덴트 보존
- [ ] 입력 JSON: 네임스페이스 접두사 제거
- [ ] Task-level override: 제거 (미지원)
- [ ] cloud_provider: 기본값 설정 또는 제거
- [ ] S3 버킷 리전: HealthOmics와 동일 리전이면 VPC 불필요, 다르면 VPC Configuration 필요
- [ ] 퍼블릭 S3 버킷: IAM role에 해당 버킷 읽기 권한 추가
- [ ] WDL 엔진: `WDL_LENIENT` 사용 (Cromwell 호환성)
- [ ] Storage: `DYNAMIC` + `scratchStorageMode: LOCAL` 권장

---

## 최종 결과

> 아래 결과는 **워크플로우가 정상적으로 실행 완료(run succeeded)**되었음을 의미하며, **산출된 결과 데이터의 정확성 검증은 포함하지 않습니다.**

| 항목 | 값 |
|------|---|
| Engine | `WDL_LENIENT` |
| Version | `v6` |
| 총 소요 시간 | ~72분 |
| 총 태스크 | ~60개 (scatter 포함) |
| 입력 데이터 | NA12878 downsampled uBAM (~600MB) |
| 출력 | GVCF + CRAM + QC metrics |

---

## 사용한 도구

| 도구 | 용도 |
|------|------|
| `crane` (go-containerregistry) | Docker 이미지 GCR→ECR 복사 (docker daemon 불필요) |
| HealthOmics MCP | 워크플로우 생성/배포/런 실행/디버깅 |
| `miniwdl` (via MCP lint) | WDL 문법 검증 |
| AWS CLI | S3 데이터 관리, IAM 정책, omics API |

---

## 권장 사항

1. **Run Cache 활용**: 성공한 런의 결과를 캐시하여 재실행 시 비용/시간 절약
2. **Ephemeral Storage**: I/O 집약 태스크에 `disks` directive 추가로 성능 향상
3. **Container Registry Map**: 워크플로우 생성 시 `container_registry_map`을 사용하면 WDL 수정 없이 이미지 리다이렉트 가능 (단, GCR은 미지원)
4. **VPC Configuration**: 크로스 리전 데이터 접근이 필요하면 VPC 네트워킹 구성 필요
