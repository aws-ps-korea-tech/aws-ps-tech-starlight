---
title: "보안 솔루션 항목별 AWS 대응 방안"
---

# 보안 솔루션 항목별 AWS 대응 방안

이 페이지는 [AWS에서 처음 준비하는 ISMS-P: 5단계 로드맵](/draft-isms-p-on-aws/aws-isms-p-5/)의 4단계를 자세히 설명합니다. 다 읽고 나면 심사에서 자주 확인하는 보안 솔루션 항목마다 AWS 서비스로 구성할 수 있는지, 전문 솔루션이 필요한지 판단할 수 있습니다. 2026년 10월 기준 AWS 서비스 기능으로 정리했습니다.

---

## 한눈에 보기

| 항목 | AWS로 가능한가 | 쓸 기능 |
|---|---|---|
| 침입차단·탐지(IPS) | 가능 | AWS Network Firewall, 관리형 위협 차단 규칙 |
| 웹 공격 차단 | 가능 | AWS WAF |
| 디도스(DDoS) 대응 | 가능 | AWS Shield |
| DB 접속 경로·인증 통제 | 가능 | AWS Verified Access, RDS IAM DB 인증, AWS Secrets Manager |
| DB 접속·쿼리 감사 로그 | 일부 가능 | Database Activity Streams, 엔진 감사 로그 |
| 쿼리 결재, 위험 명령 차단, 개인정보 마스킹 | 어려움 | DB 접근제어 솔루션과 함께 구성 |
| 로그 위변조 방지 | 가능 | Amazon S3 Object Lock |
| 위협 탐지 | 가능 | Amazon GuardDuty |
| 취약점 점검 | 가능 | Amazon Inspector |

이 표는 서비스 기능을 기준으로 정리한 것입니다. 심사기관이나 사내 보안 정책이 별도 장비나 특정 인증 제품을 요구할 수 있으므로, 구성 방식을 정하기 전에 먼저 확인합니다.

---

## 1. 침입차단·탐지(IPS)

### AWS Network Firewall

AWS Network Firewall은 VPC(Virtual Private Cloud)에 두는 관리형 방화벽이자 침입탐지·차단 서비스입니다. 오픈소스 IPS 엔진인 Suricata로 트래픽을 검사하고, Suricata 호환 규칙을 그대로 쓸 수 있습니다.

| 기능 | 내용 |
|---|---|
| 상태 기반 검사(Stateful inspection) | Suricata 호환 규칙, 도메인 필터링, 5-튜플(출발지·목적지 IP와 포트, 프로토콜) 규칙으로 트래픽 검사 |
| 패킷 심층 검사(Deep Packet Inspection) | VPC로 들어오고 나가는 트래픽의 내용까지 검사 |
| 관리형 위협 시그니처 규칙 | 맬웨어·익스플로잇, 서비스 거부 공격, 봇넷, 웹 공격, 스캐닝 도구 등 카테고리별 규칙을 AWS가 관리 |
| 관리형 위협 차단 규칙 (Active threat defense) | Amazon 위협 인텔리전스로 맬웨어 유포 주소, 봇넷 명령 서버, 암호화폐 채굴 풀과의 통신을 차단. 2025년 6월 출시 |

### 이렇게 구성하세요

1. 보호할 VPC에 Network Firewall 엔드포인트를 만들고, 라우팅 테이블을 바꿔 트래픽이 방화벽을 거치게 합니다.
2. 방화벽 정책에 관리형 위협 시그니처 규칙과 관리형 위협 차단 규칙을 추가합니다.
3. 관리형 위협 차단 규칙의 동작 모드를 확인합니다. 2025년 11월부터 콘솔에서 새 정책을 만들면 이 규칙이 **알림 모드**로 기본 활성화됩니다. 알림 모드는 탐지만 하고 차단하지 않으므로, 실제로 막으려면 **차단 모드**로 바꿉니다.
4. 방화벽 로그를 Amazon S3나 Amazon CloudWatch Logs로 보내 탐지·차단 기록을 남깁니다.

### 심사 증적

- 방화벽 정책과 규칙 그룹 설정 화면
- 탐지·차단 로그와 보관 설정
- 규칙 변경 이력 (AWS CloudTrail)

### 함께 쓰면 좋은 서비스

- **AWS WAF:** 웹 애플리케이션 앞에서 SQL 인젝션, 크로스사이트 스크립팅 같은 웹 공격을 차단합니다.
- **AWS Shield:** 디도스 공격을 완화합니다. Standard는 기본 제공되고, Advanced는 추가 대응 기능을 제공합니다.
- **Amazon GuardDuty:** 계정과 워크로드의 위협을 탐지합니다. GuardDuty가 탐지한 위협 일부는 Network Firewall 관리형 위협 차단 규칙과 연동해 차단할 수 있습니다.

---

## 2. DB 접근통제

DB 접근통제는 세 층으로 나눠 보면 AWS로 되는 부분과 전문 솔루션이 필요한 부분이 구분됩니다.

