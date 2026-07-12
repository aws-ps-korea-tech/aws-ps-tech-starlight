---
title: "AWS HealthOmics Run Analyzer 분석 리포트"
sidebar:
  order: 10
---

#   


**Run ID:** 1910249 | **Region:** us-east-1 | **분석일:** 2026-01-07

---

## 1. 워크플로우 개요

<table id="bkmrk-%ED%95%AD%EB%AA%A9%EA%B0%92-%EC%9B%8C%ED%81%AC%ED%94%8C%EB%A1%9C%EC%9A%B0-%EC%9D%B4%EB%A6%84na12878_"><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>**워크플로우 이름**</td><td>NA12878\_WES (nf-core/sarek)</td></tr><tr><td>**시작 시간**</td><td>2026-01-06 20:44:04 (UTC)</td></tr><tr><td>**종료 시간**</td><td>2026-01-06 23:15:32 (UTC)</td></tr><tr><td>**총 실행 시간**</td><td>**2시간 31분 28초** (9,088초)</td></tr><tr><td>**총 태스크 수**</td><td>48개</td></tr></tbody></table>

---

## 2. 비용 분석

### 2.1 전체 비용 요약

<table id="bkmrk-%ED%95%AD%EB%AA%A9%EA%B8%88%EC%95%A1-%28usd%29-%ED%98%84%EC%9E%AC-%EC%98%88%EC%83%81-%EB%B9%84%EC%9A%A9%24"><thead><tr><th>항목</th><th>금액 (USD)</th></tr></thead><tbody><tr><td>**현재 예상 비용**</td><td>**$0.581**</td></tr><tr><td>**최적화 후 예상 비용**</td><td>**~$0.37**</td></tr><tr><td>**절감 가능 금액**</td><td>~$0.21 (36%)</td></tr></tbody></table>

### 2.2 비용 최적화 기회 (주요 태스크)

가장 큰 비용 절감이 가능한 태스크:

<table id="bkmrk-%ED%83%9C%EC%8A%A4%ED%81%AC%ED%98%84%EC%9E%AC-%EB%B9%84%EC%9A%A9%EC%B5%9C%EC%A0%81%ED%99%94-%EB%B9%84%EC%9A%A9%EC%A0%88%EA%B0%90%EC%95%A1%EC%A0%88%EA%B0%90%EB%A5%A0"><thead><tr><th>태스크</th><th>현재 비용</th><th>최적화 비용</th><th>절감액</th><th>절감률</th></tr></thead><tbody><tr><td>**GATK4\_HAPLOTYPECALLER**</td><td>$0.2836</td><td>$0.0956</td><td>**$0.1880**</td><td>**66.3%**</td></tr><tr><td>GATK4\_MARKDUPLICATES</td><td>$0.0817</td><td>$0.0536</td><td>$0.0281</td><td>34.4%</td></tr><tr><td>BWAMEM1\_MEM (일부)</td><td>$0.0435</td><td>$0.0217</td><td>$0.0218</td><td>50.0%</td></tr><tr><td>CNNSCOREVARIANTS</td><td>$0.0088</td><td>$0.0059</td><td>$0.0029</td><td>32.5%</td></tr><tr><td>FILTERVARIANTTRANCHES</td><td>$0.0126</td><td>$0.0096</td><td>$0.0030</td><td>23.8%</td></tr></tbody></table>

---

## 3. 리소스 활용률 분석

### 3.1 전체 Run 리소스 사용률

<table id="bkmrk-%EB%A6%AC%EC%86%8C%EC%8A%A4%EC%98%88%EC%95%BD%EB%9F%89%EC%B5%9C%EB%8C%80-%EC%82%AC%EC%9A%A9%EB%9F%89%ED%8F%89%EA%B7%A0-%EC%82%AC%EC%9A%A9%EB%9F%89%ED%99%9C%EC%9A%A9"><thead><tr><th>리소스</th><th>예약량</th><th>최대 사용량</th><th>평균 사용량</th><th>활용률</th></tr></thead><tbody><tr><td>**CPU**</td><td>84 vCPU</td><td>2.02 vCPU</td><td>0.04 vCPU</td><td>**2.4%**</td></tr><tr><td>**메모리**</td><td>336 GiB</td><td>21.53 GiB</td><td>1.11 GiB</td><td>**6.4%**</td></tr><tr><td>**스토리지**</td><td>1,200 GiB</td><td>145.23 GiB</td><td>137.09 GiB</td><td>**12.1%**</td></tr></tbody></table>

