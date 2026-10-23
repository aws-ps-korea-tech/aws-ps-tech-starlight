---
title: "Storage Browser for S3와 CloudFront 정액제로 수백 GB 유전체 데이터 배포 포털 만들기"
---

# Storage Browser for S3와 CloudFront 정액제로 수백 GB 유전체 데이터 배포 포털 만들기

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

## 6. 50 GB를 넘는 파일: 브라우저 안의 분할 다운로드 엔진

### 6.1 왜 브라우저가 나눠 받는가

CloudFront가 전달할 수 있는 단일 객체의 최대 크기는 50 GB입니다. 150 GB BAM을 CloudFront로 받으려면 클라이언트가 HTTP Range 요청(파일의 일부 바이트 구간만 요청하는 방식)으로 잘라 받아야 합니다. 8 GiB 파트를 동시에 4개씩 받으면 150 GB 안팎의 BAM은 파트 18~19개가 되고, CloudFront 입장에서는 각 파트가 50 GB 이하의 독립 요청이므로 캐시도 파트 단위로 됩니다.

엔진의 기본 동작은 다음과 같습니다.

- 파트마다 전용 Web Worker(화면과 분리된 백그라운드 스레드)가 `fetch(Range)`로 받아 64 MiB 청크 단위로 저장합니다.
- URL 만료 5분 전, 또는 403을 받으면 `POST /downloads/{id}/renew`로 URL을 갱신합니다. 갱신은 다운로드 횟수에 세지 않고 같은 경로(S3/CF)를 유지합니다.
- 일시정지·재개가 가능하고, 새로고침·탭 닫기·브라우저 종료 뒤에도 받은 지점부터 이어받습니다.
- 완료 전에 S3에 기록된 full-object CRC32(파일 전체에 대한 오류 검출 코드)와 로컬 계산값을 대조합니다.

이어받기를 "정확하게" 만드는 것이 이 엔진의 핵심이고, 그 출발점은 브라우저가 파일을 어떻게 쓰는지입니다.

### 6.2 브라우저의 파일 쓰기 모델과 진행률의 내구성

사용자가 고른 파일에 웹 페이지가 쓰는 API는 File System Access API(`showSaveFilePicker`)입니다. 이 API의 쓰기 스트림(`createWritable()`)은 **임시 사본(swap file)에 기록하고, `close()`가 성공한 순간에만 실제 파일로 바꿔칩니다.** 웹 페이지가 사용자 파일을 반쯤 쓴 채로 망가뜨리지 못하게 하는 안전장치이고, 우회할 방법은 없습니다. 재개할 때 쓰는 `createWritable({ keepExistingData: true })`는 Chromium에서 **확정된 파일 전체를 새 사본으로 복사**하는 방식으로 구현되어 있어, 150 GB를 90 %에서 재개하면 첫 바이트를 받기 전에 135 GB를 로컬에서 복사합니다.

이 모델에서 "진행률"을 따로 기록해 두면 기록과 파일이 어긋납니다. 새로고침처럼 `close()` 없이 끝나는 중단 뒤에는 사본이 폐기되므로, 파일에는 마지막 `close()` 시점까지만 남습니다. 이어받기의 전제는 **진행률 = 디스크에 확정된 바이트**이고, 참조 구현은 이를 사용자 파일이 아니라 브라우저 내부 저장소에서 충족합니다.

**OPFS 파트 저장.** OPFS(Origin Private File System)는 브라우저가 사이트별로 제공하는 전용 저장 공간으로, 사용자의 파일 시스템과 분리되어 있고 워커 안에서 `FileSystemSyncAccessHandle`로 **제자리에 즉시** 쓸 수 있습니다. 참조 구현은 파트마다 OPFS 파일을 두고, 워커가 청크를 받을 때마다 지정 위치에 쓰고 64 MiB마다 `flush()`로 디스크에 확정합니다. 진행률은 어디에도 따로 적지 않고 **파트 파일의 실제 크기**에서 읽습니다. 어느 시점에 끊기더라도 파일 크기만큼은 디스크에 있으므로, 재개는 그 지점부터 시작하면 됩니다(마지막 청크는 부분 쓰기 가능성 때문에 다시 받습니다).

```ts
// web/src/download/splitWorker.ts (발췌)
const dir = await splits.getDirectoryHandle(spec.downloadId, { create: true });
const fileHandle = await dir.getFileHandle(partFileName(partIdx), { create: true });
const handle = await withLockRetry(() => fileHandle.createSyncAccessHandle());
const size = handle.getSize();                 // = 이 파트의 내구성 있는 진행률
if (size > offset) handle.truncate(offset);    // 마지막 청크는 부분 쓰기 대비로 다시 받음
// ... 청크마다 handle.write(data, { at }) , 64 MiB마다 handle.flush()
```

`withLockRetry`는 새로고침 직후를 위한 것입니다. 이전 페이지의 워커가 잡은 동기 접근 핸들의 잠금은 비동기로 풀리므로, 재개가 1~2초 안에 시작되면 `NoModificationAllowedError`가 납니다. 약 6초 범위의 백오프 재시도로 흡수합니다.

**설계 대안 비교.** 사용자 파일에 직접 쓰는 방식을 유지하면서 내구성을 얻는 대안도 두 가지 있습니다. 150 GB 기준으로 비교하면 다음과 같습니다.

