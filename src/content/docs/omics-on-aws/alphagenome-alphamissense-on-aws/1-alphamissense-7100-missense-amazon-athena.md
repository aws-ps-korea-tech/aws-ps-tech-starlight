---
title: "1편 · AlphaMissense 7,100만 missense 변이 점수표를 Amazon Athena로 조회하기: 서버 없는 변이 주석 데이터 레이크"
---

# 1편 · AlphaMissense 7,100만 missense 변이 점수표를 Amazon Athena로 조회하기: 서버 없는 변이 주석 데이터 레이크

<p class="callout warning"><strong>비공개 초안 v0.1 (2026-09-22)</strong> — AWS 공식 블로그 게재용 시리즈 1편(AlphaMissense). 원본: <code>test-alphagenome/docs/blog_series_01_alphamissense_athena_ko.md</code> (git 2353cd7). 본문에 <code>[TODO]</code> 14개가 남아 있습니다. 검토 후 게재 절차(Public Model·데이터셋 승인, BLL Media Review, Open Source 리뷰, PCSR)를 거쳐 게재하며, 이 페이지는 게재 전까지 비공개입니다.</p>

<details>
<summary>초고 메모 (블로그 본문 아님, 게재 시 삭제)</summary>

초고 메모 (블로그 본문 아님, 게재 시 삭제)
- 상태: 초고 v0.1, 2026-09-22. 시리즈 1편(내부 라벨 Part 2). 개요: docs/blog_series_outline.md §3, 규정: §6.
- 채널: 한글 AWS Korea Tech Blog. 영어판(Big Data Blog 또는 HPC Blog)은 이 초고 확정 후 번역.
- 분량 목표: 3,000단어 이내.
- 적용한 표현 규칙(§6-A): "쉽게/무료/보장/플랫폼" 미사용, 라이선스는 사실 진술 + 링크만, Google 제품은 사실 언급만, 개인 유전체(GIAB) 미사용, "오픈소스" 대신 "공개", 수치는 "이번 실험에서 측정한 값".
- 측정값 출처: alphamissense/outputs/ (2026-09-18, ap-northeast-2) + 스택 배포 실측 alphamissense/cfn/runs/2026-09-22_run2_success/ (2026-09-22, ap-northeast-2). [TODO]로 표시한 값은 아직 측정하지 않았거나 재측정이 필요함.
- [TODO] 목록
  1. (완료 2026-09-22) 스택 `alphamissense-athena` 배포 실측: create-stack -> CREATE_COMPLETE 11분 52초, 로더 EC2 약 9분(다운로드 119초·적재 64초·변환 282초·업로드 7초), 검증 12항목 통과, 일회성 비용 약 $0.04. 첫 배포(run 1)는 로더 스크립트의 bash `wait` 교착으로 실패해 수정 후 재배포(cfn/README.md 참조).
  2. RODA HCLS 데이터레이크의 ClinVar·gnomAD Glue DB·테이블·컬럼명 확인 후 §8.3·§8.4 쿼리 확정·측정.
  3. §8.5 VCF 주석 입력을 ClinVar chr22 SNV 추출로 교체해 6항목 재측정(이전 실험 수치는 참고용).
  4. aws-samples 저장소 URL(Open Source 리뷰 후).
  5. 아키텍처 그림 1장(AWS Architecture Icons, 자체 제작).
  6. 법무·데이터셋 승인 티켓 번호를 블로그 SIM에 기재. 리뷰 순서는 outline §6-D.

</details>

*시리즈 1편. 2편에서는 유전체 서열 모델을 GPU 인스턴스에서 직접 실행하는 방법을 다룰 예정입니다.*

변이 해석 파이프라인에서 "이 missense 변이가 단백질 기능을 해칠까"는 매번 나오는 질문입니다. Google DeepMind가 공개한 AlphaMissense 예측 표는 사람 단백질에 생길 수 있는 missense 변이 약 7,100만 개에 대해 0~1 사이의 병원성 점수와 3단계 분류(`likely_benign`, `ambiguous`, `likely_pathogenic`)를 미리 계산해 두었습니다. 문제는 형태입니다. 643MB 압축 TSV를 팀원마다 내려받아 grep하면 버전이 갈리고, VCF 파이프라인에 붙이려면 매번 파싱 코드를 다시 씁니다.

