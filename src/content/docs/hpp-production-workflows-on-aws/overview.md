---
title: "개요와 프로젝트 분석"
sidebar:
  order: 1
---

# 개요와 프로젝트 분석

## 개요 및 Executive Summary

### HPP Production Workflows - AWS 구현 전략 보고서

### Executive Summary

Human Pangenome Reference Consortium (HPRC) Production Workflows는 차세대 시퀀싱 데이터로부터 고품질 diploid genome assembly를 생성하는 엔터프라이즈급 생물정보학 파이프라인입니다. 본 보고서는 AWS Solutions Architect가 고객의 HPP 워크플로우 클라우드 마이그레이션 및 최적화를 위한 종합적인 구현 전략을 제시합니다.

#### 핵심 권장사항:

- **AWS HealthOmics** 우선 채택으로 완전 관리형 genomics 서비스 활용
- **miniWDL 기반 하이브리드 접근법**으로 개발-테스트-프로덕션 파이프라인 구축
- **DYNAMIC 스토리지** 우선 적용 후 워크로드 특성에 따른 STATIC 전환 검토
- **소규모 테스트 데이터셋**으로 점진적 확장 전략 수립

### 프로젝트 개요

#### HPP Production Workflows란?

Human Pangenome Reference Consortium (HPRC)의 핵심 인프라로서 다음과 같은 기능을 제공합니다:

- **Data Processing QC**: HiFi, ONT, Hi-C 시퀀싱 데이터 품질 검증 및 샘플 스왑 탐지
- **Genome Assembly**: Hifiasm 기반 Hi-C/trio phasing 전략을 통한 assembly 생성
- **Assembly Polishing**: DeepPolisher transformer 모델 기반 정확도 향상
- **Assembly QC**: 완성도, 연속성, 정확도 종합 평가

#### 주요 사용자

- 대규모 시퀀싱 센터 (월 100+ 샘플 처리)
- 학술 연구기관 (프로젝트 기반 워크로드)
- 상업적 genomics 플랫폼 (SaaS 서비스 제공)
- Human pangenome consortium 멤버

#### 지원 데이터 타입

- **HiFi**: PacBio high-fidelity long reads (50-100 GB per sample)
- **ONT**: Oxford Nanopore ultra-long reads (80-200 GB per sample)
- **Hi-C**: Illumina proximity ligation sequencing (1-5 GB per sample)
- **Trio**: Parental Illumina data for phasing

#### 핵심 성능 지표

- **처리량**: 샘플당 24-48시간 내 완료
- **정확도**: QV 50+ (99.999% 정확도)
- **가용성**: 99.9% 업타임 요구
- **비용 효율성**: 샘플당 $200 이하 목표

### 비즈니스 가치 제안

#### 운영 효율성 향상

<div id="bkmrk-%EA%B8%B0%EC%A1%B4-%EC%98%A8%ED%94%84%EB%A0%88%EB%AF%B8%EC%8A%A4-%EB%8C%80%EB%B9%84-%EA%B0%9C%EC%84%A0-%ED%9A%A8%EA%B3%BC%3A-%E2%80%A2" style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #007bff; margin: 15px 0;">**기존 온프레미스 대비 개선 효과:**  
• 인프라 관리 시간: 80% 감소  
• 워크플로우 실행 시간: 20% 단축  
• 시스템 가용성: 99.9% 달성  
• 확장성: 10배 향상 (10 → 100+ 동시 샘플) </div>### 비용 최적화

<div id="bkmrk-tco-%EB%B6%84%EC%84%9D-%28%EC%97%B0%EA%B0%84-1%2C200-%EC%83%98%ED%94%8C-" style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #28a745; margin: 15px 0;">**TCO 분석 (연간 1,200 샘플 기준):**  
• HealthOmics: $240,000 (완전 관리형)  
• 온프레미스: $400,000 (하드웨어 + 인력)  
• 절감 효과: $160,000 (40% 절약)  
• ROI: 18개월 내 투자 회수 </div>### 혁신 가속화