| 기준 | OPFS 파트 파일 + 마지막 1회 병합 | 파트마다 `close()` 후 재개방 | 확정된 바이트만 진행률로 인정 |
|---|---|---|---|
| 비정상 종료 시 유실 | 청크 1개(64 MiB) | 최대 파트 1개(8 GiB) | 마지막 일시정지 이후 전부 |
| 추가 로컬 I/O | 병합 1회(읽기 150 GB + 쓰기 150 GB), 선형 | 재개방마다 확정분 전체 복사 → 합계 약 1.4 TB | 없음(재개 시 복사만) |
| 디스크 | 2×, 그중 1×는 브라우저 저장소가 있는 시스템 드라이브 | 2×, 저장 위치 드라이브 | 1~2× |
| 시크릿 모드 | 불가(OPFS가 메모리에 있음) | 가능 | 가능 |

참조 구현은 OPFS 파트 방식을 기본으로 하고, OPFS를 쓸 수 없는 환경(시크릿 모드, 저장 공간 부족)에서는 세 번째 방식, 즉 사용자 파일에 직접 쓰되 **확정된 바이트만 진행률로 인정**하는 방식으로 자동 전환합니다. 이 폴백에서는 탭을 닫으면 마지막 일시정지 이후 데이터를 다시 받게 되며, 화면이 그 사실을 시작 전에 안내합니다.

### 6.3 전달 단계: 저장 위치 선택 또는 브라우저 다운로드

모든 파트를 받은 뒤 파일을 사용자에게 건네는 단계는 브라우저 기능에 따라 두 가지 중 하나를 씁니다. 판정은 브라우저 이름이 아니라 **기능 유무**로 합니다.

```ts
// web/src/download/planner.ts (발췌)
export function splitCapability(env = defaultEnv()): 'picker' | 'export' | 'none' {
  if (hasFileSystemAccess(env.window)) return 'picker'; // OPFS 파트 -> 사용자가 고른 파일로 병합
  const getDirectory = env.navigator?.storage?.getDirectory;
  if (typeof getDirectory === 'function' && (env.hasWorker ?? true)) return 'export'; // OPFS 파트 -> 브라우저 다운로드
  return 'none'; // 일반 다운로드(≤ 50 GB) 또는 명령어 안내
}
```

**저장 위치 선택(`picker`).** `showSaveFilePicker`가 있는 브라우저(Chrome, Edge 등 데스크톱 Chromium 계열)에서는 시작할 때 저장 위치를 고르고, 파트가 모두 끝나면 그 파일로 한 번 병합합니다. 병합 중 `close()`가 성공하면 파일이 확정되고, 이어서 파일을 다시 읽어 CRC32를 대조합니다.

**브라우저 다운로드로 전달(`export`).** Firefox와 Safari에는 `showSaveFilePicker`가 없지만 OPFS와 동기 접근 핸들은 있습니다(Firefox 111+, Safari 17+). Brave는 Chromium 기반이지만 File System Access API를 기본으로 꺼 두고, iOS에서는 모든 브라우저가 Safari 엔진을 씁니다. 이 브라우저들에서는 **파트 수신과 검증을 똑같이 한 뒤** 마지막 단계만 "브라우저의 일반 다운로드로 전달"합니다. 검증을 전달 앞에 두는 이유는, 손상된 데이터라면 브라우저가 100 GB를 복사하기 전에 끝내기 위해서입니다. 전달 방식은 두 가지 중 브라우저가 지원하는 것을 씁니다.

- **서비스 워커 스트림**: `ReadableStream`을 `postMessage`로 전송할 수 있는 브라우저(Firefox 103+, Chromium)에서는 파트 파일들을 하나의 스트림으로 이어 서비스 워커(페이지와 별개로 네트워크 요청을 가로채는 스크립트)에 넘기고, 숨은 iframe으로 `/portal-export/<id>`를 열면 워커가 `Content-Disposition: attachment`와 `Content-Length`를 붙여 응답합니다. 브라우저 다운로드 UI에 총 크기와 남은 시간이 표시되고, 스트림이 끝나는 시점을 엔진이 알 수 있어 OPFS 파트를 즉시 삭제합니다.
- **Blob 전달**: 스트림 전송이 없는 브라우저(Safari 26 이하)에서는 OPFS 파트의 `File` 참조들을 `new Blob([...])`로 묶어 `<a download>`로 넘깁니다. 참조만 묶으므로 복사나 메모리 적재는 없고, 브라우저가 다운로드 폴더로 복사합니다. 엔진은 완료 시점을 알 수 없으므로 파트를 유지하고, 사용자가 목록에서 제거하거나 24시간이 지나면 삭제합니다.

서비스 워커 스트림 경로에는 지켜야 할 불변식이 하나 있습니다. **다운로드를 시작한 숨은 iframe은 브라우저가 스트림을 끝까지 소비할 때까지 유지해야 합니다.** Firefox는 iframe이 제거되면 저장 중인 파일을 그 시점까지로 끊습니다. 참조 구현은 소스 스트림의 close 신호를 받은 뒤 3초의 마무리 유예 후에만 iframe을 제거하고, 전송이 몇 시간 걸려도 고정 타이머를 두지 않습니다.

브라우저별로 정리하면 다음과 같습니다.

