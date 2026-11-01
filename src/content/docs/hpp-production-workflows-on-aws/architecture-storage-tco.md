---
title: "아키텍처·스토리지·TCO"
sidebar:
  order: 2
---

# 아키텍처·스토리지·TCO

## AWS 아키텍처 전략

### 2.1 AWS HealthOmics 우선 전략 (권장)

**비즈니스 가치:**
- **완전 관리형**: 인프라 운영 오버헤드 90% 감소
- **Genomics 최적화**: 생물정보학 워크로드 특화 성능 튜닝
- **규정 준수**: HIPAA, SOC 2 Type II 인증 기본 제공
- **비용 투명성**: 사용량 기반 과금, 예측 가능한 비용 구조

**기술적 우위:**
```
HealthOmics 특화 기능:
- WDL 네이티브 실행 엔진 (Cromwell 대비 20% 성능 향상)
- 자동 스케일링 (0-1000+ vCPU, 수초 내 프로비저닝)
- 공유 파일시스템 (EFS/FSx Lustre 자동 관리)
- 내장 모니터링 (CloudWatch 통합, 실시간 메트릭)
```

**제약사항 및 대응방안:**
- **리전 제한**: 현재 8개 리전 지원 → ap-northeast-2 (Seoul) 사용 가능
- **WDL 호환성**: 일부 고급 기능 제한 → miniWDL 로컬 테스트로 검증
- **커스터마이징**: 제한적 런타임 설정 → 표준화된 컨테이너 이미지 활용

### 2.2 하이브리드 접근법: miniWDL + HealthOmics

**개발-테스트-프로덕션 파이프라인:**
```
로컬 개발 (miniWDL) → 클라우드 테스트 (HealthOmics) → 프로덕션 (HealthOmics)
```

**miniWDL 활용 시나리오:**
- **워크플로우 개발**: 빠른 반복 개발, 로컬 디버깅
- **소규모 테스트**: 비용 효율적인 검증 환경
- **교육 및 데모**: 온프레미스 환경에서의 시연

**HealthOmics 활용 시나리오:**
- **프로덕션 워크로드**: 대용량 데이터, 높은 가용성 요구
- **배치 처리**: 다중 샘플 병렬 처리
- **규정 준수**: 의료 데이터 처리 요구사항

### 2.3 AWS Batch 대안 시나리오

**적용 케이스:**
- 기존 Cromwell 인프라 보유 고객
- 극도의 커스터마이징 요구 (특수 하드웨어, 네트워크 설정)
- 하이브리드 클라우드 요구사항

**기술적 고려사항:**
```
AWS Batch 설정 복잡성:
- Job Queue 설정: 인스턴스 타입별 큐 분리 필요
- Auto Scaling: 커스텀 메트릭 기반 스케일링 설정
- 네트워킹: VPC, 보안 그룹, NAT Gateway 구성
- 모니터링: CloudWatch + 서드파티 도구 통합
```

**성능 특성:**
- **스케일링 지연**: 2-5분 (인스턴스 프로비저닝)
- **오버헤드**: 컨테이너 시작 시간 30-60초
- **비용**: HealthOmics 대비 10-20% 절약 가능 (최적화 시)


## 스토리지 전략 및 성능 최적화

### 3.1 HealthOmics 스토리지 아키텍처

**공유 파일시스템 특성:**
```
HealthOmics 런타임 환경:
- EFS (Elastic File System): 기본 공유 스토리지
- FSx for Lustre: 고성능 워크로드 옵션
- Run별 공유: 동일 Run 내 모든 Task가 파일시스템 공유
- 네트워크 레이턴시: 1-5ms (EFS), <1ms (FSx Lustre)
```

**DYNAMIC vs STATIC 스토리지 전략:**

**DYNAMIC 스토리지 (권장 시작점):**
- **장점**: 사용량 기반 과금, 자동 확장, 관리 오버헤드 없음
- **성능**: 최대 7,000 IOPS, 1GB/s 처리량
- **비용**: $0.30/GB/월 (사용량 기반)
- **적용 시나리오**: 대부분의 워크로드, 예측 불가능한 데이터 크기

**STATIC 스토리지 (최적화 후 전환):**
- **장점**: 예측 가능한 비용, 높은 IOPS (최대 20,000)
- **성능**: 프로비저닝된 처리량, 일관된 레이턴시
- **비용**: $0.20/GB/월 (프로비저닝 기반)
- **적용 시나리오**: 대용량 반복 워크로드, 성능 최적화 필요

### 3.2 워크플로우 수정 요구사항

**공유 스토리지로 인한 WDL 수정 사항:**

**문제 상황 - 심볼릭 링크 오류:**
```bash
# 기존 코드 (문제 발생)
elif [[ "$SUFFIX" == "gz" ]] ; then
    ln -s ~{readFile} output/${PREFIX}.gz  # 작업 디렉토리 외부 참조
fi

# 수정된 코드 (권장)
elif [[ "$SUFFIX" == "gz" ]] ; then
    cp ~{readFile} output/${PREFIX}.gz     # 파일 복사로 변경
fi
```

