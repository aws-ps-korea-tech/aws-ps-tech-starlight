---
title: "도전과제와 모범 사례"
sidebar:
  order: 4
---

# 도전과제와 모범 사례

## 도전과제 및 해결방안

### 8.1 기술적 도전과제

**도전과제 1: WDL 워크플로우 호환성 문제**

*문제 상황:*
```
HealthOmics 런 실패 사례 (Run ID: 7924563):
OutputError: task outputs attempted to use a path outside its working directory:
output_final/NA20799.m64306Ue_220927_182256.dc.q20.fastq.gz

근본 원인:
- 심볼릭 링크가 작업 디렉토리 외부 참조
- HealthOmics 보안 정책 위반
```

*해결 전략:*
```bash
# 문제가 있는 코드
elif [[ "$SUFFIX" == "gz" ]] ; then
    ln -s ~{readFile} output/${PREFIX}.gz  # 외부 경로 참조

# 수정된 코드 (Option 1: 파일 복사)
elif [[ "$SUFFIX" == "gz" ]] ; then
    cp ~{readFile} output/${PREFIX}.gz     # 안전한 복사

# 수정된 코드 (Option 2: 하드 링크 + 폴백)
elif [[ "$SUFFIX" == "gz" ]] ; then
    ln ~{readFile} output/${PREFIX}.gz 2>/dev/null || \
    cp ~{readFile} output/${PREFIX}.gz     # 하드 링크 시도 후 복사
```

*예방 조치:*
- miniWDL 로컬 테스트로 사전 검증
- WDL 코드 리뷰 체크리스트 적용
- 자동화된 호환성 검사 도구 활용

**도전과제 2: 메모리 부족 및 리소스 최적화**

*문제 상황:*
```
Hifiasm 어셈블리 단계에서 메모리 부족 오류:
- 요청 메모리: 256GB
- 실제 필요: 384GB (대용량 샘플)
- 실행 실패율: 15-20%
```

*해결 전략:*
```wdl
# 동적 메모리 할당 패턴
runtime {
    memory: if (file_size_gb > 100) then "512 GB" else "256 GB"
    cpu: if (file_size_gb > 100) then 64 else 32
    # Cromwell retry with more memory 활용
    maxRetries: 2
    memory_retry_multiplier: 1.5
}
```

*모니터링 도구:*
- Cromwell Monitor: 실시간 리소스 사용량 추적
- CromwellRunner: 자동 재시도 및 리소스 조정
- HealthOmics Run Analyzer: 사후 최적화 분석

**도전과제 3: 대용량 데이터 전송 성능**

*문제 상황:*
```
데이터 전송 병목:
- 입력 데이터: 200GB+ per sample
- 네트워크 대역폭: 제한적
- 전송 시간: 2-4시간 (워크플로우 시작 지연)
```

*해결 전략:*
```bash
# S3 Transfer Acceleration 활용
aws configure set s3.use_accelerate_endpoint true

# 멀티파트 업로드 최적화
aws configure set s3.multipart_threshold 64MB
aws configure set s3.multipart_chunksize 16MB
aws configure set s3.max_concurrent_requests 20

# 리전 내 데이터 배치
aws s3 sync local_data/ s3://genomics-data-ap-northeast-2/ \
  --storage-class STANDARD_IA
```

### 8.2 운영적 도전과제

**도전과제 4: 비용 예측 및 제어**

*문제 상황:*
```
비용 변동성:
- 예상 비용: $200 per sample
- 실제 비용: $150-350 per sample (75% 변동)
- 주요 변수: 데이터 크기, 실행 시간, 실패/재시도
```

*해결 전략:*
```json
CloudWatch 예산 알림:
{
  "BudgetName": "HealthOmics-Monthly",
  "BudgetLimit": {
    "Amount": "50000",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "CostFilters": {
    "Service": ["Amazon Omics"]
  },
  "NotificationsWithSubscribers": [
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 80
      }
    }
  ]
}
```

*비용 최적화 도구:*
- AWS Cost Explorer: 상세 비용 분석
- 태그 기반 비용 추적: 프로젝트/사용자별 분리
- 자동 종료 정책: 장시간 실행 워크플로우 모니터링

**도전과제 5: 디버깅 및 문제 해결**

*문제 상황:*
```
워크플로우 실패 시 디버깅 복잡성:
- 다단계 파이프라인 (6 phases, 48 tasks)
- 분산 실행 환경
- 제한적인 로그 접근성
```