| 브라우저 | 분할·이어받기 | 전달 | 비고 |
|---|---|---|---|
| Chrome, Edge 등 데스크톱 Chromium 계열 | 지원 | 저장 위치 선택 → 병합 | 시크릿 모드는 직접 기록 폴백 |
| Firefox 111+ | 지원 | 서비스 워커 스트림 | "사이트 데이터 보존" 허용 필요(§6.4) |
| Safari 17+(macOS), iOS/iPadOS | 호환표 기준 지원 | Blob(26 이하) / 스트림(27+) | 실제 기기 검증은 아직 없음 |
| Brave | 지원 | 서비스 워커 스트림 | File System Access API 기본 비활성 |
| OPFS가 없는 브라우저, 시크릿 모드 등 | 폴백 | 50 GB 이하 일반 다운로드 / 초과는 `aria2c -x 4 -s 4 -k 8G ...`, `curl -L -C - ...` 명령 안내 | 화면이 사유를 안내 |

### 6.4 저장 공간 판정

OPFS 파트 방식은 파일 크기만큼의 저장 공간을 **시스템 드라이브**(브라우저 프로필이 있는 곳)에 요구합니다. 시작 전에 이 공간을 확실하게 판정해야 하는데, 브라우저가 알려 주는 추정치는 믿을 수 없습니다.

- Chromium의 `navigator.storage.estimate()`는 할당량을 10 GiB로 캡해서 보고하지만, 실제로는 디스크 여유에 비례해 160 GiB 이상 예약이 가능합니다.
- Firefox는 사이트 데이터 보존(`navigator.storage.persist()`)이 허용되기 전까지 사이트당 OPFS 한도를 10 GiB로 두고, 허용 뒤에 디스크 여유 비율(측정 환경에서 268 GB)로 올립니다. 허용 여부는 사용자에게 묻는 프롬프트로 결정됩니다.

그래서 참조 구현은 (1) 먼저 `persist()`를 호출해 사용자가 프롬프트에 응답할 시간을 30초 상한으로 두고, (2) OPFS 스크래치 파일에 `truncate(파일 크기 + 여유 256 MiB)`를 시도하는 **예약 프로브**로 판정합니다. `truncate`는 실제 I/O 없이 할당량만 검사하므로 즉시 끝납니다. 성공하면 OPFS 파트 방식으로, 실패하면 저장 위치 선택이 가능한 브라우저는 직접 기록 폴백으로, 그렇지 않은 브라우저는 일반 다운로드 또는 명령 안내로 내려가며 화면에 사유를 표시합니다. 시크릿 모드는 OPFS가 메모리에 있어 1 GiB 이상 쓰기가 실패하므로 역시 폴백입니다.

### 6.5 무결성: full-object CRC32

S3는 객체마다 체크섬을 보관할 수 있는데, 대조에 쓸 수 있는 것은 **full-object**(파일 전체) 체크섬입니다. 멀티파트 업로드에서 `aws s3 cp --checksum-algorithm CRC32`가 기록하는 값은 COMPOSITE(파트별 체크섬의 체크섬)이어서 클라이언트가 계산한 전체 파일 CRC32와 비교할 수 없습니다. 참조 구현의 업로드 도구는 SDK `lib-storage`로 `ChecksumType: FULL_OBJECT`를 선언해 올리고, 데이터 파이프라인이 파일을 올리는 쪽에도 같은 조건을 운영 문서로 요구합니다. 브라우저는 저장 위치 선택 경로에서는 병합된 파일을, 브라우저 다운로드 전달 경로에서는 OPFS 파트를 순서대로 읽어 CRC32를 계산하고 `x-amz-checksum-crc32` 값과 대조합니다.

### 6.6 실측

**53 GiB(56.9 GB) 객체의 CloudFront 통과와 캐시.** "50 GB 초과 객체도 8 GiB Range 파트로 나누면 CloudFront를 통과하고 캐시된다"는 전제를 개발 계정에서 같은 파일을 두 번 받아 확인했습니다(Chromium, 저장 위치 선택 경로).

| 패스 | CloudFront 결과 | 요청 | 전송 | 소요(수신 + 병합 + CRC32) |
|---|---|---|---|---|
| 1회차 | `Miss` 7/7 (파트마다 오리진 인출) | 7 | 56.96 GB | 1,052 s |
| 2회차 | **`Hit` 7/7** | 7 | 56.92 GB | 1,095 s |

두 패스 모두 병합 후 CRC32가 S3 값과 일치했습니다. 캐시 히트 패스가 더 빠르지 않은 이유는 네트워크 인출이 두 패스 모두 약 4분이고 나머지 13~14분이 로컬 작업(OPFS 기록 → 53 GiB 병합 → CRC32)이기 때문입니다. 데스크톱급 회선에서는 병목이 디스크이고, 캐시의 이득은 대역폭이 좁은 해외 사용자에게서 나타납니다.

**새로고침 후 이어받기.** 12 GiB 파일을 5 %에서 일시정지 → 재개 → 17 %에서 새로고침 → 재개했을 때(Chromium) 새로고침 전후의 진행률이 바이트 단위로 같았고(손실 0) 완료 후 CRC32가 일치했습니다. Firefox에서는 2 GiB 파일로 같은 흐름(22 %에서 새로고침)을 서비스 워커 스트림 전달까지 수행해 저장된 파일의 CRC32가 S3 값과 일치했습니다. Chromium에서 `showSaveFilePicker`를 제거해 Brave와 같은 조건을 만든 12 GiB(2파트) 실행은 Blob 전달 경로로 완료되어 CRC32가 일치했습니다. 각 결과는 해당 조건에서 1회 측정한 값이며, Safari는 호환표 기준으로 같은 경로를 타지만 실제 기기 검증은 아직 없습니다.

## 7. 일괄 다운로드(zip): 압축이 아니라 묶음

