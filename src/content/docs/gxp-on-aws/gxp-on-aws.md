---
title: "문서 중심 검증에서 지속적 보증으로: 한국 제약·바이오를 위한 GxP on AWS"
---

# 문서 중심 검증에서 지속적 보증으로: 한국 제약·바이오를 위한 GxP on AWS

> **고객 검토용 최종본 | 2026년 10월 23일 기준**

제약·바이오 기업이 클라우드에서 GxP 시스템을 운영할 때 핵심은 시스템이 의도한 용도에 맞게 작동하고 통제되고 있음을 입증하는 것입니다. AWS 사용만으로 규제 준수가 완성되거나 별도의 GxP 인증이 부여되지는 않습니다. 적용 규정은 제품 유형, 시스템의 의도된 용도와 판매 국가에 따라 달라지며, 고객이 최종 판단과 검증 책임을 유지합니다. AWS도 공식 GxP 안내에서 같은 원칙을 설명합니다. ([AWS GxP][1])

이 글은 2021년 3월 발행 후 현재 “historical reference”로 표시된 *GxP Systems on AWS* whitepaper의 핵심 원칙을 유지하되, 2026년 현재의 FDA 가이던스, GAMP 5 Second Edition, EU 개정 동향과 AWS 서비스 상태를 반영해 정리했습니다. ([AWS GxP Systems on AWS][2])

## 1. CSV와 CSA를 구분해야 합니다

컴퓨터 시스템 검증(Computer System Validation, CSV)은 GxP 시스템이 의도한 용도에 적합하게 작동한다는 객관적 증거를 확보하고 유지하는 활동입니다. 검증 범위와 증거 수준은 시스템의 의도된 용도와 위험을 기준으로 정해야 합니다. 국제제약공학회(ISPE)의 GAMP 5도 환자 안전, 제품 품질과 데이터 완전성을 보호하는 위험 기반 생명주기 접근을 제시합니다. ([ISPE GAMP 5 Second Edition][3])

미국 식품의약국(FDA)은 2025년 9월 24일 *Computer Software Assurance for Production and Quality System Software* 최종 가이던스를 발행했고, 2026년 2월 3일 품질경영시스템규정(Quality Management System Regulation, QMSR) 용어를 반영한 현행 개정본을 공개했습니다. 현행 제목은 *Computer Software Assurance for Production and Quality Management System Software*입니다. 이 가이던스는 **의료기기 제조업체가 생산 또는 품질경영시스템에 사용하는 소프트웨어**를 대상으로 위험 기반 컴퓨터 소프트웨어 보증(Computer Software Assurance, CSA) 방법을 제시합니다. ([FDA CSA 현행 가이던스][4])

따라서 FDA CSA를 모든 제약·바이오 GxP 시스템에 적용되는 새로운 의무나, CSV 또는 21 CFR Part 11 전체를 대체하는 가이던스로 설명해서는 안 됩니다. 의료기기 분야에서는 공식 적용 범위에 따라 검토하고, 그 밖의 분야에서는 위험이 높은 기능에 보증 활동을 집중한다는 접근을 각 조직의 품질경영시스템과 적용 규정에 맞게 평가해야 합니다.

## 2. GAMP 5 Second Edition은 현대적 개발 방식을 반영합니다

ISPE는 2022년 7월 29일 *GAMP 5: A Risk-Based Approach to Compliant GxP Computerized Systems, Second Edition*을 발행했습니다. Second Edition은 기존의 위험 기반 프레임워크를 유지하면서 비판적 사고(critical thinking), Agile 개발, 클라우드 컴퓨팅, 자동화 도구와 인공지능·기계학습을 포함한 현대 기술의 품질 관점을 보강했습니다. ([ISPE 발행 안내][5])

이 접근의 목적은 검증을 생략하는 것이 아닙니다. 조직이 의도된 용도와 위험을 평가한 후 필요한 보증 활동과 객관적 증거를 선택하는 것입니다. 환자 안전, 제품 품질 또는 데이터 완전성에 미치는 영향이 큰 기능에는 더 높은 수준의 검토와 시험을 적용하고 그 판단 근거를 보존해야 합니다.

## 3. 한국·미국·유럽의 적용 범위를 구분합니다

한국 식품의약품안전처(MFDS)는 의약품실사상호협력기구(PIC/S)의 참여기관입니다. ([PIC/S 참여기관 목록][6]) 한국 고객은 국내 제품과 업무에 적용되는 법령 및 MFDS의 현행 지침을 먼저 확인하고, 대상 시장에 따라 추가 규정을 검토해야 합니다.