*참고: Run 레벨에서 낮은 활용률은 태스크들이 순차적으로 실행되어 동시 리소스 사용이 적기 때문입니다.*

### 3.2 태스크별 리소스 활용률 (상위 비용 태스크)

#### GATK4\_HAPLOTYPECALLER (가장 비용이 높은 태스크)

<table id="bkmrk-%ED%95%AD%EB%AA%A9%EA%B0%92-%EC%8B%A4%ED%96%89-%EC%8B%9C%EA%B0%8425%EB%B6%84-0%EC%B4%88-%ED%98%84%EC%9E%AC-%EC%9D%B8"><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>실행 시간</td><td>25분 0초</td></tr><tr><td>현재 인스턴스</td><td>**omics.r.2xlarge** (8 vCPU, 64 GiB)</td></tr><tr><td>권장 인스턴스</td><td>**omics.c.xlarge** (4 vCPU, 8 GiB)</td></tr><tr><td>CPU 활용률</td><td>33.8% (최대 2.7 vCPU 사용)</td></tr><tr><td>메모리 활용률</td><td>**9.8%** (최대 6.25 GiB 사용)</td></tr></tbody></table>

#### GATK4\_MARKDUPLICATES

<table id="bkmrk-%ED%95%AD%EB%AA%A9%EA%B0%92-%EC%8B%A4%ED%96%89-%EC%8B%9C%EA%B0%849%EB%B6%84-27%EC%B4%88-%ED%98%84%EC%9E%AC-%EC%9D%B8"><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>실행 시간</td><td>9분 27초</td></tr><tr><td>현재 인스턴스</td><td>**omics.m.2xlarge** (8 vCPU, 32 GiB)</td></tr><tr><td>권장 인스턴스</td><td>**omics.r.xlarge** (4 vCPU, 32 GiB)</td></tr><tr><td>CPU 활용률</td><td>25.2%</td></tr><tr><td>메모리 활용률</td><td>**71.4%**</td></tr></tbody></table>

#### BWAMEM1\_MEM (24개 병렬 태스크)

<table id="bkmrk-%ED%95%AD%EB%AA%A9%EA%B0%92-%ED%8F%89%EA%B7%A0-%EC%8B%A4%ED%96%89-%EC%8B%9C%EA%B0%84%7E2%EB%B6%84-30%EC%B4%88-"><thead><tr><th>항목</th><th>값</th></tr></thead><tbody><tr><td>평균 실행 시간</td><td>~2분 30초</td></tr><tr><td>현재 인스턴스</td><td>**omics.c.4xlarge** (16 vCPU, 32 GiB)</td></tr><tr><td>대부분 권장 인스턴스</td><td>**omics.c.4xlarge** (적정)</td></tr><tr><td>일부 권장 인스턴스</td><td>**omics.c.2xlarge** (2개 태스크)</td></tr><tr><td>평균 CPU 활용률</td><td>**70-99%** (우수)</td></tr><tr><td>평균 메모리 활용률</td><td>**25-28%**</td></tr></tbody></table>

---

## 4. 태스크별 상세 분석

### 4.1 가장 오래 실행된 태스크 (Top 5)

<table id="bkmrk-%EC%88%9C%EC%9C%84%ED%83%9C%EC%8A%A4%ED%81%AC%EC%8B%A4%ED%96%89-%EC%8B%9C%EA%B0%84%EC%9D%B8%EC%8A%A4%ED%84%B4%EC%8A%A4-1gatk"><thead><tr><th>순위</th><th>태스크</th><th>실행 시간</th><th>인스턴스</th></tr></thead><tbody><tr><td>1</td><td>GATK4\_HAPLOTYPECALLER</td><td>25분 0초</td><td>omics.r.2xlarge</td></tr><tr><td>2</td><td>GATK4\_APPLYBQSR</td><td>24분 15초</td><td>omics.c.large</td></tr><tr><td>3</td><td>GATK4\_BASERECALIBRATOR</td><td>20분 52초</td><td>omics.c.large</td></tr><tr><td>4</td><td>GATK4\_MARKDUPLICATES</td><td>9분 27초</td><td>omics.m.2xlarge</td></tr><tr><td>5</td><td>FILTERVARIANTTRANCHES</td><td>4분 28초</td><td>omics.r.large</td></tr></tbody></table>

### 4.2 인스턴스 타입별 태스크 분포