여러 파일을 선택하면 포털은 zip 하나로 전달합니다. 압축을 위해서가 아니라, 브라우저에서 여러 파일을 한 번에 저장할 수 있는 안정적인 방법이 "하나의 파일로 묶는 것"이기 때문입니다. 웹 페이지가 한 번의 클릭으로 여러 파일을 저장하려 하면 브라우저가 차단하거나 "여러 파일 다운로드 허용" 확인을 띄우고, 폴더 구조도 유지되지 않습니다. 수십~수천 개 파일(포털은 최대 5,000개)을 일일이 저장하게 할 수는 없으므로, 선택한 파일을 폴더 구조 그대로 담은 zip 하나로 전달합니다.

- **압축하지 않습니다.** zip은 저장(STORE) 모드로, 각 파일의 바이트를 그대로 이어 붙이고 파일 이름·크기 같은 헤더만 덧붙입니다. 유전체 데이터(BAM/CRAM/FASTQ.gz)는 이미 압축된 형식이라 재압축 이득도 없습니다. 따라서 "압축이 끝나기를 기다리는" 단계가 없고, 첫 파일의 첫 바이트가 도착하는 순간부터 디스크에 쓰입니다(1 GiB 2개 zip 19.8초, 회선 속도 그대로).
- **서버가 아니라 브라우저에서 묶습니다.** 브라우저가 파일별로 `POST /downloads`를 호출해 서명 URL을 받고, CloudFront/S3에서 각 파일을 내려받으면서 zip 형식으로 흘려 저장합니다. 그래서 CloudFront 입장에서는 파일별 GET 요청일 뿐이며, 다운로드 횟수 기록·감사 로그·정액제 적용도 파일 단위로 동일하게 동작합니다. 적용되는 시간 제한은 오리진 응답 타임아웃(다음 패킷을 기다리는 시간, 기본 30초)뿐이고, 전체 응답 시간의 상한은 설정하지 않으면 적용되지 않습니다.
- **다운로드는 서비스 워커가 시작합니다.** zip 스트림은 서비스 워커가 다운로드 응답으로 바꾸고, 저장은 서비스 워커 스코프 안의 숨은 iframe 내비게이션으로 시작합니다. 스코프 밖 페이지에서 앵커를 클릭하면 서비스 워커를 거치지 않아 다운로드가 되지 않기 때문입니다.
- **한계.** zip 스트림은 중간부터 이어받을 수 없어 중단되면 처음부터 다시 만들고, 50 GB를 넘는 파일은 zip에 넣을 수 없습니다(해당 파일은 분할 다운로드로 개별 안내). 대용량 파일 소수를 받을 때는 분할 다운로드가 맞고, 화면 문구는 "zip 스트리밍 중(브라우저 다운로드 진행, 압축 없음)"으로 압축 단계가 없음을 알립니다.

**취소는 반드시 끝나야 합니다.** 사용자가 가장 먼저 누르는 버튼이 취소이고, 취소 처리에는 두 가지 조건이 있습니다. 첫째, zip 라이브러리(client-zip)는 엔트리 제너레이터를 `return()`을 부르지 않는 이터레이터로 소비하므로, 취소로 `for await` 루프가 예외로 빠져나가면 제너레이터는 `yield`에 멈춘 채 남고 `finally`는 실행되지 않습니다. 취소 신호 자체를 함께 기다리고 제너레이터를 직접 닫아야 합니다.

```ts
// web/src/download/zip.ts (발췌) — 취소는 반드시 settle되어야 한다
const aborted = new Promise<void>((r) => signal?.addEventListener('abort', () => r(), { once: true }));
await Promise.race([finishedPromise, aborted]);
if (signal?.aborted && !finished) {
  void entryIterator.return(undefined).catch(() => undefined); // client-zip은 return()을 부르지 않는다
  return { status: 'cancelled' };
}
```

둘째, 취소 시점에 카운팅 스트림에 이미 들어와 있던 청크가 진행률을 한 번 더 보고할 수 있습니다. React는 상태 업데이트를 묶어 처리하므로 "완료" 뒤에 도착한 "진행 중" 보고가 마지막 쓰기로 남습니다. 엔진은 abort 뒤 보고를 멈추고, 화면은 진행률을 함수형 업데이터로 **진행 중일 때만** 반영합니다. 이 조건은 로컬 개발 서버보다 배포 환경에서 더 자주 나타나므로 e2e 테스트는 배포 포털에서 반복 실행합니다(§12).

```ts
onProgress: (progress) =>
  setPhase((prev) => (prev.kind === 'running' ? { kind: 'running', progress } : prev)),
```

## 8. 세션과 URL 수명을 다운로드 시간에 맞추기

150 GB를 50 Mbps로 받으면 6.7시간입니다. 60분 무조작 로그아웃과 1시간 URL을 그대로 두면 한 시간마다 멈추므로, 세 가지를 맞춥니다.

- **무조작 판정에서 다운로드를 제외합니다.** 분할·zip 다운로드가 진행 중이면 무조작으로 세지 않고, 끝난 시점부터 60분을 다시 셉니다.
- **토큰은 호출 때마다 갱신합니다.** API 클라이언트가 매 호출 전 `fetchAuthSession()`으로 ID 토큰(60분)을 갱신하고, 리프레시 토큰(갱신에 쓰는 장기 토큰)의 유효기간은 24시간입니다. 브라우저에 남는 토큰의 노출 창과 긴 다운로드 시간 사이의 타협점입니다.
- **갱신 실패는 실패가 아니라 일시정지입니다.** 관리자가 사용자를 비활성화했거나 24시간이 지나 갱신이 거부되면, 다운로드 기록을 `AUTH_EXPIRED` 사유의 일시정지로 보존합니다. 다시 로그인하면 받은 지점부터 재개합니다.