| 층 | 무엇을 통제하나 | AWS로 가능한가 | 쓸 기능 |
|---|---|---|---|
| ① 접속 경로·인증 | 누가, 어떤 경로로 DB에 접속하나 | 가능 | AWS Verified Access, RDS IAM DB 인증, AWS Secrets Manager, Session Manager 포트 포워딩 |
| ② 접속·쿼리 감사 로그 | 누가 언제 어떤 쿼리를 실행했나 | 일부 가능 | Database Activity Streams, 엔진 감사 로그 |
| ③ 쿼리 단위 통제 | 쿼리 결재, 위험 명령 차단, 개인정보 마스킹, 사용자별 조회 결과 기록 | 어려움 | DB 접근제어 솔루션 |

### ① 접속 경로·인증

| 기능 | 내용 | 확인할 점 |
|---|---|---|
| AWS Verified Access | VPN 없이 사용자와 기기 조건을 확인한 뒤 Amazon RDS에 접속하도록 통제합니다. 2025년 2월부터 RDS 같은 비 HTTP 리소스를 지원합니다. | TCP 연결만 지원합니다. |
| Amazon RDS IAM DB 인증 | 고정 비밀번호 대신 IAM으로 발급한 임시 인증 토큰으로 DB에 접속합니다. 사용자별 IAM 권한으로 접속을 통제합니다. | 지원 엔진과 연결 수 제한은 공식 문서에서 확인합니다. |
| AWS Secrets Manager | DB 자격증명을 저장하고 자동으로 교체합니다. | 애플리케이션이 Secrets Manager에서 자격증명을 받아 오도록 구성해야 합니다. |
| AWS Systems Manager Session Manager 포트 포워딩 | 공개 IP와 SSH 포트를 열지 않고 내 PC에서 RDS로 접속합니다. | VPC 안에 중계 역할을 할 관리형 서버(EC2 등)가 필요합니다. 포트 포워딩 세션 안의 DB 명령 내역은 Session Manager 로그에 기록되지 않습니다. |

### ② 접속·쿼리 감사 로그

| 기능 | 지원 엔진 | 내용 |
|---|---|---|
| Database Activity Streams | Amazon Aurora(MySQL, PostgreSQL), Amazon RDS for Oracle, Amazon RDS for SQL Server | DB 활동을 거의 실시간 스트림으로 Amazon Kinesis에 내보냅니다. 내부자 위협에 대비해 DB 관리자(DBA)가 스트림의 수집·전송·저장·처리에 접근하지 못하도록 구성할 수 있습니다. |
| MariaDB 감사 플러그인 | Amazon RDS for MySQL, Amazon RDS for MariaDB | 옵션 그룹에 `MARIADB_AUDIT_PLUGIN`을 추가하면 접속과 실행한 쿼리가 감사 로그 파일에 기록됩니다. |
| pgAudit 확장 | Amazon RDS for PostgreSQL, Amazon Aurora PostgreSQL | 파라미터 그룹에 pgAudit을 추가하면 기본 로그보다 자세한 정보(변경한 사용자, 스키마 등)가 PostgreSQL 로그에 남습니다. |
| Amazon CloudWatch Logs | 위 엔진 공통 | 감사 로그를 CloudWatch Logs로 내보내 보관하고 검색합니다. |
| Amazon S3 Object Lock | 로그 저장소 | 감사 로그를 정해진 기간 동안 수정·삭제할 수 없게 보관합니다(ISMS-P 2.9.4 로그 및 접속기록 관리). |

Database Activity Streams를 쓰기 전에 확인할 점:
- 기능 자체는 무료지만 Amazon Kinesis 데이터 스트림 비용이 발생합니다.
- AWS KMS 키가 필요합니다. 스트림은 항상 암호화됩니다.
- 지원하는 DB 인스턴스 클래스가 정해져 있습니다(Aurora 기준 large 이상 등). 엔진 버전과 리전별 지원 여부는 공식 문서에서 확인합니다.

### ③ 쿼리 단위 통제

다음 기능은 현재 AWS 기본 기능만으로는 제공되지 않습니다.

- 쿼리 실행 전 결재(승인) 절차
- 위험 명령(대량 삭제, 테이블 삭제 등) 차단
- 개인정보 컬럼 마스킹 조회
- 사용자별 쿼리와 조회 결과를 묶은 접근 기록 리포트

이런 요건이 있다면 DB 접근제어 솔루션을 함께 구성합니다. AWS Marketplace 등에서 AWS 환경을 지원하는 제품을 검토할 수 있습니다.

### 이렇게 구성하세요

1. **①을 먼저 구성합니다.** 공유 계정 하나로 접속하면 ②의 로그에 사람이 구분되어 남지 않습니다. 사용자별 인증(IAM DB 인증, 개인별 DB 계정)을 먼저 적용합니다.
2. **②로 로그를 남깁니다.** 쓰는 엔진에 맞게 Database Activity Streams나 엔진 감사 로그를 켜고, 로그를 위변조 방지 저장소에 보관합니다.
3. **③의 필요 여부를 판단합니다.** 심사기관이 요구하는 수준과 사내 개인정보 처리 정책을 확인한 뒤 DB 접근제어 솔루션 도입을 결정합니다.

