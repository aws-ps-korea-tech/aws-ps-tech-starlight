---
title: "Storage Browser for S3와 CloudFront 정액제로 수백 GB 유전체 데이터 배포 포털 만들기"
sidebar:
  order: 1
---

# Storage Browser for S3와 CloudFront 정액제로 수백 GB 유전체 데이터 배포 포털 만들기

> 이 글은 3부로 나뉘어 있습니다: [1부](/genome-data-delivery-portal-on-aws/storage-browser-for-s3-cloudfront-gb/) · [2부](/genome-data-delivery-portal-on-aws/genome-portal-download-engine/) · [3부](/genome-data-delivery-portal-on-aws/genome-portal-operations-cost/)

유전체 분석 서비스는 분석이 끝난 결과 파일을 고객에게 전달해야 합니다. 이 파일은 크고, 반복해서 내려받히고, 멀리서 받습니다. BAM(참조 서열에 정렬된 서열 데이터) 하나가 100~150 GB, FASTQ(원시 서열 데이터) 묶음이 100 GB를 넘으며, 같은 파일을 해외 연구그룹과 국내 인력이 서로 다른 장소에서 여러 번 내려받습니다. 월 전송량이 100 TB 규모가 되면 Amazon S3에서 인터넷으로 나가는 전송 요금이 그대로 운영비가 되고, 해외 사용자에게는 몇 시간짜리 다운로드가 중간에 끊겼을 때 처음부터 다시 받아야 하는 문제가 비용보다 먼저 체감됩니다.