e2e 테스트는 65분 무조작 동안 토큰 갱신이 일어나며 다운로드가 완료되는 것과, 진행 중 `AdminUserGlobalSignOut`으로 세션을 끊은 뒤 재로그인해 재개한 파일의 CRC32가 일치하는 것을 확인합니다.

## 9. 정액제 플랜을 IaC로 연결하기

CloudFront 정액제 플랜은 월 정액으로 일정 전송량(허용량)을 쓰는 요금제이고, CloudFormation 리소스 `AWS::PricingPlanManager::Subscription`으로 만들 수 있습니다. CDK에서는 설정값 하나로 켭니다.

```ts
// infra/lib/cdn-stack.ts (발췌) — cfg.flatRatePlan = { tier: 'PRO' } 일 때만
this.flatRatePlan = new pricingplanmanager.CfnSubscription(this, 'FlatRatePlan', {
  planFamily: 'CloudFront',
  planTier: this.cfg.flatRatePlan.tier,                 // PRO | BUSINESS | PREMIUM
  usageLevel: this.cfg.flatRatePlan.usageLevel ?? 'DEFAULT',
  resourceArns: [this.distribution.distributionArn, props.webAclArn],
});
```

운영 관점에서 알아 둘 점은 두 가지입니다.

- **승인은 사람이 합니다.** 유료 티어는 `PENDING_APPROVAL` 상태로 만들어지고 CloudFormation이 승인하지 않습니다. 콘솔 또는 `approve-paid-subscription`으로 승인하면 즉시 잔여 일수 비례 과금이 시작되고, **현재 청구 주기가 끝날 때까지 취소할 수 없습니다.** 플랜이 붙은 distribution은 삭제도 되지 않으므로(플랜 해지 → 주기 말 적용 → 삭제), 개발 환경에서는 구독을 만들되 승인하지 않은 상태로 두는 것이 안전합니다.
- **티어의 기능 제약은 설계 단계의 입력입니다.** distribution이 플랜에서 지원하지 않는 기능을 쓰고 있으면 `CreateSubscription`이 `ValidationException`으로 거절됩니다.

| 항목 | Pro 플랜 |
|---|---|
| 필수 조건 | WAF Web ACL이 distribution에 연결되어 있어야 하며 플랜 사용 중에는 분리 불가 |
| 미지원 기능 | 실시간 로그, OAI(OAC는 가능), 레거시 캐시 설정(`ForwardedValues`), Continuous deployment, Anycast IP. 플랜에 연결된 WAF Web ACL·CloudFront Function은 다른 distribution과 공유 불가 |
| 정책 | 캐시 정책·오리진 요청 정책·응답 헤더 정책은 **관리형만**(커스텀 정책은 Business 이상) |
| 한도 | 캐시 동작 10개, WAF 규칙 25개 |
| 로그 | 표준 액세스 로그 포함. **Parquet 형식 로그 전달은 플랜 밖 종량 과금** |
| 허용량 | 월 50 TB 전송, 1,000만 요청. 하드 리밋이 아니며 첫 스파이크는 3배까지 그 달 서비스에 영향 없음. 지속 초과는 2~3개월 이상 관찰 후 평가. 50/80/100 % 도달 시 이메일 통지 |

참조 구현의 데이터 distribution은 관리형 `CachingOptimized`, 관리형 `CORS-With-Preflight`, OAC, 표준 로그만 사용해 이 조건을 만족합니다. §5의 CORS 설계가 커스텀 응답 헤더 정책 대신 버킷 CORS로 해결되어야 하는 이유도 여기에 있습니다.

## 10. 운영: 로그 → Athena → 알람

- **표준 로그 v2는 us-east-1에 전송 리소스를 둡니다.** CloudWatch Logs 전송(DeliverySource/DeliveryDestination/Delivery)으로 S3에 parquet(열 지향 압축 파일 형식)을 쓰는 방식인데, 이 전송 리소스는 distribution 리전과 무관하게 us-east-1에서만 만들 수 있습니다. 그래서 `cdn-logs` 스택이 us-east-1에 따로 있고, 로그 버킷은 워크로드 리전(서울)에 둡니다.
- **parquet의 모든 필드는 문자열입니다.** Glue 테이블(Athena가 읽는 스키마 정의)에서 `sc_bytes`를 `bigint`로 선언하면 Athena 쿼리가 형 불일치로 실패합니다. 전부 `string`으로 선언하고 집계 쿼리에서 `try_cast`합니다.
- **하루 한 번 지표를 만듭니다.** `opsDaily` Lambda가 Athena로 전날 로그를 집계해 캐시 히트율(요청·바이트), 국내/해외 바이트(`c-country` 기준), 정액제 허용량 사용률, grant와 DynamoDB 원장의 정합성(`GrantDrift`)을 CloudWatch 지표로 올리고, 감사 이벤트를 S3 Glacier Instant Retrieval(저렴한 장기 보관 클래스)로 아카이브합니다. 감사 이벤트의 DynamoDB 보존은 400일입니다.
- **알람 10개가 SNS로 나갑니다.** 허용량 50/80/100/200 %, 5분 내 403 50건 이상, downloads Lambda 오류율 5 % 초과, grant 누락, `GrantDrift`, `opsDaily` 실패, API 5xx 5건 이상입니다.
- **SNS 토픽 정책에 CloudWatch 발행 허용을 명시합니다.** 토픽에 `enforceSSL` 정책을 붙이면 기본 정책에 있던 CloudWatch의 발행 허용 문이 사라져, 알람이 울려도 `Failed to execute action`으로 끝납니다. 토픽 정책에 `cloudwatch.amazonaws.com`의 `sns:Publish`를 명시하고, 배포 절차에 `set-alarm-state`로 알람을 한 번 울려 실제 수신을 확인하는 단계를 둡니다.