*해결 전략:*
```bash
# 체계적 디버깅 접근법
1. 실행 상태 확인
aws omics get-run --id <run-id> --region ap-northeast-2

2. 실패 태스크 식별
aws omics list-run-tasks --id <run-id> --status FAILED

3. 상세 로그 분석
aws logs get-log-events \
  --log-group-name /aws/omics/WorkflowLog \
  --log-stream-name run/<run-id>/task/<task-id>

4. 로컬 재현 테스트
miniwdl run -i inputs.json -d debug_output task.wdl
```

*디버깅 도구 및 모범 사례:*
- 소규모 테스트 데이터셋 활용 (1-5GB)
- 단계별 체크포인트 설정
- 상세 로깅 활성화
- 실패 시 자동 알림 설정

### 8.3 확장성 도전과제

**도전과제 6: 다중 사용자 및 프로젝트 관리**

*문제 상황:*
```
조직 확장 시 관리 복잡성:
- 다중 연구 그룹 (10+ teams)
- 프로젝트별 리소스 할당
- 비용 추적 및 차지백
```

*해결 전략:*
```
AWS Organizations 구조:
Root Account
├── Production OU
│   ├── Genomics-Team-A
│   ├── Genomics-Team-B
│   └── Shared-Resources
├── Development OU
│   └── Dev-Testing
└── Security OU
    └── Audit-Logging

태그 전략:
- Project: "HPRC-2024"
- Team: "TeamA"
- Environment: "Production"
- CostCenter: "Research-001"
```

**도전과제 7: 규정 준수 및 데이터 거버넌스**

*문제 상황:*
```
규정 준수 요구사항:
- HIPAA (의료 데이터)
- GDPR (개인정보 보호)
- 기관별 데이터 정책
- 감사 추적 요구사항
```

*해결 전략:*
```json
데이터 분류 및 보호:
{
  "DataClassification": {
    "Public": {
      "encryption": "AES-256",
      "access": "team-based"
    },
    "Sensitive": {
      "encryption": "KMS-managed",
      "access": "role-based",
      "audit": "required"
    },
    "Restricted": {
      "encryption": "customer-managed-KMS",
      "access": "individual-approval",
      "audit": "comprehensive",
      "retention": "7-years"
    }
  }
}
```

*규정 준수 도구:*
- AWS Config: 리소스 구성 모니터링
- AWS CloudTrail: API 호출 감사
- AWS Security Hub: 보안 상태 중앙 관리
- AWS Macie: 민감 데이터 자동 탐지


## 모범 사례 및 권장사항

### 9.1 개발 및 테스트 전략

**소규모 테스트 데이터셋 우선 접근:**
```
권장 테스트 데이터 크기:
- 개발 단계: 1-5GB (빠른 반복)
- 통합 테스트: 10-20GB (중간 규모)
- 성능 테스트: 50-100GB (실제 규모)
- 프로덕션 검증: 전체 규모 (200GB+)

이유:
- 디버깅 시간 단축 (30분 vs 24시간)
- 비용 절약 (개발 단계 90% 절감)
- 빠른 피드백 루프
- 리소스 요구사항 정확한 측정
```

**miniWDL 기반 로컬 개발 환경:**
```bash
# 로컬 개발 환경 설정
pip install miniwdl miniwdl-aws

# WDL 문법 검증
miniwdl check workflow.wdl

# 로컬 테스트 실행
miniwdl run -i test_inputs.json -d test_output workflow.wdl

# 입력 템플릿 생성
miniwdl run_self_test workflow.wdl --empty > inputs_template.json
```

### 9.2 스토리지 최적화 전략

**DYNAMIC → STATIC 전환 가이드라인:**
```
DYNAMIC 스토리지 사용 시나리오:
- 새로운 워크플로우 테스트
- 데이터 크기 예측 불가능
- 일회성 또는 불규칙한 실행
- 개발 및 프로토타이핑

STATIC 스토리지 전환 기준:
- 반복적인 워크플로우 (월 10회 이상)
- 예측 가능한 데이터 크기
- 성능 최적화 필요 (높은 IOPS)
- 비용 최적화 목표 (20% 절감)

전환 프로세스:
1. DYNAMIC으로 3-5회 실행
2. 평균 스토리지 사용량 측정
3. 20% 버퍼 추가하여 STATIC 크기 결정
4. 성능 및 비용 비교 분석
```

**데이터 라이프사이클 관리:**
```json
S3 라이프사이클 정책 예시:
{
  "Rules": [
    {
      "Id": "GenomicsDataLifecycle",
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        },
        {
          "Days": 365,
          "StorageClass": "DEEP_ARCHIVE"
        }
      ]
    }
  ]
}
```