- 새로운 워크플로우 개발 시간 50% 단축
- 연구자 생산성 향상 (인프라 관리 → 연구 집중)
- 글로벌 협업 기반 구축 (클라우드 네이티브)

### 문서 구조

본 가이드는 다음과 같은 구조로 구성되어 있습니다:

1. **프로젝트 분석 및 기술 스택** - 워크플로우 복잡성 및 기술적 특성 분석
2. **AWS 아키텍처 전략** - HealthOmics vs Batch 비교 및 하이브리드 접근법
3. **스토리지 전략 및 성능 최적화** - DYNAMIC/STATIC 스토리지 및 WDL 수정 요구사항
4. **리소스 요구사항 및 TCO 분석** - 워크로드별 리소스 프로파일 및 비용 분석
5. **보안 및 IAM 전략** - HealthOmics IAM 아키텍처 및 데이터 보안
6. **모니터링 및 운영 전략** - CloudWatch 메트릭 및 성능 최적화 도구
7. **구현 로드맵 및 마이그레이션 전략** - 4단계 11주 구현 계획
8. **도전과제 및 해결방안** - 실제 문제 사례 및 해결 전략
9. **모범 사례 및 권장사항** - 개발/테스트 전략 및 최적화 가이드
10. **FAQ 및 결론** - 자주 묻는 질문 및 최종 권장사항

<div id="bkmrk-%E2%9A%A0%EF%B8%8F-%EC%A4%91%EC%9A%94-%EC%B0%B8%EA%B3%A0%EC%82%AC%ED%95%AD%3A-%EB%B3%B8-%EB%AC%B8%EC%84%9C%EC%9D%98-%EB%AA%A8%EB%93%A0" style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0;">**⚠️ 중요 참고사항:**  
본 문서의 모든 예시에서 사용된 AWS 계정 ID, S3 버킷명, 이메일 주소 등은 보안을 위해 일반적인 플레이스홀더로 교체되었습니다. 실제 구현 시에는 고객의 실제 리소스명으로 교체하여 사용하시기 바랍니다. </div>


## 프로젝트 분석 및 기술 스택

### 1.1 비즈니스 요구사항

HPP Production Workflows는 Human Pangenome Reference Consortium의 핵심 인프라로서 다음과 같은 비즈니스 가치를 제공합니다:

#### 주요 사용자

- **대규모 시퀀싱 센터** (월 100+ 샘플 처리)
- **학술 연구기관** (프로젝트 기반 워크로드)
- **상업적 genomics 플랫폼** (SaaS 서비스 제공)

#### 핵심 성능 지표

- **처리량**: 샘플당 24-48시간 내 완료
- **정확도**: QV 50+ (99.999% 정확도)
- **가용성**: 99.9% 업타임 요구
- **비용 효율성**: 샘플당 $200 이하 목표

### 1.2 기술적 특성 분석

#### 워크플로우 복잡성

<div id="bkmrk-%EC%9B%8C%ED%81%AC%ED%94%8C%EB%A1%9C%EC%9A%B0-%EA%B5%AC%EC%A1%B0%3A-%E2%80%A2-6%EA%B0%9C-%EC%A3%BC%EC%9A%94-ph" style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #17a2b8; margin: 15px 0;">**워크플로우 구조:**  
• 6개 주요 Phase × 평균 8개 Task = 48개 병렬/순차 작업  
• 총 실행 시간: 24-72시간 (데이터 크기에 따라)  
• 피크 메모리 사용량: 512GB (Hifiasm assembly 단계)  
• 피크 스토리지 요구량: 1.5TB (중간 파일 포함) </div>### 데이터 플로우 특성

- **입력 데이터**: 50-300GB (HiFi + ONT + Hi-C)
- **중간 파일**: 2-3배 증폭 (압축 해제, 정렬 파일)
- **최종 출력**: 6-12GB (diploid assembly)
- **I/O 패턴**: 순차 읽기 중심, 랜덤 쓰기 발생