## 11. 코드 수정 없이 바꾸는 값

운영 중 바뀔 가능성이 있는 값은 코드가 아니라 설정에 둡니다.

| 값 | 위치 | 의미 |
|---|---|---|
| `cf-threshold` | SSM 파라미터(60초 캐시) | 몇 번째 다운로드부터 CloudFront로 보낼지. 기본 1, 0이면 전량 CloudFront |
| `url-ttl-seconds` | SSM 파라미터 | 서명 URL 수명. 기본 3,600, 범위 900~43,200 |
| `flatRatePlan` | 배포 설정(`infra/config/<env>.json`) | `{ tier: 'PRO' }`처럼 티어를 적으면 구독 리소스가 생성되고, 비우면 종량제 |
| `brand` | 배포 설정 | 포털 이름과 로고. `logoFile`에 로컬 이미지 경로를 적으면 web 스택 배포 때 함께 업로드되며(고객 로고는 저장소 밖에 둠), 아무것도 서빙하지 않는 경로는 synth 단계에서 거부됩니다. 기본 로고가 SPA에 포함되어 있어 설정이 없어도 화면이 깨지지 않습니다 |
| 조직 ↔ prefix | 관리자 API | 위치 하나가 grant 하나. 새 고객사는 조직을 만들고 위치를 배정하면 끝 |

## 12. 검증

| 단계 | 내용 | 결과 |
|---|---|---|
| 단위 | contract 29 · infra/Lambda 258 · web 136 · tools 56 | 통과, Lambda 커버리지 99 % |
| 통합(개발 계정) | 12시간 자격 증명, 조직 격리(타 조직 prefix 403, grant 없는 배정 `NO_GRANT`), 경로 규칙(동시 2건 → S3 1건), URL 수명(TTL 900초 만료 15초 뒤 403), grant 수명주기, CloudTrail `auditContext`, `/downloads` p95 298 ms | 23/23 |
| e2e(Playwright) | Chromium: 분할·새로고침 이어받기·65분 무조작 중 토큰 갱신·인증 만료 후 재개·캐시 2패스·zip·zip 취소·저장 위치 선택 없이 Blob 전달. Firefox: 경로 배지·OPFS 파트 → 서비스 워커 스트림 전달(새로고침 이어받기 포함)·OPFS 비활성 시 폴백 | 16 시나리오 통과 |
| 인수 | 시나리오 11개(3시간 방치 다운로드, 진행 중 계정 비활성화 포함) | 11/11 |
| 보안 검토 | 16항목 증거, cdk-nag(CDK 보안 규칙 검사기) 억제 14종 재검토, IAM Access Analyzer finding 0, 수용 위험 4건 | 완료 |

다운로드 포털의 테스트에서 지킨 원칙은 네 가지입니다.

1. **완료 경로만 검증하지 않습니다.** 취소·일시정지·새로고침·인증 만료 경로를 시나리오로 둡니다. 사용자가 가장 먼저 누르는 버튼은 취소입니다.
2. **첫 화면을 검증합니다.** 로고 이미지가 실제로 로드되는지(`img.complete && img.naturalWidth > 0`)를 e2e가 확인하고, 콘솔 오류 0건을 배포 후 점검 항목으로 둡니다. 사용자가 가장 먼저 보는 것은 로고입니다.
3. **배포 환경에서 반복 실행합니다.** 상태 업데이트 순서처럼 타이밍에 의존하는 조건은 로컬 개발 서버에서 재현되지 않을 수 있습니다.
4. **결과를 외부 도구로 재계산합니다.** 저장된 파일의 CRC32는 SPA가 표시한 값이 아니라 Node `zlib`로 다시 계산해 S3 값과 대조하고, 알람은 `set-alarm-state`로 실제 수신을 확인합니다.

## 13. 비용

