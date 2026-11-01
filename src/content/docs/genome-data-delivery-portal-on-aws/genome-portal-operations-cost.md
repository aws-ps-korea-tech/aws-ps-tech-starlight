---
title: "유전체 데이터 전달 포털 3부: 운영·비용·검증"
sidebar:
  order: 3
---

# 유전체 데이터 전달 포털 3부: 운영·비용·검증

> 이 글은 3부로 나뉘어 있습니다: [1부](/genome-data-delivery-portal-on-aws/storage-browser-for-s3-cloudfront-gb/) · [2부](/genome-data-delivery-portal-on-aws/genome-portal-download-engine/) · [3부](/genome-data-delivery-portal-on-aws/genome-portal-operations-cost/)

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