### 1.3 기술 스택 상세 분석

#### WDL v1.0 워크플로우 엔진

<table id="bkmrk-%ED%8A%B9%EC%84%B1-%EC%9E%A5%EC%A0%90-%EC%A0%9C%EC%95%BD%EC%82%AC%ED%95%AD-%EB%AC%B8%EB%B2%95-%EC%84%A0%EC%96%B8%EC%A0%81-%EB%AC%B8%EB%B2%95" style="width: 100%; border-collapse: collapse; margin: 15px 0;"><thead><tr style="background-color: #f8f9fa;"><th style="border: 1px solid #dee2e6; padding: 8px;">특성</th><th style="border: 1px solid #dee2e6; padding: 8px;">장점</th><th style="border: 1px solid #dee2e6; padding: 8px;">제약사항</th></tr></thead><tbody><tr><td style="border: 1px solid #dee2e6; padding: 8px;">문법</td><td style="border: 1px solid #dee2e6; padding: 8px;">선언적 문법, 강력한 타입 시스템</td><td style="border: 1px solid #dee2e6; padding: 8px;">동적 워크플로우 제한</td></tr><tr><td style="border: 1px solid #dee2e6; padding: 8px;">클라우드 지원</td><td style="border: 1px solid #dee2e6; padding: 8px;">클라우드 네이티브 설계</td><td style="border: 1px solid #dee2e6; padding: 8px;">디버깅 복잡성</td></tr><tr><td style="border: 1px solid #dee2e6; padding: 8px;">AWS 호환성</td><td style="border: 1px solid #dee2e6; padding: 8px;">HealthOmics 네이티브 지원</td><td style="border: 1px solid #dee2e6; padding: 8px;">일부 고급 기능 제한</td></tr></tbody></table>

#### 컨테이너 생태계

<div id="bkmrk-docker-%EC%9D%B4%EB%AF%B8%EC%A7%80-%ED%98%84%ED%99%A9%3A-%E2%80%A2-%EC%B4%9D-1" style="background-color: #f8f9fa; padding: 15px; border-left: 4px solid #6f42c1; margin: 15px 0;">**Docker 이미지 현황:**  
• 총 15개 Docker 이미지  
• 베이스 이미지: RedHat UBI7 (보안 강화)  
• 도구별 이미지: 평균 2-8GB 크기  
• ECR 저장 비용: 월 $15-30 예상 </div>### 핵심 생물정보학 도구

##### Hifiasm (Primary Assembly Engine)

- **특성**: 메모리 집약적 (256-512GB), CPU 집약적 (32-64 cores)
- **기능**: HiFi 및 ONT 데이터를 이용한 diploid genome assembly
- **성능**: 대용량 샘플 처리 시 12-48시간 소요

##### DeepPolisher (ML-based Polishing)

- **특성**: GPU 가속 권장 (V100/A100), Transformer 모델
- **기능**: 머신러닝 기반 assembly 정확도 향상
- **성능**: GPU 사용 시 4-10배 성능 향상

##### NTSM (Sample Swap Detection)

- **특성**: 경량 도구, 빠른 실행 (&lt; 30분)
- **기능**: k-mer 분석을 통한 샘플 스왑 탐지
- **성능**: 모든 QC 워크플로우에서 필수 실행

### 워크플로우 단계별 분석

#### Phase 1: Data Processing QC

<div id="bkmrk-%EB%AA%A9%EC%A0%81%3A-%EC%9B%90%EC%8B%9C-%EC%8B%9C%ED%80%80%EC%8B%B1-%EB%8D%B0%EC%9D%B4%ED%84%B0%EC%9D%98-%ED%92%88%EC%A7%88-%EA%B2%80" style="background-color: #e7f3ff; padding: 15px; border-radius: 5px; margin: 15px 0;">**목적:** 원시 시퀀싱 데이터의 품질 검증 및 메트릭 계산  
**주요 작업:**- HiFi QC: Coverage, N50, methylation 태그 확인
- ONT QC: Read length 분포, 품질 점수 분석
- Hi-C QC: Total bases 계산, 페어링 통계
- NTSM: 모든 데이터 타입에 대한 샘플 스왑 탐지