- **CloudFront 비용은 전량 CloudFront일 때 가장 단순합니다.** S3 → CloudFront 오리진 전송은 무료이고 Pro 정액제는 허용량(50 TB)을 넘어도 초과 과금이 없으므로, 모든 다운로드를 CloudFront로 보내면(`cf-threshold=0`) 월 전송량이 100 TB여도 CloudFront 데이터 전송 비용은 월 $15입니다.
- **종량 과금이 남는 항목은 "첫 번째 다운로드는 S3 직접" 규칙이 만드는 S3 전송입니다.** 서울 리전 인터넷 전송 요금은 첫 10 TB 구간 $0.126/GB입니다. 월 100 TB 중 첫 다운로드 비중을 30 %로 가정하면 30 TB가 S3로 나가고, 첫 구간 단가를 단순 적용하면 약 $3,900입니다(구간 할인을 적용하면 그보다 조금 낮습니다).
- **그런데도 기본값을 `cf-threshold=1`로 두는 이유는 허용량입니다.** 월 100 TB는 Pro 허용량의 2배이므로 지속 초과 평가 대상이 됩니다. 한 번만 받히는 파일을 S3로 빼면 CloudFront 사용량이 허용량에 가까워져 플랜 조정 압력이 낮아집니다. 즉 S3 전송비를 내고 허용량 여유를 사는 장치이고, 그 가치는 운영 지표(한 번만 받히는 파일의 비중, 초과 평가 결과)에 달려 있습니다. 허용량 초과는 초과 과금이 아니라 평가·협의 대상이므로, 단순함을 택한다면 전량 CloudFront로 시작하는 쪽이 자연스럽습니다. 두 값 모두 설정값이고 운영 2~3개월 뒤 재판단합니다.
- **S3 Access Grants는 요청 건수 과금**(서울 $0.03/1,000건)이고 보유 비용이 없습니다. 브라우징·다운로드 규모에서 월 수 달러 이하입니다.
- **Parquet 로그 전달은 플랜 밖 종량 항목**입니다. 첫 달 Cost Explorer에서 로그 관련 비용을 확인하고, 의미 있는 금액이면 텍스트(w3c) 포맷으로 바꾸고 Glue 테이블 정의를 맞춥니다.
- 그 외 웹 distribution, WAF, DynamoDB, Lambda, Athena는 요청 수에 비례하는 소액 항목입니다.
- **사용자 PC 쪽 비용도 있습니다.** OPFS 파트 방식은 파일 크기만큼의 시스템 드라이브 여유와 저장 위치의 여유를 동시에 요구합니다. 화면이 시작 전에 두 값을 안내합니다.

## 14. 고려 사항

- **브라우저 지원 범위.** 분할·이어받기는 데스크톱 Chromium 계열과 Firefox 111+에서 확인되었고, Brave는 Chromium에서 같은 조건(저장 위치 선택 API 없음)을 재현해 확인했습니다. Safari 17+와 iOS는 호환표 기준으로 같은 경로를 타지만 실제 기기 검증은 아직 없습니다. Firefox는 첫 대용량 다운로드 때 사이트 데이터 보존 프롬프트를 허용해야 10 GiB를 넘는 파일을 분할 다운로드할 수 있습니다. 시크릿 모드는 직접 기록 폴백으로 동작합니다.
- **사용자 PC 디스크.** 시스템 드라이브에 파일 크기만큼(OPFS), 저장 위치에 파일 크기만큼 여유가 필요합니다. Blob 전달 경로(Safari 26 이하)에서는 두 사본이 최대 24시간 공존합니다.
- **브라우저로 넘어간 자격 증명.** 폴더 탐색을 위해 브라우저에 전달되는 1시간짜리 READ 자격 증명은 CLI로도 쓸 수 있으므로, 포털을 우회한 직접 GET(횟수 미집계)이 가능합니다. Storage Browser 구조상 불가피하며, 탐지는 S3 데이터 이벤트와 `AuditContext`로 합니다.
- **정액제 플랜.** 승인은 사람이 하고 승인 후 청구 주기 말까지 취소할 수 없습니다. 플랜이 붙은 distribution은 삭제할 수 없습니다. 허용량 초과는 과금이 아니라 평가 대상이므로 어카운트팀과의 사전 협의 창구를 두는 것이 좋습니다.
- **업로드 측 요구.** 데이터 파이프라인은 `ChecksumType: FULL_OBJECT`로 올려야 브라우저가 무결성을 대조할 수 있습니다.
- **운영 배포에서 바꿀 것.** 참조 구현은 기본 CloudFront 도메인을 쓰므로 운영에서는 커스텀 도메인과 인증서가 필요합니다. 데이터 버킷 이름은 비인증 설정 파일(`config.json`)에 포함되므로 계정 ID가 들어가지 않은 이름을 권합니다.

## 15. 정리

- Storage Browser는 "표시"에, S3 Access Grants는 "권한"에, Lambda는 "규칙"에만 관여하게 나누면 각 층의 테스트가 단순해집니다.
- 경로 규칙은 DynamoDB `ADD` + `ReturnValues: ALL_OLD` 한 줄로 충분하고, 임계값은 코드가 아니라 설정값에 둡니다.
- 캐시 키에 없는 요청 헤더(`Origin`)에 따라 오리진 응답이 달라져서는 안 됩니다. 버킷 CORS `*`가 답입니다.
- 브라우저의 파일 쓰기는 `close()` 시점에만 확정됩니다. 이어받기가 필요하면 OPFS + `FileSystemSyncAccessHandle`에 쓰고 마지막에 병합하거나 브라우저 다운로드로 전달합니다. 저장 공간은 `estimate()`가 아니라 `truncate()` 예약으로 판정합니다.
- 정액제 플랜은 IaC로 연결할 수 있지만 승인은 사람이 하고, 티어의 기능 제약은 설계 단계의 입력입니다.
- 표준 로그 v2 전송 리소스는 us-east-1, parquet 필드는 전부 문자열, 알람은 만든 뒤 한 번 울려 수신을 확인합니다.

