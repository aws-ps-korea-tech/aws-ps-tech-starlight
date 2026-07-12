---
title: "리소스 요구사항 및 TCO 분석"
sidebar:
  order: 4
---

# 리소스 요구사항 및 TCO 분석

## 4.1 워크로드별 리소스 프로파일

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

## 4.2 TCO (Total Cost of Ownership) 분석

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

## 4.3 성능 벤치마킹

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