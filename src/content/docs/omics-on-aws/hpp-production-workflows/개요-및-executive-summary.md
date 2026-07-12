---
title: "개요 및 Executive Summary"
sidebar:
  order: 0
---

# HPP Production Workflows - AWS 구현 전략 보고서

## Executive Summary

Human Pangenome Reference Consortium (HPRC) Production Workflows는 차세대 시퀀싱 데이터로부터 고품질 diploid genome assembly를 생성하는 엔터프라이즈급 생물정보학 파이프라인입니다. 본 보고서는 AWS Solutions Architect가 고객의 HPP 워크플로우 클라우드 마이그레이션 및 최적화를 위한 종합적인 구현 전략을 제시합니다.

### 핵심 권장사항:

- **AWS HealthOmics** 우선 채택으로 완전 관리형 genomics 서비스 활용
- **miniWDL 기반 하이브리드 접근법**으로 개발-테스트-프로덕션 파이프라인 구축
- **DYNAMIC 스토리지** 우선 적용 후 워크로드 특성에 따른 STATIC 전환 검토
- **소규모 테스트 데이터셋**으로 점진적 확장 전략 수립

## 프로젝트 개요

### HPP Production Workflows란?

Human Pangenome Reference Consortium (HPRC)의 핵심 인프라로서 다음과 같은 기능을 제공합니다:

- **Data Processing QC**: HiFi, ONT, Hi-C 시퀀싱 데이터 품질 검증 및 샘플 스왑 탐지
- **Genome Assembly**: Hifiasm 기반 Hi-C/trio phasing 전략을 통한 assembly 생성
- **Assembly Polishing**: DeepPolisher transformer 모델 기반 정확도 향상
- **Assembly QC**: 완성도, 연속성, 정확도 종합 평가

### 주요 사용자

- 대규모 시퀀싱 센터 (월 100+ 샘플 처리)
- 학술 연구기관 (프로젝트 기반 워크로드)
- 상업적 genomics 플랫폼 (SaaS 서비스 제공)
- Human pangenome consortium 멤버

### 지원 데이터 타입

- **HiFi**: PacBio high-fidelity long reads (50-100 GB per sample)
- **ONT**: Oxford Nanopore ultra-long reads (80-200 GB per sample)
- **Hi-C**: Illumina proximity ligation sequencing (1-5 GB per sample)
- **Trio**: Parental Illumina data for phasing

### 핵심 성능 지표

- **처리량**: 샘플당 24-48시간 내 완료
- **정확도**: QV 50+ (99.999% 정확도)
- **가용성**: 99.9% 업타임 요구
- **비용 효율성**: 샘플당 $200 이하 목표

## 비즈니스 가치 제안

### 운영 효율성 향상

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

## 문서 구조

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