### 9.3 성능 최적화 모범 사례

**리소스 프로파일링 및 최적화:**
```wdl
# 동적 리소스 할당 패턴
task hifiasm_assembly {
    input {
        File hifi_reads
        Int estimated_genome_size = 3000000000
    }
    
    # 파일 크기 기반 리소스 계산
    Int file_size_gb = ceil(size(hifi_reads, "GB"))
    Int memory_gb = if file_size_gb > 50 then 512 else 256
    Int cpu_count = if file_size_gb > 50 then 64 else 32
    Int disk_gb = file_size_gb * 3 + 100
    
    runtime {
        docker: "humanpangenomics/hifiasm:latest"
        memory: memory_gb + " GB"
        cpu: cpu_count
        disks: "local-disk " + disk_gb + " SSD"
        # 메모리 부족 시 자동 재시도
        maxRetries: 2
        memory_retry_multiplier: 1.5
    }
}
```

**병렬 처리 최적화:**
```
샘플별 독립 실행:
- 각 샘플을 별도 HealthOmics Run으로 실행
- 동시 실행 한도: 계정당 100개 Run
- 리소스 경합 최소화

태스크 내 병렬화:
- 멀티스레드 도구 활용 (hifiasm -t 64)
- I/O 병렬화 (pigz, pbzip2)
- GPU 가속 (DeepPolisher)
```

### 9.4 모니터링 및 알림 전략

**계층화된 모니터링 접근법:**
```
Level 1: 실시간 알림 (즉시 대응 필요)
- 워크플로우 실패
- 비용 임계값 초과 (80%)
- 보안 이벤트

Level 2: 일일 리포트 (정기 검토)
- 성능 메트릭 요약
- 리소스 사용률 분석
- 비용 트렌드 분석

Level 3: 주간/월간 분석 (전략적 최적화)
- 용량 계획
- 성능 최적화 기회
- 비용 최적화 권장사항
```

**자동화된 성능 분석:**
```bash
# HealthOmics MCP 도구 활용
# 워크플로우 성능 분석
aws omics analyze-run-performance \
  --run-ids "run1,run2,run3" \
  --analysis-type comprehensive

# 결과 예시:
{
  "optimization_recommendations": [
    {
      "task": "hifiasm_assembly",
      "current_memory": "512GB",
      "recommended_memory": "384GB",
      "potential_savings": "25%"
    }
  ]
}
```

### 9.5 보안 및 규정 준수 모범 사례

**데이터 분류 및 보호:**
```
데이터 분류 체계:
- Public: 참조 게놈, 공개 데이터셋
- Internal: 연구 결과, 분석 리포트
- Confidential: 개인 게놈 데이터
- Restricted: 의료 정보, 식별 가능 데이터

보호 수준별 요구사항:
- Encryption at rest: 모든 레벨 필수
- Encryption in transit: TLS 1.2+ 필수
- Access logging: Confidential 이상 필수
- Data retention: 규정에 따른 자동 삭제
```

**최소 권한 원칙 구현:**
```json
연구자 역할 정책 예시:
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "omics:StartRun",
        "omics:GetRun",
        "omics:ListRuns"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "ap-northeast-2"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-genomics-data-${aws:username}/*",
        "arn:aws:s3:::your-genomics-results-${aws:username}/*"
      ]
    }
  ]
}
```

### 9.6 비용 최적화 전략

**예측 가능한 비용 관리:**
```
비용 예측 모델:
- 기본 비용: $150 per sample (DYNAMIC 스토리지)
- 최적화 비용: $120 per sample (STATIC 스토리지)
- 대용량 샘플: +50% (>200GB 입력)
- GPU 사용: +30% (DeepPolisher 가속)

월간 예산 계획:
- 예상 샘플 수 × 샘플당 비용 × 1.2 (버퍼)
- 개발/테스트: 프로덕션 비용의 20%
- 재시도/실패: 총 비용의 10% 추가
```

**자동화된 비용 제어:**
```bash
# 예산 기반 자동 알림
aws budgets create-budget \
  --account-id 123456789012 \
  --budget '{
    "BudgetName": "HealthOmics-Monthly",
    "BudgetLimit": {
      "Amount": "50000",
      "Unit": "USD"
    },
    "TimeUnit": "MONTHLY"
  }' \
  --notifications-with-subscribers '[{
    "Notification": {
      "NotificationType": "FORECASTED",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 90
    },
    "Subscribers": [{
      "SubscriptionType": "EMAIL",
      "Address": "admin@your-organization.com"
    }]
  }]'
```