이 글에서는 그 표를 Parquet로 변환해 Amazon S3에 두고 Amazon Athena로 SQL 조회하는 데이터 레이크를 AWS CloudFormation 스택 하나로 구성하는 방법을 소개합니다. 같은 카탈로그에 Registry of Open Data on AWS가 제공하는 ClinVar·gnomAD 테이블을 데이터 복사 없이 붙여, "ClinVar 전문가 패널이 병원성으로 판정한 변이 중 AlphaMissense가 다르게 예측한 것은?" 같은 질문에 SQL 한 번으로 답합니다. 이번 실험에서 스택 배포는 12분이 걸렸고, 변이 하나 조회는 4.5MB 스캔에 1.3초, 배포 한 번의 비용은 $0.04, 저장 비용은 월 $0.04였습니다. 표를 만들며 확인한 데이터 특성(키가 유일하지 않음, 경계 점수의 라벨, 파일 헤더의 라이선스 문구)도 함께 정리합니다.

> **데이터 출처와 이용 조건.** 이 글이 사용하는 AlphaMissense 예측 표는 Google DeepMind가 [Zenodo record 10813168](https://zenodo.org/records/10813168)(v3)에 CC BY 4.0으로 배포한 파일입니다. 이용 조건과 인용 방법은 원 출처에서 확인하세요. 예측 점수는 임상 검증을 거친 것이 아니며 진단 근거로 사용할 수 없습니다.

## 언제 어떤 도구를 쓰나

| 하고 싶은 일 | 권장 경로 | 데이터·모델 이용 조건 |
|---|---|---|
| VCF의 coding missense 변이를 병원성 점수로 주석하고 팀 공용 표로 유지 | **이 글**: AlphaMissense 표를 Athena에서 조회, RODA ClinVar·gnomAD와 결합 | 예측 표 CC BY 4.0 ([원 출처](https://zenodo.org/records/10813168)) |
| 특정 SNV 몇 개의 분자 수준 효과를 빨리 확인 | [AlphaGenome Atlas](https://deepmind.google/science/alphagenome/) 포털·API | 원 출처 참조 |
| indel·다중 변이·편집 서열 예측, 서열 데이터를 외부로 보낼 수 없음, 대량 배치, 모델 버전 고정 | **2편(예정)**: AlphaGenome을 Amazon EC2 GPU 인스턴스 또는 Amazon SageMaker 엔드포인트에서 실행 | 모델 가중치는 DeepMind 모델 약관 참조 |

AlphaMissense와 AlphaGenome은 서로 다른 계열의 상보적 도구입니다. AlphaMissense는 단백질 코딩 영역의 아미노산 치환(missense) 한 종류에 대해 병원성을 예측하고, AlphaGenome은 코딩·비코딩을 가리지 않고 변이가 발현·스플라이싱·크로마틴에 미치는 분자 수준 효과를 예측합니다. AlphaGenome Atlas의 AVI 점수는 두 결과를 결합한 값입니다. 이 시리즈는 그 두 자원을 고객 계정 안에서 각각 구성하는 방법을 다룹니다.

## 왜 표를 내 AWS 계정에 두나

포털에서 변이 몇 개를 조회하는 용도라면 표를 내려받을 이유가 없습니다. 표를 내 계정의 카탈로그에 두는 이유는 세 가지입니다.

1. **파이프라인 결합.** VCF에서 뽑은 변이 수만 개를 JOIN 한 번으로 주석합니다. 건당 API 호출이 필요 없습니다.
2. **버전 고정과 재현성.** 표 버전(v3)과 변환 절차가 스택에 고정되므로, 1년 뒤 같은 VCF를 돌려도 같은 결과가 나옵니다.
3. **다른 공개 데이터와의 결합.** ClinVar 판정, gnomAD 대립유전자 빈도 같은 공개 데이터셋이 이미 Amazon S3에 Parquet로 있으므로, 같은 Glue 카탈로그에서 SQL로 결합할 수 있습니다.

## 아키텍처

```
Zenodo (AlphaMissense_hg38.tsv.gz, 643MB)
        │  일회성 로더 EC2 (스택이 만들고 작업 후 스스로 종료)
        │  다운로드 → md5 검증 → DuckDB 적재·검증 → Parquet 변환 → S3 업로드
        ▼
Amazon S3 (퍼블릭 차단, SSE-S3)
  alphamissense/v3/hg38/chrom=chr1/part-0.parquet          ← 공개 원본 그대로(transcript 단위)
  alphamissense/v3/hg38_variant/chrom=chr1/part-0.parquet  ← 변이당 1행
        │
AWS Glue Data Catalog (테이블 정의, 파티션 프로젝션)  ─┐
                                                          ├── Amazon Athena 워크그룹 ── SQL
RODA HCLS 데이터레이크 (ClinVar, gnomAD; 데이터 복사 없음) ┘
```

| 서비스 | 역할 |
|---|---|
| Amazon S3 | Parquet 파일 저장. 조회 시 필요한 파티션과 row group만 읽힘 |
| Amazon EC2 | 변환 작업만 하는 임시 인스턴스. 스택 배포 중 한 번 실행되고 종료 |
| AWS Glue Data Catalog | S3 경로가 어떤 열을 가진 테이블인지 정의. 파티션 프로젝션으로 크롤러 불필요 |
| Amazon Athena | S3의 Parquet에 직접 SQL 실행. 스캔량 기준 과금 |
| AWS CloudFormation | 위 리소스를 스택 하나로 생성·삭제 |
| Registry of Open Data on AWS | ClinVar·gnomAD 등 공개 데이터셋을 Parquet와 CloudFormation 템플릿으로 제공 |

[TODO: AWS Architecture Icons로 그림 1장 제작, 위 텍스트 다이어그램 대체]

## 데이터 이해: 표의 모양과 확인해야 할 특성 세 가지

원본 파일은 앞 4줄이 `#`으로 시작하고, 헤더 줄도 `#CHROM`으로 시작합니다.

```
# Copyright 2023 DeepMind Technologies Limited
# ...
#CHROM  POS     REF ALT genome uniprot_id transcript_id      protein_variant am_pathogenicity am_class
chr1    69094   G   T   hg38   Q8NH21     ENST00000335137.4  V2L             0.2937           likely_benign
```

이번 실험에서 적재 후 확인한 특성 세 가지는 스키마 설계를 바꿀 만큼 중요했습니다.

**(chrom, pos, ref, alt) 키가 유일하지 않습니다.** 전체 71,697,556행 중 distinct 키는 71,034,269개입니다. 603,296개 키가 2~22행씩 나타나고, 완전히 같은 행은 0개입니다. 중복은 전부 서로 다른 transcript에서 옵니다. 같은 염기 하나가 겹치는 두 유전자에서 서로 다른 아미노산 치환이 되고 예측도 갈리는 경우가 있습니다.

```
chr1:119996997 C>G  Q04721 (NOTCH2)     ENST00000256646.7  G251R  0.9966  likely_pathogenic
chr1:119996997 C>G  Q7Z3S9 (NOTCH2NLA)  ENST00000602566.6  E212Q  0.1144  likely_benign
```

이 상태로 VCF와 JOIN하면 행이 늘고 "이 변이는 병원성인가"에 답이 두 개 나옵니다. 그래서 스택은 표를 두 개 만듭니다. `hg38`은 공개 원본 그대로(transcript 단위, 71.7M행), `hg38_variant`는 변이당 1행(71.03M행)으로, 최대 점수를 낸 transcript의 점수·클래스·단백질 변이와 함께 `n_transcripts`, `am_pathogenicity_min`, transcript 목록을 담습니다. VCF 주석에는 `hg38_variant`를 씁니다.

**경계 점수의 라벨이 섞여 있습니다.** 분류 규칙은 0.34 미만 `likely_benign`, 0.564 초과 `likely_pathogenic`, 나머지 `ambiguous`입니다. 점수가 정확히 0.34인 4,738행 중 2,349행은 `likely_benign`, 2,389행은 `ambiguous`이고, 0.564에서도 3,055행이 같은 양상입니다. 공개 점수가 소수 4자리로 반올림되어 원래 0.33996이던 값과 0.34004이던 값이 같은 0.3400으로 보이기 때문입니다. 경계값을 제외하면 규칙 불일치는 0행입니다. 따라서 `am_class`를 점수에서 다시 계산하지 말고 제공된 열을 그대로 쓰세요. 점수를 비교할 때는 `CAST(0.564 AS REAL)`처럼 float32로 캐스팅해야 경계에서 어긋나지 않습니다.

**염색체가 25개입니다.** chr1~22, chrX, chrY에 chrM(24,074행)이 포함됩니다. 파티션 목록에서 빠지면 조용히 조회되지 않습니다.

라이선스 표기도 확인이 필요합니다. 파일 내부 주석에는 초기 버전의 라이선스 문구가 남아 있고, Zenodo v3 레코드와 저장소 README는 CC BY 4.0을 명시합니다. 두 버전의 파일은 md5가 같습니다. 어느 레코드에서 내려받았는지 기록을 남기고, 이용 조건은 원 출처에서 확인하세요.

## 사전 조건

| 항목 | 내용 |
|---|---|
| AWS 계정 | CloudFormation, EC2, IAM, S3, Glue, Athena 리소스를 만들 수 있는 권한 |
| 작업 환경 | AWS CLI v2. 스택 배포와 Athena 쿼리는 콘솔에서도 가능 |
| 리전 | 이번 실험은 아시아 태평양(서울) 리전(`ap-northeast-2`). 다른 리전에서도 동일하게 동작 |
| 시간 | 스택 배포 약 12분(이번 실험 11분 52초, 로더 실행 시간 포함), 검증 쿼리 5분 |

## 스택 배포

> 이 글의 템플릿과 코드는 비프로덕션 용도의 샘플입니다. 조직의 보안·규제 요건에 맞게 검토한 뒤 사용하세요.

스택 `alphamissense-athena`는 다음을 만듭니다.

| 리소스 | 설정 |
|---|---|
| S3 버킷 | 퍼블릭 접근 4개 옵션 모두 차단, SSE-S3 기본 암호화, HTTPS 전용 버킷 정책. 스택 삭제 시 보존(`DeletionPolicy: Retain`) |
| Glue 데이터베이스 `alphamissense` + 테이블 3개 | `hg38`, `hg38_variant`, `gene_hg38`(transcript별 평균 점수, 19,233행). 파티션 프로젝션으로 `chrom` 25개 값을 테이블 속성에 선언 |
| Athena 워크그룹 `alphamissense` + 저장 쿼리 4개 | 결과 위치를 같은 버킷의 `athena-results/`로 고정, 쿼리당 스캔 상한 10GiB. 저장 쿼리: 단건 조회, 분포, 키 파일 등록, 주석 |
| 최소 VPC | 퍼블릭 서브넷 1개, 인터넷 게이트웨이, S3 게이트웨이 엔드포인트. 로더 전용이며 스택과 함께 삭제 |
| 로더 IAM 역할 | 이 버킷에 대한 읽기·쓰기, AWS Systems Manager 통신, 이 스택에 대한 완료 신호 권한만 |
| 로더 EC2 인스턴스 | 기본 m6i.xlarge, Amazon Linux 2023, gp3 100GB 암호화, IMDSv2 필수, 인바운드 규칙 없음, 아웃바운드 HTTPS만. user-data가 다운로드·md5 검증·DuckDB 적재·검증·Parquet 변환·읽기 검증·업로드를 수행하고 스택에 신호를 보낸 뒤 스스로 종료. 첫 줄의 `shutdown -h +360`이 어떤 경우에도 6시간 뒤 인스턴스를 종료 |
| CreationPolicy | 로더의 성공 신호를 받아야 스택이 `CREATE_COMPLETE`가 됨(제한 2시간). 즉 스택 생성 완료가 곧 표 준비 완료. 검증 실패 시 스택은 롤백되고 버킷은 보존 |

주요 파라미터는 `KeepRawCopy`(원본 tsv.gz 사본을 S3 `raw/`에 보존, 기본 `true`)와 `LoaderInstanceType`(기본 `m6i.xlarge`)입니다. 나머지(디스크 크기, 데드맨 시간, 데이터베이스·워크그룹 이름, 원본 파일의 md5)는 기본값으로 둡니다.

```bash
aws cloudformation deploy \
  --stack-name alphamissense-athena \
  --template-file alphamissense-athena.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides KeepRawCopy=true
```

[TODO: aws-samples 저장소 URL과 템플릿 파일명]

이번 실험에서는 `create-stack` 호출부터 `CREATE_COMPLETE`까지 11분 52초가 걸렸습니다. 처음 3분은 VPC·버킷·카탈로그·IAM 생성이고(이 중 2분은 CloudFormation이 인스턴스 프로파일 전파를 기다리는 시간), 나머지 9분이 로더입니다. 로더 로그 기준으로 패키지 설치 20초, 원본 다운로드 121초(643MB. Zenodo 전송 속도가 2MB/s에 미치지 못해 30초 뒤 미러로 전환, 두 실행 모두 같았습니다), DuckDB 적재 64초, Parquet 변환 282초, 읽기 검증 6초, 같은 리전 S3 업로드 7초였습니다. 진행 상황은 스택 이벤트로, 로더 내부는 Systems Manager Session Manager로 `/var/log/am-loader.log`를 열어 볼 수 있습니다. 로그는 종료 시 버킷의 `logs/loader/`에도 복사됩니다.

로더가 하는 일 중 눈여겨볼 것은 변환 규칙과 검증입니다. 파티션은 `chrom`(Hive 경로 `chrom=chr17/`), 파티션 안에서는 `pos` 오름차순 정렬, row group 100만 행, 파티션당 파일 1개, ZSTD 압축입니다. Parquet는 row group마다 min/max 통계를 저장하므로, 정렬된 파일에서 좌표 조회는 해당 row group만 읽습니다. `chrom` 열은 경로에서 파생되므로 파일 안에는 넣지 않습니다. `hg38_variant`는 윈도 함수로 키별 최대 점수 행을 고르고 집계를 붙여 만듭니다.

```sql
-- DuckDB, 염색체마다 반복
WITH ranked AS (
  SELECT *, row_number() OVER (PARTITION BY pos, ref, alt
                               ORDER BY am_pathogenicity DESC, transcript_id) AS rn
  FROM am_hg38 WHERE chrom = 'chr17'),
agg AS (
  SELECT pos, ref, alt, count(*) AS n_transcripts, min(am_pathogenicity) AS am_pathogenicity_min,
         string_agg(transcript_id, '|' ORDER BY am_pathogenicity DESC, transcript_id) AS transcript_ids
  FROM am_hg38 WHERE chrom = 'chr17' GROUP BY 1, 2, 3)
SELECT r.pos, r.ref, r.alt, r.am_pathogenicity AS am_pathogenicity_max, r.am_class AS am_class_max,
       r.uniprot_id AS uniprot_id_max, r.transcript_id AS transcript_id_max,
       r.protein_variant AS protein_variant_max, a.am_pathogenicity_min, a.n_transcripts, a.transcript_ids
FROM ranked r JOIN agg a USING (pos, ref, alt)
WHERE r.rn = 1 ORDER BY r.pos, r.ref, r.alt;
```

로더는 두 단계에서 확인합니다. 적재 직후 5가지: 파일 헤더가 기대한 열 순서인지, 염색체 값 집합이 파티션 프로젝션에 선언한 25개와 같은지, 임계값 규칙이 경계 점수를 제외하고 모든 행에서 성립하는지, 원본 데이터 행 수(`zcat | grep -vc '^#'`)와 적재 행 수가 같은지, gene 표 헤더. 변환 직후 파일을 다시 읽어 7가지: 행 수 일치, 변이 표 행 수 = distinct 키 수, 변이 표 키 유일, `sum(n_transcripts)` = 원본 행 수, 파티션당 파일 1개, 정렬, gene 표 행 수. 하나라도 틀리면 업로드하지 않고 실패 신호를 보내 스택이 롤백됩니다(버킷은 보존). 이번 실험에서 12개 모두 통과했고 결과는 버킷의 `metrics/metrics.json`에 남습니다.

이번 실험의 결과 파일 크기는 다음과 같습니다.

| 테이블 | 행 | 파일 | 크기 |
|---|---|---|---|
| `hg38` | 71,697,556 | 25 | 338MB |
| `hg38_variant` | 71,034,269 | 25 | 465MB |
| `gene_hg38` | 19,233 | 1 | 0.16MB |

643MB 압축 TSV가 338MB Parquet가 되었습니다. 변환 282초, 같은 리전 S3 업로드는 원본 사본까지 1.45GB에 7초였습니다.

## 공개 데이터를 옆에 붙이기

[Registry of Open Data on AWS](https://registry.opendata.aws/)의 HCLS 데이터레이크(`s3://aws-roda-hcls-datalake`)는 ClinVar, gnomAD, GTEx 등 공개 데이터셋을 Parquet로 제공하고, [aws-samples/data-lake-as-code](https://github.com/aws-samples/data-lake-as-code)의 CloudFormation 템플릿으로 내 계정의 Glue 카탈로그에 테이블 정의를 만들어 줍니다. 데이터는 복사되지 않고, 쿼리 시 스캔 비용만 발생합니다. 이번 실험에서 ClinVar와 gnomAD 템플릿 배포는 각각 1분 안에 끝났습니다. [TODO: 데이터베이스·테이블명 확인 후 정확한 이름 기재]

이제 같은 Athena 워크그룹에서 `alphamissense.hg38_variant`와 RODA 테이블을 한 쿼리에 쓸 수 있습니다.

## 검증

"올렸다"와 "맞다"는 다릅니다. 이번 실험에서 실행한 검증 중 다섯 가지를 소개합니다. 스캔량과 시간은 Athena 쿼리 통계에서 읽은 값입니다.

### 1. 변이 하나 조회

```sql
SELECT chrom, pos, ref, alt, am_pathogenicity_max, am_class_max,
       uniprot_id_max, protein_variant_max, n_transcripts
FROM alphamissense.hg38_variant
WHERE chrom = 'chr17' AND pos = 7670684 AND ref = 'C' AND alt = 'G';
```

```
chr17 | 7670684 | C | G | 0.9836 | likely_pathogenic | P04637 | R342P | 1
```

TP53 R342P입니다. 스택 배포 직후 실행에서 스캔 4.52MB, 1.3초(같은 쿼리를 2026-09-18 실험에서는 0.9초), 과금은 최소 단위 10MB 기준 $0.00005입니다. 465MB 표에서 4.5MB만 읽은 것은 파티션(chr17 파일 하나)과 row group 통계(pos 범위) 덕분입니다.

### 2. 분류 분포가 논문과 일치하는가

```sql
SELECT am_class, count(*) AS n, round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct
FROM alphamissense.hg38 GROUP BY 1 ORDER BY 2 DESC;
```

```
likely_benign      40,917,351  57.07
likely_pathogenic  22,770,557  31.76
ambiguous           8,009,648  11.17
```

논문의 57 / 32 / 11%와 일치합니다. 변환 과정에서 행이 섞이거나 빠졌다면 여기서 드러납니다. 7,170만 행 전체를 집계하는데 스캔은 9.6MB, 1.2초였습니다. Parquet는 열 단위로 저장하므로 `am_class` 열만 읽고, 값이 세 종류뿐인 열은 사전 인코딩과 압축으로 매우 작아지기 때문입니다. 행 기반 파일이었다면 표 전체 338MB를 읽어야 했습니다.

### 3. ClinVar 판정과 비교

ClinVar에서 전문가 패널이 검토한 Pathogenic·Benign SNV를 `hg38_variant`와 JOIN합니다. AlphaMissense 표에는 missense 변이만 있으므로 JOIN 자체가 missense 필터 역할을 합니다. ClinVar의 염색체 표기는 `17`, AlphaMissense는 `chr17`이므로 접두어를 맞춥니다.

```sql
WITH cv AS (
  SELECT 'chr' || chromosome AS chrom, CAST(start AS INTEGER) AS pos,
         referenceallele AS ref, alternateallele AS alt,
         CASE WHEN clinicalsignificance LIKE 'Pathogenic%' THEN 'Pathogenic'
              WHEN clinicalsignificance LIKE 'Benign%'     THEN 'Benign' END AS clinvar_label
  FROM clinvar.variant_summary              -- [TODO] RODA 실제 DB.테이블·컬럼명
  WHERE assembly = 'GRCh38' AND type = 'single nucleotide variant'
    AND reviewstatus = 'reviewed by expert panel'
    AND (clinicalsignificance LIKE 'Pathogenic%' OR clinicalsignificance LIKE 'Benign%'))
SELECT cv.clinvar_label, v.am_class_max, count(*) AS n
FROM cv JOIN alphamissense.hg38_variant v
  ON cv.chrom = v.chrom AND cv.pos = v.pos AND cv.ref = v.ref AND cv.alt = v.alt
GROUP BY 1, 2 ORDER BY 1, 2;
```

결과는 ClinVar 라벨 × AlphaMissense 클래스의 혼동행렬입니다. [TODO: 실행 후 표와 일치율 기재. 논문의 ClinVar 평가와 비교 한 문장]

이번 실험에서 알려진 병원성 변이 5개를 개별 확인한 결과입니다. 좌표는 손으로 적지 않고 ClinVar VCF(2026-09-13판)에서 "Pathogenic, missense, SNV, 전문가 패널 검토" 조건으로 뽑았습니다.

| 유전자 | 변이 (GRCh38) | ClinVar ID | AlphaMissense | 점수 |
|---|---|---|---|---|
| BRCA1 | chr17:43045754 A>G | 91656 | L1839S | 0.9413 |
| BRCA1 | chr17:43045757 A>T | 55611 | V1838E | 0.9708 |
| BRCA1 | chr17:43045761 A>C | 55607 | W1837G | 0.9091 |
| TP53 | chr17:7670669 G>T | 43587 | A347D | 0.9525 |
| TP53 | chr17:7670684 C>G | 215996 | R342P | 0.9836 |

5개 모두 표에 있고 전부 `likely_pathogenic`입니다.

### 4. gnomAD 대립유전자 빈도와 비교

인구 집단에서 흔한 변이는 병원성일 가능성이 낮습니다. gnomAD 빈도 구간별로 AlphaMissense 점수의 평균을 보면 이 관계가 데이터에서 재현되는지 확인할 수 있습니다.

```sql
SELECT CASE WHEN g.af >= 0.05 THEN '>=5%' WHEN g.af >= 0.01 THEN '1-5%'
            WHEN g.af >= 0.001 THEN '0.1-1%' ELSE '<0.1%' END AS af_bin,
       count(*) AS n, round(avg(v.am_pathogenicity_max), 3) AS mean_score,
       round(100.0 * sum(CASE WHEN v.am_class_max = 'likely_pathogenic' THEN 1 ELSE 0 END) / count(*), 1) AS pct_pathogenic
FROM gnomad.sites g                             -- [TODO] RODA 실제 DB.테이블·컬럼명
JOIN alphamissense.hg38_variant v
  ON g.chrom = v.chrom AND g.pos = v.pos AND g.ref = v.ref AND g.alt = v.alt
WHERE g.chrom = 'chr22' AND v.chrom = 'chr22'
GROUP BY 1 ORDER BY 1;
```

[TODO: 실행 후 구간별 표 기재]

이 비교는 "병원성 예측이 곧 질병"이 아니라는 점을 보여주는 데도 유용합니다. 예를 들어 CYP2D6 P34S(`chr22:42130692 G>A`)는 약물 대사 효소의 잘 알려진 다형성인데, AlphaMissense 점수는 0.757로 `likely_pathogenic`입니다. AlphaMissense는 단백질 기능에 미치는 영향을 예측하는 도구이고, 임상 해석은 빈도·표현형·유전 양식을 함께 보는 별개의 일입니다. [TODO: gnomAD 빈도 값 기재]

### 5. VCF 한 통 주석하기

실전 사용 패턴입니다. VCF에서 `chrom, pos, ref, alt` 네 열을 뽑아 CSV로 S3에 올리고 외부 테이블로 등록한 뒤 `LEFT JOIN`합니다. 다중 대립유전자는 미리 `bcftools norm -m -any`로 나누고, 염색체 표기는 `chr` 접두어로 통일합니다.

```sql
CREATE EXTERNAL TABLE alphamissense.my_vcf_keys (
  chrom string, pos int, ref string, alt string)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
LOCATION 's3://<버킷>/inputs/sample1/'
TBLPROPERTIES ('skip.header.line.count' = '1');

SELECT k.*, v.am_pathogenicity_max, v.am_class_max, v.protein_variant_max, v.uniprot_id_max
FROM alphamissense.my_vcf_keys k
LEFT JOIN alphamissense.hg38_variant v
  ON k.chrom = v.chrom AND k.pos = v.pos AND k.ref = v.ref AND k.alt = v.alt
 AND v.chrom IN ('chr22');   -- 입력 VCF에 있는 염색체 목록
```

마지막 줄이 중요합니다. JOIN 조건만으로는 Athena가 파티션을 정적으로 걸러내지 않습니다. 이번 실험에서 chr22 변이 5만 개 키 테이블로 비교했을 때, 술어를 빼면 73.8MB / 4.4초, 넣으면 2.7MB / 0.8초로 결과는 같고 스캔량은 27배 차이가 났습니다. [TODO: ClinVar chr22 SNV 추출을 입력으로 재측정]

결과는 여섯 항목으로 고정해 보고하면 어떤 VCF를 돌려도 비교할 수 있습니다: 입력 변이 수(정규화 후), 그중 SNV 수, AlphaMissense 매치 수(행 수 = distinct 키 수 확인), SNV 대비 매치율, indel·MNV 수(대상 외), 매치의 분류 분포. 전장 유전체 VCF에서 매치율이 1% 미만으로 나오는 것은 정상입니다. 변이의 대부분은 비코딩·동의 변이이고 AlphaMissense는 코딩 영역 missense SNV만 다룹니다. [TODO: 재측정한 6항목 표]

## 비용

스택 배포 한 번(2026-09-22, 서울 리전)에서 측정한 값입니다. 단가는 실행 당일 AWS Price List API에서 조회했습니다.

| 항목 | 사용량 | 금액 |
|---|---|---|
| Amazon EC2 m6i.xlarge (로더) | 약 9분 = 0.15시간 × $0.236/h | $0.035 |
| Amazon EBS gp3 100GB (로더 루트 볼륨) | 0.15시간 × $0.0912/GB-월 | $0.002 |
| 퍼블릭 IPv4 주소 (로더) | 0.15시간 × $0.005/h | $0.001 |
| Amazon Athena (검증 쿼리 3회) | 과금 스캔 30MB(쿼리당 최소 10MB) × $5/TB | $0.001 미만 |
| **배포 1회 합계** | | **약 $0.04** |
| Amazon S3 Standard 저장 | 1.446GB × $0.025/GB-월 (Parquet 0.80GB + 원본 사본 0.64GB + 로그·지표) | **$0.036/월** |
| CloudFormation, VPC, S3 게이트웨이 엔드포인트, Glue Data Catalog, Athena 워크그룹·저장 쿼리, IAM | 스택 리소스 23개 | 이 구성에서 청구 항목 없음 [TODO: Glue 카탈로그 요금 페이지 링크] |

`KeepRawCopy=false`로 원본 사본을 남기지 않으면 저장 비용은 월 $0.020입니다. 스택을 만들기 전 같은 변환을 손으로 수행하고 쿼리 18회로 검증한 실험(2026-09-18)은 EC2 41분을 포함해 $0.18이 들었습니다. 로더가 하는 일을 스택에 고정하면 그 차이만큼 줄어듭니다. RODA 데이터 조회는 스캔 비용만 발생합니다. 최신 단가는 [Amazon EC2 요금](https://aws.amazon.com/ec2/pricing/on-demand/), [Amazon S3 요금](https://aws.amazon.com/s3/pricing/), [Amazon Athena 요금](https://aws.amazon.com/athena/pricing/) 페이지를 참조하세요.

## 정리

```bash
aws cloudformation delete-stack --stack-name alphamissense-athena
```

워크그룹, Glue 데이터베이스·테이블, IAM 역할이 삭제됩니다. S3 버킷은 `DeletionPolicy: Retain`으로 보존되어 데이터가 남습니다. 데이터까지 지우려면 버킷을 비우고 삭제합니다. 이 작업은 되돌릴 수 없습니다.

```bash
aws s3 rm s3://<버킷> --recursive && aws s3 rb s3://<버킷>
```

## 고려사항

| 항목 | 내용 |
|---|---|
| 키 비유일 | `(chrom,pos,ref,alt)`가 유일하지 않음(603,296개 키 중복). JOIN·주석은 `hg38_variant` 사용 |
| 경계 점수 라벨 | 0.34·0.564 정확히에 해당하는 7,793행의 라벨이 반올림으로 섞임. `am_class` 재계산 금지, 비교는 float32 캐스팅 |
| 염색체 25개 | chrM 포함. 파티션 프로젝션 값 목록에서 누락 금지 |
| 파일 헤더 | 앞 4줄 `#`, 헤더 `#CHROM`. 열 이름·형을 명시해 적재 |
| 라이선스 표기 | 파일 내부 주석과 Zenodo v3 레코드의 문구가 다름. 다운로드 레코드를 기록하고 원 출처 확인 |
| 다운로드 속도 | Zenodo가 2MB/s 미만일 때가 있음. 로더는 30초 기준 미달 시 배포자가 안내하는 미러로 폴백하고 md5로 검증 |
| JOIN 파티션 술어 | JOIN 조건만으로는 파티션이 걸러지지 않음. 입력의 염색체 목록을 `IN` 술어로 명시(이번 실험 27배 차이) |
| 성능 측정 | `count(*)`는 Parquet 메타데이터만 읽어 스캔 0MB. 측정에는 열을 실제로 읽는 집계 사용 |
| 비용 상한 | 워크그룹 스캔 상한 10GB → 쿼리당 최대 $0.05. 로더는 6시간 데드맨 |
| 테이블 형식 | 불변 단일 표에는 Parquet + 파티션 프로젝션으로 충분. ClinVar 월간 갱신, 자체 코호트처럼 갱신되는 소스가 늘면 Apache Iceberg(Amazon S3 Tables) 검토 |

## 다음 단계

- **단건 조회 API가 주 용도**라면 Amazon DynamoDB로 옮기되 Import from S3로 적재하세요. 7,100만 건을 `PutItem`으로 넣는 것과 비용 차이가 큽니다. [TODO: 임포트·저장 비용 산정]
- **AWS HealthOmics 워크플로우 안에서** 쓰려면 Athena 없이도 됩니다. 태스크 컨테이너의 DuckDB가 `httpfs`로 `s3://<버킷>/alphamissense/v3/hg38_variant/*/*.parquet`를 직접 읽습니다. 실행 역할에 버킷 읽기 권한만 추가하면 됩니다.
- **Ensembl VEP 사용자**는 AlphaMissense 플러그인으로 같은 표를 주석 단계에 붙일 수 있습니다.
- **2편**에서는 유전체 서열 모델을 EC2 GPU 인스턴스와 SageMaker 엔드포인트에서 실행하고, 그 결과 표를 같은 Glue 카탈로그에 두어 코딩·비코딩 변이 점수를 한 쿼리로 결합하는 방법을 다룰 예정입니다.

## 출처와 고지

- Cheng, J. et al. "Accurate proteome-wide missense variant effect prediction with AlphaMissense." *Science* 381, eadg7492 (2023). doi:10.1126/science.adg7492
- AlphaMissense predictions © 2023 DeepMind Technologies Limited, CC BY 4.0. https://zenodo.org/records/10813168
- ClinVar: Landrum, M.J. et al. *Nucleic Acids Res.* (2018). https://www.ncbi.nlm.nih.gov/clinvar/
- gnomAD: [TODO: RODA가 제공하는 버전에 맞는 인용]
- Registry of Open Data on AWS, HCLS 데이터레이크: https://registry.opendata.aws/

AlphaMissense 예측은 임상 용도로 검증되지 않았으며 의료 조언을 대체하지 않습니다. 이 글의 코드와 템플릿은 샘플이며, 프로덕션 사용 전 조직의 보안·규제 요건에 맞게 검토해야 합니다.

---

**저자** [TODO]