- 미국 규제 대상 전자 기록·전자서명에는 적용 범위에 따라 FDA 21 CFR Part 11을 검토합니다.
- 유럽의 의약품 제조 관련 컴퓨터화 시스템에는 적용 범위에 따라 EU GMP Annex 11을 검토합니다.
- PIC/S는 데이터 관리 및 완전성에 관한 PI 041-1 가이던스를 2021년 7월 1일 발효했습니다. 이 문서는 규제 GMP/GDP 환경의 데이터 완전성 위험과 규제 기대수준을 다룹니다. ([PIC/S PI 041-1 채택·발효 안내][7])

European Commission은 2025년 7월 Annex 11 개정안과 신규 Annex 22 인공지능 가이드 초안을 공개했습니다. 공개 협의는 2025년 10월 7일 종료됐지만, 해당 페이지는 두 문서를 계속 **Draft guidelines**로 표시합니다. 따라서 2026년 10월 현재 이를 최종 발효 규정으로 인용해서는 안 됩니다. ([European Commission 공개 협의][8])

## 4. AWS 공동 책임 모델을 GxP 통제에 적용합니다

AWS는 클라우드 인프라와 서비스 운영에 관한 보안·품질 통제를 수행합니다. 고객은 AWS에서 구성한 환경, 데이터, 접근 권한, 애플리케이션과 업무 절차를 통제합니다. 서비스 유형에 따라 양측의 운영 책임 범위가 달라집니다. ([AWS Shared Responsibility Model][9])

고객은 AWS Artifact에서 AWS의 ISO 인증서와 SOC 보고서 등 보안·컴플라이언스 자료를 확인하고 공급자 평가에 활용할 수 있습니다. 문서별 접근 조건이 적용될 수 있습니다. ([AWS Artifact 문서 다운로드][10])

고객 책임에는 다음 항목이 포함됩니다.

- 시스템의 의도된 용도와 GxP 영향 평가
- 사용자 요구사항, 위험, 통제와 시험 사이의 추적성
- 사용자 접근, 최소 권한, 직무 분리와 정기 검토
- 데이터 암호화, 보존, 백업과 복구
- 감사 추적과 전자서명 기능의 설계 및 검증
- 변경·일탈·사고·교육과 표준작업절차 관리

AWS 서비스의 기술 기능은 이러한 통제를 구현하고 증거를 생성하는 데 사용할 수 있지만, 서비스 활성화만으로 규제 준수가 입증되지는 않습니다.

## 5. 규제 랜딩 존에 공통 통제를 구현합니다

규제 랜딩 존은 GxP 워크로드가 공통으로 사용할 멀티계정 기반 환경과 통제를 정의한 것입니다. 조직은 적용 규정과 위험 평가 결과에 따라 다음 서비스를 조합할 수 있습니다.

- **AWS Control Tower**: 멀티계정 랜딩 존을 구성하고 예방·탐지·사전 예방 통제를 적용합니다. ([AWS Control Tower controls][11])
- **AWS Organizations 서비스 제어 정책(Service Control Policies, SCPs)**: 조직 내 계정에서 사용할 수 있는 최대 권한을 제한합니다. SCP는 권한을 직접 부여하지 않습니다. ([SCP 동작 방식][12])
- **AWS IAM Identity Center**: 멀티계정 사용자 접근과 권한 세트를 중앙에서 관리합니다. ([AWS IAM Identity Center][13])
- **AWS CloudTrail**: AWS 계정의 관리 이벤트와 선택한 데이터 이벤트를 기록합니다. 데이터 이벤트는 별도 설정이 필요하며 요금이 발생할 수 있습니다. ([AWS CloudTrail 데이터 이벤트][14])
- **AWS Config**: 지원되는 AWS 리소스의 구성과 변경 이력을 기록하고 규칙에 따라 구성을 평가합니다. ([AWS Config][15])
- **Amazon CloudWatch**: 지원되는 로그·지표를 수집하고 경보와 자동 대응을 구성합니다. ([Amazon CloudWatch][16])
- **AWS Key Management Service(AWS KMS)**: 암호화 키에 대한 생성·사용 권한과 사용 기록을 관리합니다. ([AWS KMS][17])
- **AWS Backup**: 지원되는 AWS 리소스의 백업 정책과 보존을 중앙에서 관리합니다. ([AWS Backup][18])

AWS Config가 제공하는 *Operational Best Practices for FDA Title 21 CFR Part 11* conformance pack은 AWS 리소스 구성에 대한 기술 검사를 시작하는 자료입니다. AWS 공식 문서는 이 conformance pack 자체가 특정 규제 표준 준수를 보장하지 않는다고 명시합니다. ([AWS Config 21 CFR Part 11 conformance pack][19])