### 심사 증적

- DB 접속 경로 구성도와 접근 정책 (Verified Access 정책, IAM 정책)
- 사용자별 접속 기록과 쿼리 감사 로그
- 로그 보관 기간과 위변조 방지 설정
- (솔루션 도입 시) 결재 기록, 마스킹 정책

---

## 3. 로그 보관과 위변조 방지

| 기능 | 내용 |
|---|---|
| AWS CloudTrail | AWS 계정의 API 호출과 콘솔 작업을 기록합니다. 로그 파일 무결성 검증 기능으로 변조 여부를 확인할 수 있습니다. |
| Amazon S3 Object Lock | 로그를 정해진 기간 동안 수정·삭제할 수 없게 보관합니다. |
| VPC 흐름 로그 | 네트워크 트래픽 기록을 남깁니다. |

### 이렇게 구성하세요

1. 모든 리전에서 CloudTrail을 켜고, 로그 파일 무결성 검증을 활성화합니다.
2. 로그를 별도 로그 보관 계정의 S3 버킷으로 모으고, Object Lock으로 보관 기간을 설정합니다.
3. 보관 기간은 ISMS-P 기준과 관련 법령, 사내 정책 중 가장 긴 기간을 따릅니다.

---

## 4. 위협 탐지와 취약점 점검

| 항목 | 쓸 기능 | 내용 |
|---|---|---|
| 위협 탐지 | Amazon GuardDuty | CloudTrail, VPC 흐름 로그, DNS 로그 등을 분석해 계정 탈취, 비정상 통신 같은 위협을 탐지합니다. |
| 서버 악성코드 검사 | GuardDuty Malware Protection | 위협이 탐지되거나 요청할 때 EC2의 디스크(EBS)를 검사합니다. 서버에 설치해 상시 동작하는 백신과는 방식이 다르므로, 상시 백신을 요구받으면 별도 제품을 검토합니다. |
| 취약점 점검 | Amazon Inspector | EC2, 컨테이너 이미지, Lambda 함수의 소프트웨어 취약점을 계속 점검합니다. |
| 보안 현황 통합 | AWS Security Hub | 여러 보안 서비스의 탐지 결과를 한곳에서 봅니다. |

---

## 5. 처음 준비할 때 권장 순서

1. 이 페이지의 한눈에 보기 표로 AWS 서비스로 구성할 항목과 전문 솔루션을 검토할 항목을 나눕니다.
2. 심사기관과 사내 보안 정책이 특정 제품이나 장비를 요구하는지 확인합니다.
3. AWS 서비스로 구성할 항목부터 배포하고, [AWS Config K-ISMS 적합성 팩](/draft-isms-p-on-aws/aws-config-k-isms/)으로 설정 상태를 점검합니다.
4. 전문 솔루션이 필요한 항목은 AWS 환경 지원 여부와 로그 연동 방식을 확인한 뒤 도입합니다.

---

## 출처

- [What is AWS Network Firewall?](https://docs.aws.amazon.com/network-firewall/latest/developerguide/what-is-aws-network-firewall.html)
- [AWS threat signature managed rule groups for AWS Network Firewall](https://docs.aws.amazon.com/network-firewall/latest/developerguide/aws-managed-rule-groups-threat-signature.html)
- [AWS active threat defense for AWS Network Firewall](https://docs.aws.amazon.com/network-firewall/latest/developerguide/aws-managed-rule-groups-atd.html)
- [AWS Network Firewall launches support for active threat defense (2025-06)](https://aws.amazon.com/about-aws/whats-new/2025/06/aws-network-firewall-active-threat-defense/)
- [Active threat defense now enabled by default in AWS Network Firewall (2025-11)](https://aws.amazon.com/about-aws/whats-new/2025/11/active-threat-defense-default-network-firewall)
- [AWS Verified Access: Create an Amazon RDS endpoint](https://docs.aws.amazon.com/verified-access/latest/ug/create-rds-endpoint.html)
- [AWS Verified Access launches Zero Trust access to non-HTTP(S) resources (2025-02)](https://aws.amazon.com/about-aws/whats-new/2025/02/aws-verified-access-zero-trust-resources-non-https-protocols)
- [Amazon RDS IAM database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.Connecting.html)
- [Session Manager: Start a session (port forwarding)](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-sessions-start.html)
- [Session Manager: Enabling and disabling session logging](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-logging.html)
- [Supported Regions and DB engines for Database Activity Streams in Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RDS_Fea_Regions_DB-eng.Feature.DBActivityStreams.html)
- [Monitoring Amazon Aurora with Database Activity Streams](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/DBActivityStreams.html)
- [MariaDB Audit Plugin support for MySQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.MySQL.Options.AuditPlugin.html)
- [Options for MariaDB database engine](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.MariaDB.Options.html)
- [Using pgAudit to log database activity](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.pgaudit.html)