</div>### Phase 2: Genome Assembly

<div id="bkmrk-%EB%AA%A9%EC%A0%81%3A-hifi-%2B-ont-%2B-hi-" style="background-color: #fff2e7; padding: 15px; border-radius: 5px; margin: 15px 0;">**목적:** HiFi + ONT + Hi-C 데이터로 diploid assembly 생성  
**주요 작업:**- Cutadapt: HiFi adapter 제거
- Hifiasm: 메인 assembly 엔진 실행
- Yak: Sex chromosome 할당 (Hi-C phased)
- Format conversion: GFA → FASTA 변환

</div>### Phase 3: Assembly Cleanup

<div id="bkmrk-%EB%AA%A9%EC%A0%81%3A-contamination-%EC%A0%9C%EA%B1%B0" style="background-color: #f0fff0; padding: 15px; border-radius: 5px; margin: 15px 0;">**목적:** Contamination 제거 및 mitochondrial assembly  
**주요 작업:**- NCBI FCS: Foreign contamination screening
- Mitochondrial contig 제거
- MitoHiFi: Mitochondrial genome assembly
- Chromosome labeling: T2T contig 라벨링

</div>### Phase 4: Assembly Polishing

<div id="bkmrk-%EB%AA%A9%EC%A0%81%3A-deeppolisher%EB%A5%BC-%EC%9D%B4%EC%9A%A9" style="background-color: #fff0f5; padding: 15px; border-radius: 5px; margin: 15px 0;">**목적:** DeepPolisher를 이용한 assembly 정확도 향상  
**주요 작업:**- Minimap2: HiFi reads → diploid assembly 정렬
- PHARAOH: HiFi read phasing 최적화
- DeepPolisher: Transformer 모델 기반 polishing
- Quality assessment: Polishing 효과 검증

</div>### Phase 5: Assembly QC

<div id="bkmrk-%EB%AA%A9%EC%A0%81%3A-%EC%B5%9C%EC%A2%85-assembly-%ED%92%88%EC%A7%88-%ED%8F%89" style="background-color: #f5f0ff; padding: 15px; border-radius: 5px; margin: 15px 0;">**목적:** 최종 assembly 품질 평가  
**Standard QC:**- Compleasm: BUSCO-like completeness 평가
- Merqury: k-mer 기반 QC
- Dipcall: Variant calling
- T2T statistics: 연속성 메트릭

**Alignment-based QC:**- Flagger: Missassembly 탐지
- NucFreq: Nucleotide frequency 분석

</div>## 기술적 도전과제

#### 메모리 집약적 워크로드

- **Hifiasm**: 대용량 샘플 시 512GB+ 메모리 필요
- **해결방안**: 동적 메모리 할당, 메모리 최적화 알고리즘

#### I/O 집약적 작업

- **문제**: 대용량 파일 읽기/쓰기로 인한 병목
- **해결방안**: 고성능 스토리지 (FSx Lustre), 병렬 I/O

#### 장시간 실행

- **문제**: 단일 워크플로우 24-72시간 실행
- **해결방안**: 체크포인트, 재시작 메커니즘, 모니터링

<div id="bkmrk-%F0%9F%92%A1-%ED%95%B5%EC%8B%AC-%EC%9D%B8%EC%82%AC%EC%9D%B4%ED%8A%B8%3A-hpp-produ" style="background-color: #d1ecf1; padding: 15px; border-left: 4px solid #bee5eb; margin: 20px 0;">**💡 핵심 인사이트:**  
HPP Production Workflows는 전형적인 "Big Data + High Performance Computing" 워크로드입니다. 성공적인 클라우드 마이그레이션을 위해서는 메모리, 스토리지, 네트워크 모든 측면에서의 최적화가 필요합니다. </div>