## 6. 적격성 평가된 빌딩 블록을 재사용합니다

빌딩 블록은 승인된 구성과 시험 방법을 가진 단일 AWS 서비스 또는 서비스 조합입니다. 예를 들어 암호화와 접근 기록이 적용된 Amazon S3 저장소, 프라이빗 네트워크 구성을 가진 데이터베이스 또는 표준 애플리케이션 기반 구조를 정의할 수 있습니다.

다음은 위험 기반 빌딩 블록을 설계하기 위한 권장 절차입니다.

1. 의도된 용도와 기능·비기능 요구사항을 정의합니다.
2. 환자 안전, 제품 품질과 데이터 완전성 위험을 평가합니다.
3. 위험 완화 조치를 정책, 코드, 시험과 모니터링에 연결합니다.
4. AWS CloudFormation 또는 AWS Cloud Development Kit(AWS CDK)를 사용해 구성을 코드로 관리합니다.
5. 승인된 시험을 실행하고 결과와 승인 기록을 보호된 저장소에 보존합니다.
6. 운영 절차, 교육과 변경관리 기준을 갖춘 뒤 승인된 카탈로그를 통해 제공합니다.

기존 적격성 평가 결과를 재사용할 수 있는지는 의도된 용도, 구성, 서비스 변경과 위험 범위가 기존 평가 안에 있는지를 확인한 후 결정해야 합니다. 변경이 평가 범위를 벗어나면 영향 평가를 통해 추가 시험 또는 재적격성 평가 범위를 정합니다.

## 7. CI/CD 기록을 통제된 전자 증거로 활용합니다

지속적 통합·지속적 전달(Continuous Integration and Continuous Delivery, CI/CD) 파이프라인은 코드와 인프라 변경에 대해 검토, 시험, 승인, 배포와 롤백 기록을 생성할 수 있습니다. 이 기록을 검증 증거로 사용할지는 고객의 품질경영시스템에서 무결성, 보존, 접근, 검토와 승인 요건을 정의한 후 결정해야 합니다.

권장 흐름은 다음과 같습니다.

1. 요구사항과 위험 통제를 코드 변경 및 시험 사례에 연결합니다.
2. 변경에 대한 독립 검토와 필요한 승인을 기록합니다.
3. 정적 분석, 단위·통합·보안·구성 시험을 실행합니다.
4. 승인된 산출물만 비프로덕션 환경에서 검증합니다.
5. 정의된 승인 절차에 따라 프로덕션에 배포합니다.
6. 변경 식별자, 검토자, 시험 결과, 승인, 배포와 롤백 기록을 함께 보존합니다.

AWS Audit Manager는 자동 증거 수집 기능을 제공하지만, **현재 신규 고객에게는 제공되지 않으며 기존 고객만 계속 사용할 수 있습니다.** 또한 AWS 공식 문서는 Audit Manager가 고객의 규제 준수 자체를 평가하지 않는다고 명시합니다. ([AWS Audit Manager 가용성 및 제한][20]) 기존 고객은 적용 가능성을 평가할 수 있습니다. 신규 고객은 예를 들어 AWS Config, AWS CloudTrail, AWS Security Hub CSPM과 CI/CD 산출물을 조합하는 증거 수집 구조를 설계할 수 있으며, 각 증거의 적합성과 검토 절차는 고객이 정의해야 합니다.

## 8. 데이터 완전성과 복원력을 아키텍처에 반영합니다

PIC/S PI 041-1은 데이터 완전성을 데이터의 전체 생명주기 동안 완전하고 일관되며 정확한 상태로 정의하고, ALCOA+ 원칙을 설명합니다. ([PIC/S PI 041-1 원문][21]) 고객은 위험과 적용 규정에 따라 다음 기술 통제를 검토할 수 있습니다.

- 최소 권한과 직무 분리
- 전송 중·저장 시 암호화
- 필요한 관리 이벤트와 데이터 접근 이벤트 기록
- Amazon S3 Versioning과 S3 Object Lock을 사용한 객체 버전 및 보존 통제 ([Amazon S3 Object Lock][22])
- AWS Backup Vault Lock 또는 논리적으로 에어갭된 볼트를 사용한 백업 보호 ([AWS Backup logically air-gapped vault][23])
- 승인된 절차에 따른 복원 시험과 재해 복구 훈련
- 구성 이탈과 승인되지 않은 변경의 탐지·대응