이 글은 그 요구를 **Storage Browser for Amazon S3 + Amazon Cognito + S3 Access Grants + Amazon CloudFront 정액제 플랜**으로 구성한 참조 구현을 설명합니다. 코드는 GitHub [hmkim/omics-data-delivery-portal](https://github.com/hmkim/omics-data-delivery-portal)에 MIT-0 라이선스로 공개되어 있고, 글에 나오는 측정값은 개발 계정(서울 리전)에 실제로 배포해 측정한 값입니다. 다루는 내용은 다섯 가지입니다.

1. 로그인과 폴더 탐색은 Storage Browser 컴포넌트에 맡기고, 권한 계산은 S3 Access Grants에 위임합니다.
2. "같은 파일의 두 번째 다운로드부터 CloudFront"라는 경로 규칙을 DynamoDB 원자 카운터 하나로 구현합니다.
3. CloudFront의 단일 객체 한도(50 GB)를 넘는 파일은 브라우저가 8 GiB 조각으로 나눠 받고, 브라우저 안에서 이어받기·검증·저장까지 처리합니다. Chrome/Edge뿐 아니라 Firefox처럼 저장 위치 선택 API가 없는 브라우저도 같은 엔진을 사용합니다.
4. CloudFront 정액제 플랜(Pro)을 CloudFormation으로 연결하되, 플랜이 허용하는 기능 안에서 설계합니다.
5. 표준 로그를 Athena로 집계해 캐시 히트율과 허용량 사용률을 매일 계산하고 알람을 겁니다.

대상 독자는 AWS 서비스 이름은 알지만 브라우저의 파일 저장 API나 CloudFront 정액제 플랜은 처음 접하는 엔지니어와 기획자입니다. 기술 용어는 처음 나올 때 괄호로 짧게 풀고, 글 끝에 용어 설명을 모아 두었습니다.

## 1. 과제: presigned URL을 메일로 보내는 방식의 한계

가장 단순한 배포 방식은 S3 presigned URL(서명이 들어 있어 정해진 시간 동안만 유효한 다운로드 링크)을 만들어 메일로 보내는 것입니다. 이 방식의 한계는 세 가지이고, 모두 동작 원리에서 나옵니다.

- **이어받기가 되지 않습니다.** URL의 만료 시각은 요청이 S3에 도착하는 순간에만 검사됩니다. 그래서 이미 시작된 전송은 만료 뒤에도 끝까지 이어지지만, 만료 뒤에 생기는 **새 요청**은 403으로 거절됩니다. 브라우저의 기본 다운로드는 연결이 끊기면 같은 URL로 새 요청을 보내 이어받으려 하므로, 1시간짜리 URL로 몇 시간짜리 파일을 받는 해외 사용자는 끊김 한 번에 다운로드 전체를 잃습니다.
- **반복 다운로드가 그대로 비용입니다.** S3에서 인터넷으로 나가는 전송은 전부 종량 과금입니다. 같은 파일을 다섯 번 받으면 다섯 번 과금됩니다.
- **누가 무엇을 받았는지 보이지 않습니다.** 다운로드 이력은 S3 서버 액세스 로그를 뒤져야 알 수 있고, 조직별 접근 범위는 링크를 보낸 사람의 기억에 의존합니다.

참조 구현은 이 세 가지를 서로 다른 층에서 해결합니다. 이어받기는 브라우저 안의 분할 다운로드 엔진이(§6), 비용은 CloudFront 정액제 플랜과 경로 규칙이(§5, §13), 가시성은 조직 단위 권한 모델과 다운로드 원장이(§4, §10) 담당합니다.

## 2. 솔루션 개요

```
브라우저(React SPA, Storage Browser)
   │  로그인(Cognito Authenticator) · /api/* 는 같은 CloudFront 뒤
   ▼
CloudFront (웹, 종량제) ──/api/*──▶ API Gateway HTTP API (JWT authorizer) ──▶ Lambda
   │                                                              │  ├ listLocations / getLocationCredentials
   │ 정적 SPA                                                     │  ├ POST /downloads · renew · status
   ▼                                                              │  └ admin: org · user · location(=grant)
S3 (web)                                                          ▼
                                             S3 Access Grants ◀── GetDataAccess(READ, Minimal, 1~12 h)
                                                                  │
CloudFront (데이터, Pro 정액제, OAC + Key Group 서명 URL) ─────▶ S3 (data, KMS)
   │  표준 로그 v2 (parquet)                                        ▲
   ▼                                                               │
S3 (logs) ──▶ Glue/Athena ──▶ opsDaily Lambda ──▶ CloudWatch 지표·알람 ──▶ SNS
DynamoDB: orgs · object-downloads(카운터) · audit-events(400일 TTL → Glacier IR 아카이브)
```

### 구성 요소와 역할

| 구성 요소 | 역할 | 설명 |
|---|---|---|
| Storage Browser for S3 | 로그인 후 폴더 탐색·파일 선택 화면 | Amplify UI의 오픈소스 React 컴포넌트. S3 콘솔과 비슷한 탐색 화면을 애플리케이션 안에 넣습니다 |
| Amazon Cognito User Pool | 고객 사용자 계정과 로그인 | 관리자가 사용자를 만들고 조직(Org)에 배정합니다. 고객 사용자는 읽기 전용입니다 |
| API Gateway HTTP API + Lambda | 포털 API | 위치 목록·자격 증명·다운로드 요청·관리 기능. Cognito 토큰을 검증하는 JWT authorizer로 보호합니다 |
| S3 Access Grants | 조직별 접근 범위를 임시 자격 증명으로 | S3가 prefix(폴더 경로) 단위 권한을 계산해 1~12시간짜리 자격 증명을 발급합니다 |
| Amazon DynamoDB | 조직·다운로드 원장·감사 이벤트 | 객체별 다운로드 횟수를 원자적으로(동시 요청에도 정확히) 셉니다 |
| CloudFront(데이터) + Pro 플랜 | 두 번째 이후 다운로드의 전송과 캐시 | 서명 URL 전용. OAC(Origin Access Control: CloudFront만 버킷을 읽게 하는 설정)로 버킷을 잠그고, 월 정액으로 과금됩니다 |
| CloudFront(웹) | SPA 정적 파일과 `/api/*` 경로 | 트래픽이 작아 종량제로 둡니다 |
| AWS WAF | 두 distribution의 웹 방화벽 | 정액제 플랜의 필수 조건이기도 합니다 |
| 표준 로그 v2 → Athena → opsDaily Lambda | 히트율·허용량·국가별 지표와 알람 | 하루 한 번 집계합니다 |

### 요청 흐름 두 가지

**폴더 탐색.** 사용자가 Cognito로 로그인하면 Storage Browser가 `listLocations`를 호출하고, Lambda는 그 사용자의 조직에 배정된 위치 목록을 돌려줍니다. 사용자가 위치를 열면 `getLocationCredentials`가 호출되고, Lambda는 S3 Access Grants의 `GetDataAccess`로 **그 prefix 전용** 임시 자격 증명을 받아 브라우저에 넘깁니다. 이후 목록 조회는 브라우저가 그 자격 증명으로 S3에 직접 요청합니다.

**다운로드.** 파일을 선택하면 브라우저가 `POST /downloads`를 호출합니다. Lambda는 객체별 카운터를 1 올리고 올리기 전 값으로 경로를 정합니다(첫 번째는 S3 직접, 두 번째부터 CloudFront). 그 경로의 서명 URL(기본 1시간)을 돌려주면, 1 GiB 이하 파일은 브라우저 기본 다운로드로, 1 GiB를 넘는 파일은 분할 다운로드 엔진으로 받습니다. 엔진은 만료 5분 전에 `renew`로 URL을 갱신하고, 완료 후 체크섬을 대조합니다.

CDK 스택은 8개(`auth → waf(us-east-1) → cdn → cdn-logs(us-east-1) → data → api → web → ops`)이고 리소스 이름에는 `genome-portal-` 접두어를 씁니다. 두 스택이 us-east-1에 있는 이유는 CloudFront용 WAF Web ACL과 표준 로그 v2 전송 리소스가 그 리전에서만 만들어지기 때문입니다(§10).

## 3. 설계 결정

### Transfer Family 웹 앱 대신 Storage Browser를 직접 호스팅하는 이유

같은 사용자 경험을 코드 없이 주는 선택지로 [AWS Transfer Family 웹 앱](https://docs.aws.amazon.com/transfer/latest/userguide/web-app.html)이 있습니다. 다만 인증이 **IAM Identity Center 전용**이어서, 외부 고객 계정을 Cognito로 발급·관리하는 요구와 맞지 않습니다. 그래서 그 웹 앱의 기반 컴포넌트인 [Storage Browser for S3](https://ui.docs.amplify.aws/react/connected-components/storage/storage-browser)를 직접 호스팅하고, 로그인·브랜딩·폴더 탐색을 동등하게 구성합니다.

### 요구사항과 결정

| 영역 | 결정 |
|---|---|
| 인증 | Cognito User Pool. 관리자가 사용자를 조직에 배정. 고객 사용자는 읽기 전용(list/get) |
| 데이터 범위 | 조직 → S3 prefix 매핑을 런타임에 변경. 새 고객사 추가는 코드 수정 없이 관리자 API로 |
| 다운로드 경로 | 객체별 다운로드 횟수를 세어 **첫 번째는 S3 직접, 두 번째부터 CloudFront 서명 URL**. 임계값은 설정값(0이면 전량 CloudFront) |
| 캐시 | 사용자마다 서명이 달라도 캐시가 맞도록 서명 파라미터는 캐시 키에서 제외 |
| 대용량 | 1 GiB 초과는 브라우저 분할 다운로드(8 GiB 파트 × 병렬 4, HTTP Range). 일시정지·재개·새로고침 후 이어받기, URL 자동 갱신, full-object CRC32 검증. 저장 위치 선택 API가 없는 브라우저는 브라우저 다운로드로 전달. 브라우저 내부 저장소가 없는 환경만 `aria2c`/`curl` 명령 안내 |
| URL 수명 | 기본 1시간(설정 범위 15분~12시간). 갱신 요청은 횟수로 세지 않고 같은 경로를 유지 |
| 세션 | 60분 무조작 로그아웃. 다운로드 진행 중에는 무조작으로 세지 않음. 리프레시 토큰 24시간 |
| 정액제 | CloudFront Pro 플랜의 제약(WAF 필수, OAC, 실시간 로그 미사용, 관리형 정책만) 안에서 설계 |
| 운영 | 표준 로그 → Athena 히트율·국가별 지표, 허용량 사용률 50/80/100/200 % 알람 |

분할 다운로드의 임계값을 50 GB가 아니라 **1 GiB**로 둔 것은 URL 수명과 관련이 있습니다. 브라우저 기본 다운로드는 만료된 URL로 이어받기를 시도하면 실패하므로(§1), "오래 걸릴 수 있는 파일"은 전부 URL을 스스로 갱신하는 엔진에 맡기는 편이 사용자 경험이 단순합니다. 1 GiB는 느린 회선에서 1시간 안에 받기 어려워지는 크기입니다.

## 4. 인증과 권한: Storage Browser + S3 Access Grants

Storage Browser는 세 가지 인증 모드를 지원합니다. Amplify Auth, IAM Identity Center, 그리고 애플리케이션이 `listLocations`/`getLocationCredentials` 두 함수를 구현하는 customer-managed auth입니다. Amplify Auth는 `defineStorage`에 **정적 규칙**을 적는 방식이어서 조직별 공유 prefix를 런타임에 바꾸는 요구를 채우지 못합니다. 참조 구현은 customer-managed 모드를 쓰되, 자격 증명 발급의 실질을 **S3 Access Grants**에 맡깁니다.

배포 위치(prefix) 하나가 Access Grants의 grant 하나입니다. 관리자가 위치를 조직에 배정하면 Lambda가 grant를 만들고, 마지막 조직이 해제되면 grant를 지웁니다. 사용자가 브라우저에서 위치를 열면 Lambda는 조직 소속만 확인하고 나머지는 S3에 넘깁니다.

```ts
// infra/lambda/shared/accessGrants.ts (발췌)
const out = await s3Control.send(
  new GetDataAccessCommand({
    AccountId: accountId,
    Target: target,            // s3://<bucket>/projects/ORG-0001/* 또는 객체 1개
    TargetType: targetType,    // 'Object' — presigned URL 서명용은 객체 1개로 한정
    Permission: 'READ',
    Privilege: 'Minimal',      // 요청한 Target 범위로 자격 증명을 축소
    DurationSeconds: ttl,      // 900 ~ 43,200
    AuditContext: auditContext // user=<sub>;org=<orgId>;dl=<downloadId> → CloudTrail에 남음
  }),
);
```

이 구성이 주는 성질은 세 가지입니다.

- **범위 계산을 S3가 합니다.** 세션 정책 JSON을 애플리케이션이 만들지 않으므로 단위 테스트할 "권한 문자열"이 없습니다. 위치 IAM 역할은 읽기 액션만 가지며 `s3:AccessGrantsInstanceArn` 조건으로 Access Grants를 거치지 않은 사용을 막습니다.
- **Lambda에는 S3 권한이 없습니다.** 체크섬 조회용 `HeadObject`조차 사용자용 Access Grants 자격 증명으로 수행합니다. 그래서 CloudFront 경로를 포함한 모든 다운로드가 `GetDataAccess` CloudTrail 이벤트를 남기고, `AuditContext`에 사용자·조직·다운로드 ID가 기록됩니다(CloudTrail에서 보이기까지 약 2분).
- **URL 만료 = 자격 증명 만료.** S3 presigned URL의 실제 유효기간은 `min(요청한 만료, 서명한 자격 증명의 잔여 수명)`입니다. Lambda 실행 역할로 서명하면 잔여 수명을 알 수 없어 "1시간"을 보장할 수 없지만, 객체 1개 전용 자격 증명을 `DurationSeconds = URL TTL`로 받아 서명하면 둘이 정확히 같아집니다.

전제 하나는 **Lambda에서 호출해도 12시간 자격 증명이 나오는가**입니다. IAM `AssumeRole`은 역할 체이닝(역할이 다른 역할을 맡는 것)이면 1시간 상한이 걸리지만, `GetDataAccess`에는 그 제한이 없습니다. 통합 테스트에서 `DurationSeconds=43200` 요청에 만료 시각이 43,200초 뒤로 나왔고, 그 덕에 URL TTL 상한을 설정값(기본 1시간, 최대 12시간)으로 둘 수 있습니다.

## 5. "두 번째부터 CloudFront": 카운터 하나로 경로를 정하기

Storage Browser의 기본 `download` 액션은 임시 자격 증명으로 브라우저가 직접 presigned URL을 만들기 때문에 서버가 횟수를 알 수 없습니다. 참조 구현은 다운로드 핸들러를 교체해 `POST /downloads`를 경유시킵니다. 서버는 객체별 카운터를 원자적으로 올리고, **이전 값**으로 경로를 판정합니다.

```ts
// infra/lambda/handlers/downloads.ts (발췌)
const out = await ddb.send(new UpdateCommand({
  TableName: DOWNLOADS_TABLE,
  Key: { pk: `OBJ#${bucket}/${key}` },
  UpdateExpression: 'ADD #c :one SET lastAt = :now, sizeBytes = :size, checksumCrc32 = :crc',
  ExpressionAttributeNames: { '#c': 'count' },
  ExpressionAttributeValues: { ':one': 1, ... },
  ReturnValues: 'ALL_OLD',
}));
const prevCount = Number(out.Attributes?.count ?? 0);
const path = prevCount >= cfThreshold ? 'CF' : 'S3';   // cfThreshold: SSM, 기본 1 (0 = 전량 CloudFront)
```

동시 요청이 여러 개 들어와도 `prevCount = 0`을 받는 요청은 정확히 하나이므로 "첫 번째만 S3"가 보장됩니다(통합 테스트에서 동시 2건 → S3 1건). 임계값을 SSM 파라미터(코드 밖에 두는 설정값 저장소)로 둔 이유는 §13에서 설명하듯 이 규칙이 비용이 아니라 정액제 허용량을 관리하는 장치여서, 운영 지표에 따라 전량 CloudFront(0)로 바꿀 수 있어야 하기 때문입니다. 값을 바꾸면 60초 안에 반영되고 코드 배포는 필요 없습니다.

CloudFront 경로는 Key Group 서명 URL(CloudFront에 등록한 공개키로 검증하는 서명 링크)입니다. 사용자마다 서명 쿼리가 달라도 캐시가 맞아야 하므로 캐시 정책은 쿼리 문자열을 캐시 키에 넣지 않는 관리형 `CachingOptimized`를 씁니다. 오리진은 OAC로 잠긴 S3 버킷이고, 버킷·KMS 키 정책은 이 distribution만 허용합니다. 버킷 정책에는 distribution ARN이 필요하고 distribution에는 버킷이 필요한 순환 참조는, **cdn 스택이 버킷을 이름 문자열로만 참조**하고 data 스택만 cdn 출력을 가져오는 단방향 의존으로 풉니다. CloudFront는 아직 없는 버킷을 오리진으로 받아 줍니다.

### 캐시 키와 CORS 설계

브라우저의 분할 엔진은 포털 오리진에서 데이터 distribution으로 `fetch`하므로 CORS(브라우저가 다른 출처의 응답을 스크립트에 허용할지 정하는 규칙)가 필요합니다. 여기서 캐시 키와 오리진 응답의 관계가 중요합니다.

- S3는 버킷 CORS 규칙에 맞춰 **요청의 `Origin` 값을 그대로 `Access-Control-Allow-Origin`에 돌려주는** 동작을 할 수 있습니다.
- `CachingOptimized`는 `Origin` 헤더를 캐시 키에 넣지 않습니다. 따라서 어느 오리진의 요청이 캐시를 채우면, 그 응답의 CORS 헤더가 **다른 오리진의 요청에도** 그대로 전달됩니다.
- 관리형 `CORS-With-Preflight` 응답 헤더 정책은 오리진이 보낸 CORS 헤더를 덮어쓰지 않고, 오리진 헤더를 덮어쓰는 커스텀 응답 헤더 정책은 Pro 플랜에서 쓸 수 없습니다(§9).

그래서 참조 구현은 버킷 CORS를 `AllowedOrigins: *`로 두어 오리진 응답을 요청과 무관하게 만듭니다. 접근 제어는 서명 URL이 담당하므로 `*`가 추가로 노출하는 것은 없습니다. 원칙으로 적으면 **캐시 키에 들어가지 않는 요청 헤더에 따라 오리진 응답이 달라져서는 안 된다**입니다.

---

다음: [유전체 데이터 전달 포털 2부: 대용량·일괄 다운로드](/genome-data-delivery-portal-on-aws/genome-portal-download-engine/)