**근본 원인:**
- HealthOmics 보안 정책: 작업 디렉토리 외부 경로 참조 금지
- 심볼릭 링크가 `/mnt/inputs/` (외부) → `output/` (내부) 참조 시도
- OutputError 발생: "path outside working directory"

**해결 전략:**
1. **파일 복사 방식**: 안전하지만 스토리지 사용량 2배
2. **하드 링크 방식**: 동일 파일시스템 내에서 효율적
3. **조건부 처리**: 파일 형식에 따른 선택적 처리

### 3.3 성능 최적화 가이드라인

**I/O 최적화:**
```
파일 액세스 패턴 최적화:
- 순차 읽기: EFS 최적화 (prefetch 활용)
- 랜덤 액세스: FSx Lustre 권장
- 대용량 파일: 멀티스레드 I/O 활용
- 임시 파일: 로컬 SSD 활용 (/tmp)
```

**네트워크 최적화:**
- **EFS 마운트 옵션**: `nfsvers=4.1,rsize=1048576,wsize=1048576`
- **FSx Lustre**: 병렬 파일시스템, 높은 처리량
- **데이터 지역성**: 동일 AZ 내 리소스 배치


## 리소스 요구사항 및 TCO 분석

### 4.1 워크로드별 리소스 프로파일

**Phase 1: Data Processing QC**
```
리소스 요구사항:
- CPU: 8-16 cores (NTSM 병렬 처리)
- Memory: 32-64 GB (k-mer 데이터베이스)
- Storage: 200-400 GB (압축 해제 + 중간 파일)
- 실행 시간: 2-4시간
- 병렬성: 샘플별 독립 실행 가능

HealthOmics 권장 설정:
- vCPU: 16
- Memory: 64 GB
- Storage: DYNAMIC (자동 확장)
```

**Phase 2: Genome Assembly (Hifiasm)**
```
리소스 요구사항:
- CPU: 32-64 cores (멀티스레드 최적화)
- Memory: 256-512 GB (그래프 구조 메모리 상주)
- Storage: 500-1000 GB (중간 그래프 파일)
- 실행 시간: 12-48시간 (데이터 크기 의존)
- 병렬성: 단일 샘플 내 제한적

HealthOmics 권장 설정:
- vCPU: 64
- Memory: 512 GB
- Storage: STATIC 1200 GB (성능 최적화)
```

**Phase 3: Assembly Polishing (DeepPolisher)**
```
리소스 요구사항:
- CPU: 16-32 cores
- Memory: 128-256 GB
- GPU: V100/A100 (선택적, 10x 성능 향상)
- Storage: 400-800 GB
- 실행 시간: 8-24시간 (GPU 사용 시 2-6시간)

HealthOmics 권장 설정:
- vCPU: 32
- Memory: 256 GB
- GPU: 1x V100 (가용 시)
- Storage: DYNAMIC
```

### 4.2 TCO (Total Cost of Ownership) 분석

**AWS HealthOmics 비용 구조:**
```
단일 샘플 처리 비용 (ap-northeast-2):
- 컴퓨팅: $120-200 (vCPU-hour 기반)
- 스토리지: $30-50 (GB-hour 기반)
- 데이터 전송: $10-20 (S3 I/O)
- 총 비용: $160-270 per sample

월간 100 샘플 처리 시:
- 총 비용: $16,000-27,000
- 인프라 관리 비용 절약: $8,000-12,000
- 실질 비용: $16,000-27,000 (완전 관리형)
```

**AWS Batch 대안 비용:**
```
동일 워크로드 AWS Batch:
- EC2 인스턴스: $100-180 per sample
- EBS 스토리지: $20-40 per sample
- 운영 비용: $30-50 per sample (DevOps 인력)
- 총 비용: $150-270 per sample

월간 100 샘플 처리 시:
- 총 비용: $15,000-27,000
- 추가 운영 인력: 1-2 FTE ($120,000-240,000/년)
- 실질 비용: $25,000-47,000/월
```

**비용 최적화 전략:**
1. **DYNAMIC → STATIC 전환**: 반복 워크로드 20% 비용 절감
2. **스팟 인스턴스**: AWS Batch 환경에서 30-50% 절감
3. **데이터 라이프사이클**: S3 Intelligent Tiering으로 스토리지 비용 40% 절감
4. **리전 최적화**: 데이터 지역성으로 전송 비용 최소화

### 4.3 성능 벤치마킹

**실제 성능 데이터 (HG002 샘플 기준):**
```
데이터 크기: 177.4 GB (HiFi 95.7GB + ONT 80.1GB + Hi-C 1.6GB)

HealthOmics 실행 결과:
- Data Processing QC: 3.2시간
- Assembly: 28시간
- Polishing: 14시간 (GPU 미사용)
- Total QC: 6시간
- 총 실행 시간: 51.2시간
- 총 비용: $243

miniWDL (r5.16xlarge) 비교:
- 동일 워크로드: 58시간
- 인스턴스 비용: $319 (58h × $5.5/h)
- 추가 관리 비용: $50-100
- 총 비용: $369-419
```