장기 보관에는 접근 및 복구 요구사항에 따라 Amazon S3 Glacier Instant Retrieval, S3 Glacier Flexible Retrieval 또는 S3 Glacier Deep Archive 스토리지 클래스를 검토할 수 있습니다. ([Amazon S3 Glacier 스토리지 클래스][24]) 서버 재해 복구가 필요한 경우에는 지원 범위와 리전 가용성을 확인한 후 AWS Elastic Disaster Recovery(AWS DRS)를 검토할 수 있습니다. ([AWS DRS][25])

이 기능들은 데이터 보호 통제의 구성요소입니다. 원본 데이터의 정확성, 기록의 업무적 의미, 전자서명과 기록의 연결 또는 애플리케이션의 의도된 동작을 대신 검증하지 않습니다.

## 9. 권장 시작 순서

1. 품질, 규제, 보안, 플랫폼과 애플리케이션 담당자가 제품 유형, 대상 시장과 시스템의 의도된 용도를 합의합니다.
2. 적용 규정과 내부 품질 절차를 기준으로 통제 목표와 책임을 매핑합니다.
3. AWS Artifact의 현행 자료를 검토해 공급자 평가 범위를 결정합니다.
4. 규제 랜딩 존의 공통 통제와 증거 보존 기준을 정의합니다.
5. 첫 워크로드에 필요한 빌딩 블록을 위험 순서대로 설계하고 시험합니다.
6. CI/CD와 운영 서비스에서 생성되는 기록의 무결성·추적성·검토 절차를 정의합니다.
7. 변경, 일탈, 사고, 백업과 복원 절차를 포함해 운영 중 통제의 유효성을 정기적으로 검토합니다.

클라우드에서의 GxP 전환은 검증을 생략하는 과정이 아닙니다. 조직이 위험에 따라 보증 활동을 선택하고, 자동화된 시스템 기록을 통제된 증거로 활용하며, 운영 중에도 검증된 상태를 유지하도록 품질 프로세스를 설계하는 과정입니다.

---

## 고지

본 글은 AWS 서비스의 기술적 활용 방안을 공유하기 위한 일반 정보이며 법률 또는 규제 자문이 아닙니다. 의약품 제조 및 품질관리, 의료기기 품질관리, 데이터 완전성, 전자 기록·전자서명 등 규제의 적용 여부와 범위는 제품, 시스템의 의도된 용도와 대상 시장에 따라 달라집니다. 고객은 적용 규정의 판단과 시스템 검증에 대한 최종 책임을 유지합니다. 실제 적용 전 MFDS 등 관할 당국의 현행 법령과 가이드라인을 확인하고 자격을 갖춘 규제·법률 전문가의 검토를 받으시기 바랍니다.

## 참고 자료

[1]: https://aws.amazon.com/compliance/gxp-part-11-annex-11/
[2]: https://docs.aws.amazon.com/whitepapers/latest/gxp-systems-on-aws/gxp-systems-on-aws.html
[3]: https://ispe.org/publications/guidance-documents/gamp-5-guide-2nd-edition/
[4]: https://www.fda.gov/media/188844/download
[5]: https://ispe.org/pharmaceutical-engineering/ispeak/gampr-5-second-edition-here
[6]: https://picscheme.org/en/members
[7]: https://picscheme.org/en/news/adoption-and-entry-into-force-of-pics-guidance-on-good-pract
[8]: https://health.ec.europa.eu/consultations/stakeholders-consultation-eudralex-volume-4-good-manufacturing-practice-guidelines-chapter-4-annex_en
[9]: https://aws.amazon.com/compliance/shared-responsibility-model/
[10]: https://docs.aws.amazon.com/artifact/latest/ug/downloading-documents.html
[11]: https://docs.aws.amazon.com/prescriptive-guidance/latest/designing-control-tower-landing-zone/controls.html
[12]: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html
[13]: https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html
[14]: https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html
[15]: https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html
[16]: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html
[17]: https://docs.aws.amazon.com/kms/latest/developerguide/overview.html
[18]: https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html
[19]: https://docs.aws.amazon.com/config/latest/developerguide/operational-best-practices-for-FDA-21CFR-Part-11.html
[20]: https://docs.aws.amazon.com/audit-manager/latest/userguide/what-is.html
[21]: https://www.picscheme.org/layout/document.php?id=714
[22]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
[23]: https://docs.aws.amazon.com/aws-backup/latest/devguide/logicallyairgappedvault.html
[24]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/glacier-storage-classes.html
[25]: https://docs.aws.amazon.com/drs/latest/userguide/what-is-drs.html