<table id="bkmrk-%EC%9D%B8%EC%8A%A4%ED%84%B4%EC%8A%A4-%ED%83%80%EC%9E%85%ED%83%9C%EC%8A%A4%ED%81%AC-%EC%88%98%EC%B4%9D-%EB%B9%84%EC%9A%A9-omi"><thead><tr><th>인스턴스 타입</th><th>태스크 수</th><th>총 비용</th></tr></thead><tbody><tr><td>omics.c.4xlarge</td><td>24</td><td>$0.742</td></tr><tr><td>omics.c.large</td><td>12</td><td>$0.127</td></tr><tr><td>omics.r.2xlarge</td><td>1</td><td>$0.284</td></tr><tr><td>omics.m.2xlarge</td><td>1</td><td>$0.082</td></tr><tr><td>omics.c.xlarge</td><td>4</td><td>$0.032</td></tr><tr><td>omics.m.large</td><td>2</td><td>$0.010</td></tr><tr><td>omics.r.large</td><td>2</td><td>$0.021</td></tr><tr><td>omics.m.xlarge</td><td>1</td><td>$0.004</td></tr></tbody></table>

---

## 5. 최적화 권장사항

### 5.1 즉시 적용 가능한 최적화

#### 1. GATK4\_HAPLOTYPECALLER 인스턴스 다운사이징 (최우선)

```
현재: omics.r.2xlarge (8 vCPU, 64 GiB) → $0.284
권장: omics.c.xlarge (4 vCPU, 8 GiB)   → $0.096
절감: $0.188 (66% 절감)
```

- 메모리 사용률이 9.8%로 매우 낮음
- 실제 사용 메모리: 6.25 GiB (64 GiB 중)

#### 2. GATK4\_MARKDUPLICATES 인스턴스 변경

```
현재: omics.m.2xlarge (8 vCPU, 32 GiB) → $0.082
권장: omics.r.xlarge (4 vCPU, 32 GiB)  → $0.054
절감: $0.028 (34% 절감)
```

- 메모리 사용률이 71.4%로 높아 메모리 최적화 인스턴스 유지 필요

#### 3. 일부 BWAMEM1\_MEM 태스크 다운사이징

- 2개 태스크에서 `omics.c.4xlarge` → `omics.c.2xlarge` 가능
- 해당 태스크의 CPU 활용률이 43-48%로 낮음

### 5.2 Nextflow 최적화 설정 생성

최적화된 설정 파일을 생성하려면:

```
AWS_DEFAULT_REGION=us-east-1 python3.11 -m omics.cli.run_analyzer 1910249 --write-config=optimized.config
```

---

## 6. 워크플로우 파이프라인 단계별 시간

```
PREPARE_INTERVALS     ████ (~1분)
FASTQC/FASTP         ████████ (~3분)
BWAMEM1_MEM          ████████████████ (~4분, 24개 병렬)
MARKDUPLICATES       ██████████████████████ (~10분)
BASERECALIBRATOR     ██████████████████████████████████████████ (~21분)
APPLYBQSR            ████████████████████████████████████████████████ (~24분)
HAPLOTYPECALLER      ██████████████████████████████████████████████████ (~25분)
VCF_FILTERING        ██████████████ (~7분)
QC/MULTIQC           ███ (~1분)
```

---

## 7. 결론

<table id="bkmrk-%EC%A7%80%ED%91%9C%ED%98%84%EC%9E%AC%EC%B5%9C%EC%A0%81%ED%99%94-%ED%9B%84%EA%B0%9C%EC%84%A0-%EC%B4%9D-%EB%B9%84%EC%9A%A9%240.5"><thead><tr><th>지표</th><th>현재</th><th>최적화 후</th><th>개선</th></tr></thead><tbody><tr><td>**총 비용**</td><td>$0.581</td><td>~$0.37</td><td>~36% 절감 가능</td></tr><tr><td>**주요 병목**</td><td colspan="3">GATK4\_HAPLOTYPECALLER (메모리 과다 할당)</td></tr><tr><td>**리소스 효율**</td><td colspan="3">낮음 (메모리 10% 미만 활용) → 개선 가능</td></tr></tbody></table>

---

## 8. 분석 도구 정보

**aws-healthomics-tools** ([GitHub](https://github.com/awslabs/aws-healthomics-tools))를 사용하여 분석되었습니다.

```
pip install aws-healthomics-tools
python -m omics.cli.run_analyzer <RUN_ID> -o output.csv
```

*이 리포트는 Claude Code를 통해 자동 생성되었습니다.*

<div id="bkmrk--8"></div>