참조 구현(CDK 8스택, Lambda, React SPA, admin CLI, 통합·e2e 테스트, runbook, 요구사항·설계 문서)은 GitHub [hmkim/omics-data-delivery-portal](https://github.com/hmkim/omics-data-delivery-portal)에 MIT-0 라이선스로 공개되어 있습니다. 공개 저장소에서는 계정 ID·도메인·이메일을 자리표시자로 대체했고, 측정값과 날짜는 개발 계정 실측 그대로입니다. 질문과 개선 제안은 저장소 이슈로 남겨 주세요.

### 참고 자료

- [Storage Browser for S3 (Amplify UI)](https://ui.docs.amplify.aws/react/connected-components/storage/storage-browser)
- [AWS Transfer Family 웹 앱](https://docs.aws.amazon.com/transfer/latest/userguide/web-app.html)
- [S3 Access Grants](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-grants.html)
- [객체 무결성 확인(S3 체크섬)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity.html)
- [CloudFront 정액제 플랜 — 기능, 미지원 기능, 허용량](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)
- [AWS::PricingPlanManager::Subscription](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-pricingplanmanager-subscription.html)
- [CloudFront 할당량(단일 객체 크기)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html)
- [CloudFront 표준 로그 v2](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging.html)
- [Origin Private File System (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [showSaveFilePicker (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)

### 용어 설명

| 용어 | 설명 |
|---|---|
| presigned URL | 서명이 포함되어 정해진 시간 동안만 유효한 S3 다운로드 링크. 만료는 요청이 도착하는 순간에만 검사된다 |
| Key Group 서명 URL | CloudFront에 등록한 공개키로 검증하는 서명 링크. 사용자마다 서명이 다르지만 캐시는 공유된다 |
| OAC (Origin Access Control) | CloudFront만 S3 버킷을 읽을 수 있게 하는 설정. 버킷을 공개하지 않고 CloudFront로 전달한다 |
| S3 Access Grants / grant | S3가 prefix(폴더 경로) 단위로 접근 권한을 계산해 임시 자격 증명을 발급하는 기능. grant는 "이 역할이 이 prefix를 읽을 수 있다"는 항목 하나 |
| prefix | S3 객체 키의 앞부분. 폴더처럼 쓰인다(예: `projects/ORG-0001/`) |
| JWT authorizer | API Gateway가 요청에 담긴 Cognito 토큰(JWT)을 검증해 인증되지 않은 요청을 거절하는 기능 |
| 원자 카운터 | 동시에 여러 요청이 와도 각 요청이 서로 다른 값을 받도록 보장하는 증가 연산. DynamoDB `ADD`가 제공한다 |
| SSM 파라미터 | AWS Systems Manager Parameter Store에 두는 설정값. 코드 배포 없이 값을 바꿀 수 있다 |
| HTTP Range 요청 | 파일의 일부 바이트 구간만 요청하는 HTTP 기능. 대용량 파일을 조각으로 받거나 이어받을 때 쓴다 |
| 캐시 키 | CloudFront가 "같은 응답"으로 볼 요청의 식별 기준. 여기에 없는 요청 헤더가 달라도 같은 캐시 항목이 전달된다 |
| CORS | 브라우저가 다른 출처(도메인)의 응답을 스크립트에 허용할지 정하는 규칙. 서버가 `Access-Control-Allow-Origin` 헤더로 허용 범위를 알린다 |
| Web Worker / 서비스 워커 | Web Worker는 화면과 분리된 백그라운드 스레드. 서비스 워커는 페이지와 별개로 네트워크 요청을 가로채고 응답을 만들 수 있는 스크립트 |
| File System Access API | 웹 페이지가 사용자가 고른 파일에 직접 쓰게 하는 API(`showSaveFilePicker`). 데스크톱 Chromium 계열만 지원 |
| swap file | File System Access API가 쓰기 중 사용하는 임시 사본. `close()`가 성공할 때만 실제 파일로 바뀐다 |
| OPFS (Origin Private File System) | 브라우저가 사이트별로 제공하는 전용 저장 공간. 사용자의 파일 시스템과 분리되어 있고 즉시 쓰기가 가능하다 |
| FileSystemSyncAccessHandle | OPFS 파일에 워커가 제자리에서 동기적으로 읽고 쓰는 핸들. `flush()`로 디스크에 확정한다 |
| Blob | 브라우저가 다루는 바이너리 데이터 덩어리. 파일 참조를 묶기만 하면 메모리에 올리지 않는다 |
| CRC32 (full-object / COMPOSITE) | 오류 검출용 32비트 체크섬. full-object는 파일 전체의 값, COMPOSITE는 멀티파트 업로드의 파트별 체크섬을 다시 체크섬한 값으로 전체 파일 값과 비교할 수 없다 |
| 표준 로그 v2 | CloudFront의 액세스 로그 전송 방식. CloudWatch Logs 전송을 통해 S3·CloudWatch Logs·Firehose로 보낼 수 있고 parquet 포맷을 지원한다 |
| parquet / Glue / Athena | parquet는 열 지향 압축 파일 형식. Glue 테이블은 그 파일의 스키마 정의, Athena는 S3의 파일을 SQL로 조회하는 서비스 |
| WAF Web ACL | AWS WAF의 규칙 묶음. CloudFront distribution 앞에서 요청을 검사한다 |
| 정액제 허용량 | 정액제 플랜에 포함된 월 전송량·요청 수. 하드 리밋이 아니라 지속 초과 시 평가 대상이 되는 기준 |
| Glacier Instant Retrieval | 즉시 조회가 가능한 S3 장기 보관 스토리지 클래스 |
| cdk-nag | CDK 코드에 보안·모범 사례 규칙을 검사하는 도구 |
| e2e 테스트 | 실제 브라우저로 사용자 흐름 전체를 자동 실행하는 테스트. 참조 구현은 Playwright를 쓴다 |
