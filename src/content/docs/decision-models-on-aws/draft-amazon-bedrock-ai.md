---
title: "[DRAFT] 병원편 — 결정은 서울 안에서, 생성은 비개인 데이터만 밖으로: 결정 모델과 Amazon Bedrock으로 국내 처리 요건을 지키는 병원 AI 설계"
---

# [DRAFT] 병원편 — 결정은 서울 안에서, 생성은 비개인 데이터만 밖으로: 결정 모델과 Amazon Bedrock으로 국내 처리 요건을 지키는 병원 AI 설계

> **게시 전 검토 메모 (게시할 때 이 블록은 삭제)**
>
> - 이 글은 전편 "[DRAFT] '결정 모델(System One)'을 AWS에서 쓰는 방법"(같은 책의 첫 페이지)의 **설계 응용편**입니다. 수치(결정 모델 79 ms·98.8%, Sonnet 5.5 `effort=low` 568 ms, 1K 결정당 $0.033 vs $0.81 등)는 전편의 서울 리전 실측을 그대로 인용했고, 이 글의 시나리오 S1~S5는 **설계안**이며 실제 병원에 구축·검증한 것이 아닙니다. 본문에 그렇게 명시했습니다.
> - **규제 서술**은 공개 자료(ICLG *Digital Health Laws and Regulations 2026 – Korea*, Lee & Ko; AWS Bedrock 크로스 리전 추론 문서)만 근거로 했고, 법 조문 번호는 적지 않았습니다. 게시 전 법무/개인정보 담당의 검토를 권합니다. 특히 "가명정보의 국외 이전 원칙 불가"와 "SaMD 경계" 문장.
> - IAM/SCP/CloudTrail 예시는 **동작 원리를 보이는 예시**입니다. §6-1의 정책 형태(프로파일 ARN + 목적지 모델 ARN + `bedrock:InferenceProfileArn` 조건, `aws:RequestedRegion=unspecified` Deny)는 Bedrock 문서의 예시와 대조했지만, `<Sonnet 5.5 모델 ID>` 자리와 SCP의 글로벌 서비스 예외 목록은 계정에서 테스트 후 게시해야 합니다.
> - Bedrock Guardrails 민감정보 필터의 한국어 지원 범위는 확인하지 못해 "확인 필요"로 표기했습니다.
> - 내부 정보(사내 논의·내부 구현 이름·계정 ID)는 포함하지 않았습니다.

---

## 한눈에 보기

- 병원 AI에서 어려운 질문은 "어떤 모델이 똑똑한가"가 아니라 **"이 데이터가 어디서 처리되는가"** 입니다. 건강정보는 민감정보이고, 진료기록 원문은 병원의 통제 밖으로 나가기 어렵고, 가명정보조차 동의 없는 국외 이전은 원칙적으로 허용되지 않습니다.
- Amazon Bedrock에서 최신 Claude(Opus/Sonnet 5.5)를 서울 리전에서 쓰는 방법은 현재 크로스 리전 추론(`global.*`)뿐이고, 이 경로는 요청을 **한국 밖 리전에서 처리할 수 있습니다.** 그래서 "전부 Bedrock" 또는 "전부 자체 구축" 사이에 세 번째 길이 필요합니다.
- 제안하는 패턴은 **두 개의 처리 영역**입니다. **Zone A(서울 리전 내)** 에서 자체 호스팅 결정 모델이 분류·라우팅·점수화·검증을 80 ms에 끝내고, 문장을 만들어야 하는 일만 **Zone B(Bedrock Claude)** 로 보내되, 보내는 것은 개인정보가 아님이 확인된 페이로드로 한정합니다.
- 핵심은 **경계를 넘길지 판단하는 첫 결정도 Zone A의 결정 모델이 내린다**는 점입니다. "개인정보가 남아 있는가", "환자 데이터 접근이 필요한 요청인가"를 확률로 답하고, 임계값을 넘으면 요청은 밖으로 나가지 않습니다.
- 환자 문의 챗봇·의무기록 워크플로·연구 데이터 큐레이션·행정 문서·직원 에이전트 다섯 시나리오로 무엇이 안에서 결정되고, 무엇만 밖으로 나가는지 표로 정리했습니다. 비용 감각: 진료 노트 100만 건의 표현형 추출(500만 결정)이 자체 호스팅 ≈$165, Sonnet 5.5 ≈$4,050.
- 경계는 정책 문서가 아니라 IAM 리소스 제한·SCP 리전 조건·VPC 엔드포인트·CloudTrail `inferenceRegion` 감사로 지킵니다. 4주 PoC 계획과 체크리스트를 끝에 붙였습니다.

## 1. 병원은 "어디서 처리하느냐"가 먼저다

챗봇 데모는 하루면 만듭니다. 병원에서 막히는 지점은 그다음입니다. 개인정보보호 담당자가 묻습니다. "환자 문의 원문이 어느 나라 서버에서 처리됩니까?" 이 질문에 답이 없으면 아무리 정확한 모델도 도입되지 않습니다.

공개 자료로 확인되는 전제는 다음과 같습니다(법률 해석은 병원의 CPO·법무·IRB와 확정해야 하며, 여기서는 기술 설계를 위한 전제만 정리합니다).

| 사실 | 설계에 미치는 영향 |
|---|---|
| 건강정보는 개인정보보호법상 **민감정보**. 의료기관의 진료기록은 의료법상 비밀유지 의무가 있고, 외부 제공에는 환자 동의가 필요 | 진료기록 원문은 병원이 통제하는 영역 밖으로 나가지 않는 설계가 출발점 |
| **가명정보**는 연구·통계·공익 기록보존 목적에 동의 없이 활용할 수 있으나 재식별 방지·결합전문기관 등 요건이 붙고, 정보주체 동의가 없으면 **가명처리한 보건의료데이터의 국외 이전은 원칙적으로 불가**(ICLG Korea 2026) | "가명처리했으니 해외 리전으로 보내도 된다"는 성립하지 않음. 레코드 단위 가명정보도 국내에 머묾 |
| 2016년 의료법 개정 이후 전자의무기록의 의료기관 외부(클라우드) 보관이 허용되고, LLM 기반 의무기록 요약·음성 EMR이 빠르게 확산 중(ICLG) | 진료 텍스트에 LLM을 쓰려는 수요는 이미 현실. 쟁점은 처리 위치 |
| Bedrock 크로스 리전 추론: **Global 프로파일은 전 세계 상용 리전 어디서든, Geographic(APAC) 프로파일은 지역 내(한국 외 포함) 어디서든** 처리. 전송은 AWS 네트워크 내 암호화, CloudTrail `additionalEventData.inferenceRegion`으로 처리 리전 확인 가능([AWS 문서](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)) | 두 프로파일 모두 "국내 처리"는 아님. 국내 처리 = 서울 리전 단일 호출이 되는 모델 또는 자체 호스팅. 2026-09 기준 서울에서 Opus/Sonnet 5.5는 `global.*`만 제공 |
| 환자 데이터를 분석해 진단·치료 방향을 제시하는 소프트웨어는 **디지털의료기기(SaMD)** 로 분류될 수 있음(디지털의료제품법). 일반 지식 제공·정보 검색은 해당 없음 | 이 글의 시나리오는 **업무 흐름 결정**(라우팅·분류·완비성·우선순위)에 한정. 진단·치료 제안은 범위 밖 |

정리하면 병원 AI는 두 종류의 데이터를 다릅니다. **환자 식별정보와 진료 내용이 붙어 있는 데이터**는 서울 리전 안에서 처리를 끝내야 하고, **병원 공개 안내문·규정·표준 서식·집계 통계·의학 일반 지식**은 그런 제약이 없습니다. 이 둘을 한 파이프라인에서 섞어 쓰면 전체가 첫 번째 기준에 묶입니다. 나누면 각각에 맞는 도구를 쓸 수 있습니다.

## 2. 두 개의 처리 영역

비유를 하나 들겠습니다. 병원 안에는 진료기록실이 있고, 기록은 그 안에서만 열람합니다. 외부 번역 업체에 무언가를 보낼 일이 있으면 기록 원본이 아니라 **이름과 번호를 지운 요약 한 장**을 보내고, 무엇을 보낼 수 있는지는 기록실 담당자가 먼저 판정합니다. 이 글의 구조는 그 비유를 그대로 클라우드에 옮긴 것입니다.

- **Zone A — 서울 리전 내 처리 영역**: 환자 식별정보·진료기록 원문·가명정보가 존재하는 모든 단계. 여기서 **자체 호스팅 결정 모델**(EC2 g5.2xlarge 한두 대, 직접 로짓 분류)이 분류·라우팅·점수화·검증을 맡습니다. 문장 생성이 꼭 필요하면 서울 리전 안에서만 처리되는 모델(단일 리전 호출 모델 또는 자체 호스팅 생성 모델)만 씁니다.
- **Zone B — Bedrock 크로스 리전 추론 영역**: Claude Sonnet/Opus 5.5(`global.*`)로 문장을 만듭니다. 들어가는 데이터는 **개인정보가 아닌 것으로 확인된 페이로드만**: 공개 안내문·규정, 표준 템플릿, 집계 통계, 의학 일반 지식 질의, 마스킹 후 검증을 통과한 문의 요지.

```
┌────────────────────────  Zone A: ap-northeast-2, 병원 VPC (인바운드 0, 인터넷 게이트웨이 없음)  ────────────────────────┐
│                                                                                                                   │
│  EMR / 콜센터 / 챗봇 / 연구 DB ──▶ ① 비식별화 파이프라인 ──▶ ② 결정 모델 (g5.2xlarge ×2, 직접 로짓)                     │
│        (원문, 개인정보)             (규칙·사전 기반 마스킹,       · 개인정보 잔존 여부  (Noul)   · 의도/부서/문서유형 (Choice) │
│                                     날짜 시프트, 로그 마스킹)     · 긴급도/우선순위     (Score)  · 에이전트 도구 선택 (Choice) │
│                                                                      │ 확률 + 임계값                                    │
│                                          ┌───────────────────────────┴───────────────────────┐                        │
│                                          ▼ 개인정보 경로 (경계 안)                              ▼ 비개인 경로 (통과 허용)    │
│                               ③ 템플릿 응답 / 구조화 저장 / 리전 내 생성 모델           ④ 마스킹 확인된 요지·집계값·공개 문서만│
│                                  S3+KMS, RDS, 감사 로그 (모두 서울)                                 │ VPC 엔드포인트          │
└────────────────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────┘
                                                                                                     ▼
                                       Zone B: Amazon Bedrock  global.anthropic.claude-sonnet-5-5 (effort=low)
                                       · 안내문·회신 초안  · 규정/FAQ 기반 답변  · 보고서·SQL 초안  → 결과는 Zone A로 돌아와
                                         ⑤ 결정 모델이 다시 검증(의료조언성·정책위반 Noul) 후 사용
```

결정 모델이 무엇이고 왜 80 ms에 98.8% 정답률이 나오는지는 전편에서 다뤘습니다. 이 글에서 필요한 성질은 네 가지입니다. **빠르다**(warm cache p50 79 ms), **밖으로 나가지 않는다**(서울 리전 EC2에서 실행), **형식 오류가 없다**(라벨 토큰만 읽으므로 스키마 위반 0), **확률을 준다**(캘리브레이션 오차 ECE 0.026 — "확률 0.8 미만은 사람이 본다"는 규칙이 실제로 동작합니다).

## 3. 첫 번째 결정: "이 데이터가 밖으로 나갈 수 있는가"

이 구조에서 가장 중요한 결정은 의도 분류도 부서 배정도 아닌 **경계 판정**입니다. 판정하는 쪽이 원문을 봐야 하므로, 판정기는 반드시 Zone A 안에 있어야 합니다. Bedrock에 "이 문장에 개인정보가 있나요?"라고 묻는 순간 원문은 이미 나간 뒤입니다.

경계 판정은 세 겹으로 둡니다.

1. **결정론적 비식별화(1차)**: 환자명·보호자명 사전(EMR 마스터에서 생성), 병록번호·주민등록번호·전화번호·주소 패턴, 날짜 시프트. 기계적으로 지울 수 있는 것은 기계적으로 지웁니다.
2. **결정 모델의 잔존 판정(2차)**: 마스킹 결과를 보고 "식별 가능한 개인정보가 남아 있는가"(Noul)를 답합니다. 임계값은 보수적으로 둡니다(예: 잔존 확률 > 2%면 차단하고 사람 검토 큐로). 결정 모델은 문맥을 읽으므로 "옆집 3층에 사는 김 교수님 아들"처럼 패턴으로 잡히지 않는 간접 식별 표현을 걸러 냅니다.
3. **Bedrock Guardrails 민감정보 필터(3차, 선택)**: Zone B 호출에 붙일 수 있는 추가 층입니다. 한국어 개인정보 유형의 지원 범위는 확인이 필요하므로, 1·2차를 대체하는 것이 아니라 보강으로 봅니다.

그리고 Zone B로 나간 **모든 페이로드**를 마스킹 결과·결정 모델 확률과 함께 서울 리전 S3에 보관하고, 1% 표본을 사람이 검토합니다. 이 기록이 "무엇이 나갔는가"에 대한 답이 되고, 사람이 잡아낸 사례는 라벨 설명과 마스킹 규칙을 고치는 재료가 됩니다.

## 4. 다섯 가지 시나리오

각 시나리오는 "Zone A에서 무엇을 결정하는가 → 문장 생성이 필요한가 → Zone B로 실제로 나가는 데이터는 무엇인가"의 순서로 적었습니다. 모두 설계안이며, 라벨과 임계값은 병원 데이터로 다시 잡아야 합니다.

### S1. 환자 문의 챗봇·콜센터 트리아지 (환자 대면, 실시간)

**상황**: 병원 앱 채널로 이런 메시지가 옵니다. "당뇨약 바꾼 뒤로 어지러운데 다음 주 예약을 앞당길 수 있나요? 김OO, 010-1234-…"

**Zone A 결정 4개(≈0.3초)**. 결정 모델에는 지시문·라벨 표·마스킹된 입력이 들어가고, 라벨별 확률이 나옵니다.

```json
{"instruction": "이 환자 문의의 주된 의도를 하나 고르세요.",
 "text": "당뇨약 바꾼 뒤로 어지러운데 다음 주 예약을 앞당길 수 있나요? [환자명], [전화번호]",
 "labels": [{"id": "appointment_change", "description": "예약 변경·취소·앞당김 요청"},
            {"id": "symptom", "description": "증상·부작용 상담 (진료 필요 여부 문의 포함)"},
            {"id": "prescription", "description": "처방·재발급·복약 문의"},
            {"id": "admin", "description": "서류·비용·주차 등 행정"},
            {"id": "other", "description": "칭찬·감사·기타 처리 불필요"}]}
→ {"appointment_change": 0.71, "symptom": 0.27, "prescription": 0.01, "admin": 0.00, "other": 0.01}
```

| 결정 | 프리미티브 | 이 예시의 출력 | 동작 |
|---|---|---|---|
| 개인정보 포함 여부 | Noul | 0.99 | 개인정보 경로. 원문은 밖으로 나가지 않음 |
| 의도 | Choice(5~8) | 예약변경 0.71 / 증상상담 0.27 | 두 의도가 섞임 → 예약 처리 + 증상 안내 둘 다 |
| 긴급도 | Score(1~5) | 2.3 | 4 이상이면 응급실·119 안내 템플릿을 즉시 |
| 담당 진료과/부서 | Choice(≈30) | 내분비내과 0.88 | 콜백·예약 큐 배정 |

**응답 생성**: 개인정보 경로에서는 LLM을 부르지 않습니다. 예약 변경은 예약 시스템 API와 템플릿("김OO님, 내분비내과 예약을 앞당길 수 있는 가장 빠른 시간은 …")으로 충분하고, 증상 상담이 섞여 있으면 표준 문구("약 변경 후 증상은 진료가 필요합니다")와 간호 상담 콜백 큐를 붙입니다. 진단이나 복약 지시는 만들지 않습니다.

**Zone B가 필요한 경우**: 개인정보가 없는 일반 질문("MRI 검사 전 금식은 몇 시간인가요?", "주차 요금은 얼마인가요?")은 마스킹·검증을 거친 질문 요지만 Bedrock으로 보내 **병원 공개 FAQ·안내문**을 근거로 답을 만듭니다. 돌아온 답은 Zone A 결정 모델이 "진단·처방으로 읽히는가"(Noul)를 다시 판정한 뒤 내보냅니다.

**나가는 것 / 나가지 않는 것**: 비개인 질문 요지와 공개 FAQ 문단은 나갑니다. 이름·연락처·병록번호·증상 서술·예약 정보는 나가지 않습니다.

**기대 효과**: 문의의 60~70%(예약·행정)는 LLM 없이 즉답, 20~30%만 Bedrock 생성. 결정 4개에 ≈0.3초라 실시간 채널에 맞습니다. 전편 실측에서 6라벨 라우팅·20라벨 분류가 98~100%였고, 모든 모델이 공통으로 틀린 문항은 라벨 설명이 모호한 경우였습니다("배송기사님이 친절했다"를 배송 문의로 분류). 병원에서도 "칭찬·감사"처럼 처리가 필요 없는 메시지를 `other`에 명시해 두는 것이 정답률을 좌우합니다.

### S2. 의무기록 워크플로 — 문서 라우팅·완비성 점검·코드 후보 (임상 문서, 준실시간/배치)

**상황**: 퇴원요약·의뢰서·협진 회신, 음성 EMR(STT) 텍스트가 하루 수천 건 만들어집니다.

| 결정 | 프리미티브 | 설명 |
|---|---|---|
| 문서 유형 | Choice(≈20) | 퇴원요약 / 의뢰서 / 수술기록 / 협진회신 / … |
| 필수 항목 누락 | Noul × 항목 수 | "주호소가 기재되어 있는가", "퇴원 시 투약 계획이 있는가" — 항목별 확률. 누락 의심은 작성자에게 즉시 반송 |
| 주진단 코드 후보 | 2단계 Choice | 1단계: 텍스트 검색으로 KCD 후보 30개 → 2단계: 결정 모델이 순위와 확률. **코딩 담당자의 최종 선택을 보조** |
| 심사 위험 플래그 | Noul | "과거 삭감 사례와 유사한 청구인가" → 심사팀 사전 검토 큐 |
| 인계 우선순위 | Score | 협진 회신·검사 결과 알림의 처리 순서 |

**생성**: 요약문은 진료기록 원문 전체가 입력이므로 **Zone A 안에서만** 만듭니다. 선택지는 세 가지입니다. (a) 구조화 추출 + 템플릿 — 생성 모델이 필요 없고 인계·안내 문서 대부분에 충분합니다. (b) 서울 리전 단일 호출이 가능한 Bedrock 모델(제공 목록은 시점마다 바뀌므로 확인). (c) 같은 GPU에 올린 자체 호스팅 생성 모델(결정 모델에 쓴 27B 오픈웨이트 모델을 생성 모드로 쓰는 것도 가능). Bedrock `global.*` Claude에는 보내지 않습니다.

**나가는 것**: 없음(문서 서식이나 작성 지침처럼 개인정보가 없는 콘텐츠의 초안 작성만 예외). **주의**: 여기서 결정 모델은 문서 품질과 업무 흐름을 판정합니다. 진단을 제안하지 않고, 코드 후보 순위는 담당자의 보조 도구로 위치를 명확히 해야 SaMD 논의를 피할 수 있습니다.

**비용 감각**: 하루 5,000건 × 결정 6개 = 3만 결정 ≈ $1(자체 호스팅, 가동 시간 비례) vs Sonnet 5.5 ≈ $24.

### S3. 연구 데이터 파이프라인 — 진료 노트에서 표현형·표준 개념 추출 (연구, 대량 배치)

**상황**: 연구용 가명처리 데이터베이스(예: OMOP 공통 데이터 모델)를 구축하는데, 흡연 여부·합병증·약물 순응처럼 구조화 필드에 없는 정보가 진료 노트에만 있습니다. 노트 100만 건.

| 결정 | 프리미티브 | 예 |
|---|---|---|
| 표현형 유무 | Noul × N | "당뇨 신경병증 언급" 0.93, "현재 흡연" 0.12 |
| 자유 텍스트 → 표준 개념 | 2단계 Choice | 어휘 검색으로 후보 20개 → 결정 모델이 선택 + 확률(낮으면 큐레이터 검토) |
| 노트 품질·관련성 | Score | 연구 포함 기준 충족도 |

**Zone B의 역할**: 레코드는 한 건도 나가지 않습니다. 나가는 것은 **집계 결과**(표현형 분포, 코호트 크기, 결측률)와 **공개 표준 스키마**(OMOP CDM은 공개 규격)입니다. Bedrock Claude가 분석 보고서 초안과 SQL 초안을 쓰고, SQL은 Zone A에서 실행합니다. 가명정보라도 레코드 단위는 동의 없는 국외 이전 불가 원칙(§1)에 걸리므로 이 분리가 핵심입니다.

**비용 감각**: 100만 노트 × 결정 5개 = 500만 결정 → 자체 호스팅 ≈ $165(가동률 100% 가정, 한 대로 약 11일; 급하면 대수를 늘리고 끝나면 종료) vs Sonnet 5.5 ≈ $4,050. 확률이 낮은 10~15%만 큐레이터가 봅니다.

### S4. 청구·심사·민원 — 행정 문서 처리 (비임상, 배치)

**상황**: 심사 자료 요청 회신, 진단서·제증명 발급 요청, 환자 민원 접수.

**Zone A 결정**: 요청 유형(Choice), 첨부 서류 완비 여부(Noul × 항목), 민원 심각도(Score), 재발 민원 여부(Noul).

**생성**: 회신문 초안은 환자 식별 요소를 지운 **"사유 코드 + 상황 요지"** 만 Zone B로 보내 표준 회신 문체로 받고, Zone A에서 실제 이름·날짜를 템플릿에 채웁니다. 치환은 LLM이 아니라 코드가 합니다.

**나가는 것**: 사유 코드, 마스킹된 요지("검사 결과 통보 지연에 대한 불만"). **나가지 않는 것**: 이름, 병록번호, 진료 내용 상세.

### S5. 직원용 에이전트 — 결정 모델이 데이터 경계 라우터가 되는 에이전트 (내부 도구)

**상황**: 직원 어시스턴트에 두 종류의 요청이 섞여 옵니다. "지난주 당뇨 교육 참석 환자 명단 뽑아줘"(환자 데이터 필요) vs "당직 근무 규정 알려줘"(비개인).

| 결정(에이전트 매 스텝, ≈80 ms) | 프리미티브 | 동작 |
|---|---|---|
| 환자 데이터 접근이 필요한 요청인가 | Noul | ≥ 0.05면 개인정보 경로: Zone A 도구만 사용, 결과는 구조화 출력(표·CSV), LLM 생성 없음 |
| 도구 선택 | Choice(≈15) | 예약 API / EMR 조회 / 규정 검색 / 통계 / … |
| 요청 종료 여부 | Noul | 추가 스텝 필요성 |
| 사용자 재확인 필요 여부 | Noul | 삭제·발송처럼 되돌릴 수 없는 동작 전 |

**비개인 경로**: 규정·매뉴얼·공지 같은 비개인 문서 기반 답변은 Bedrock Claude가 만들고, 결정 모델이 답의 정책 위반 여부를 한 번 더 판정합니다.

**요지**: 에이전트는 한 요청에 결정을 10~20번 내립니다. 매번 1초짜리 LLM 호출이면 체감 속도가 무너지고, 그 호출마다 원문이 밖으로 나갑니다. 결정을 안에서 80 ms에 끝내면 속도와 경계가 함께 해결됩니다. 오픈소스 에이전트 SDK에서도 결정 모델 인터페이스가 논의되고 있습니다([Strands Agents harness-sdk PR #4558](https://github.com/strands-agents/harness-sdk/pull/4558)).

### 주의 사례 — 임상 알림 우선순위는 의료기기 경계

CDS 경고(약물 상호작용·검사 이상치)의 알림 피로를 줄이기 위해 결정 모델로 우선순위를 매기는 아이디어는 자연스럽지만, 환자 데이터를 분석해 임상 행동에 영향을 주는 소프트웨어는 SaMD로 분류될 수 있습니다. 이 방향은 규제 검토와 임상 검증 없이 진행하지 않는 것이 맞고, S1~S5는 그 경계 안쪽(업무 흐름·행정·연구 큐레이션)에 머무릅니다.

## 5. 한 장 요약

| 시나리오 | Zone A 결정(자체 호스팅, 서울) | 생성 | Zone B로 나가는 것 | 절대 나가지 않는 것 |
|---|---|---|---|---|
| S1 환자 문의 | 개인정보 여부·의도·긴급도·부서 | 템플릿(개인정보 경로) / Bedrock(비개인 FAQ) | 비개인 질문 요지, 공개 FAQ | 이름·연락처·병록번호·증상 |
| S2 의무기록 | 문서 유형·누락·코드 후보·심사 위험·우선순위 | Zone A 내에서만 | 없음 | 진료기록 원문 전체 |
| S3 연구 | 표현형·표준 개념·품질 | Bedrock(보고서·SQL 초안) | 집계표, 공개 스키마 | 레코드 단위 가명정보 |
| S4 행정 | 요청 유형·완비성·심각도 | Bedrock(마스킹 요지 → 초안) + 코드 치환 | 사유 코드, 마스킹 요지 | 식별정보, 진료 상세 |
| S5 직원 에이전트 | 환자 데이터 필요 여부·도구·종료·재확인 | Bedrock(비개인 규정 RAG) | 규정·매뉴얼 질의 | 환자 조회 결과 |

## 6. 경계를 "정책 문서"가 아니라 "기술"로 지키기

"개인정보는 Bedrock에 보내지 않습니다"는 문장은 감사에서 증빙이 되지 않습니다. 보내려 해도 보낼 수 없게 만들고, 실제로 어디서 처리됐는지 로그로 보여야 합니다. 네 가지 장치를 씁니다. (아래 정책은 동작 원리를 보이는 예시이며, 리소스 ARN과 글로벌 서비스 예외는 계정에서 테스트해야 합니다.)

### 6-1. IAM — Zone A 역할은 서울 단일 리전 모델만

크로스 리전 추론 프로파일을 호출하려면 프로파일 ARN뿐 아니라 **목적지 리전 각각의 파운데이션 모델 ARN**에 대한 권한이 필요합니다([Bedrock 문서: 추론 프로파일 사전 요건](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)). 그러므로 Zone A(개인정보 처리) 역할에 서울 리전 모델 ARN만 허용하면, `global.*`·`apac.*` 프로파일 호출은 권한 오류로 거부됩니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "SeoulInRegionModelsOnly",
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
    "Resource": "arn:aws:bedrock:ap-northeast-2::foundation-model/*"
  }]
}
```

Zone B(비개인 생성) 역할은 반대로 프로파일과 목적지 모델을 명시적으로 허용합니다. AWS 문서의 예시 형태를 따르면, 프로파일 ARN을 허용하는 문장과 파운데이션 모델 ARN(글로벌 프로파일은 리전 없는 `arn:aws:bedrock:::foundation-model/...` 형태 포함)을 `bedrock:InferenceProfileArn` 조건으로 묶는 문장을 함께 둡니다. 두 역할을 **다른 계정(또는 다른 OU)** 에 두면 실수로 섞일 여지가 줄어듭니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "GlobalSonnetProfile",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel*"],
      "Resource": "arn:aws:bedrock:ap-northeast-2:<계정ID>:inference-profile/global.anthropic.claude-sonnet-5-5"
    },
    {
      "Sid": "DestinationModelsViaProfileOnly",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel*"],
      "Resource": [
        "arn:aws:bedrock:ap-northeast-2::foundation-model/<Sonnet 5.5 모델 ID>",
        "arn:aws:bedrock:::foundation-model/<Sonnet 5.5 모델 ID>"
      ],
      "Condition": {"StringLike": {"bedrock:InferenceProfileArn": "arn:aws:bedrock:ap-northeast-2:<계정ID>:inference-profile/global.anthropic.claude-sonnet-5-5"}}
    }
  ]
}
```

Zone A 역할에는 AWS 문서가 제시하는 **명시적 Deny**를 하나 더 붙일 수 있습니다. Global 라우팅 요청은 `aws:RequestedRegion`이 `unspecified`로 평가되므로, 이 조건의 Deny는 어떤 Allow보다 우선해 Global 프로파일 호출을 막습니다(Geographic 프로파일은 위 6-1의 "목적지 리전 모델 ARN 미허용"으로 막힙니다).

```json
{
  "Sid": "DenyGlobalRouting",
  "Effect": "Deny",
  "Action": ["bedrock:InvokeModel*"],
  "Resource": "*",
  "Condition": {"StringEquals": {"aws:RequestedRegion": "unspecified"}}
}
```

### 6-2. SCP — 개인정보 계정은 `aws:RequestedRegion`을 서울로 고정

AWS 문서는 Global 프로파일에 `"aws:RequestedRegion": "unspecified"` 허용이, Geographic 프로파일에 모든 목적지 리전 허용이 필요하다고 명시합니다. 개인정보 계정(OU)에 요청 리전을 `ap-northeast-2`로만 허용하는 SCP를 걸면 두 프로파일이 모두 막힙니다. IAM·STS 등 글로벌 서비스는 예외로 두어야 하므로 [AWS의 리전 제한 SCP 예시](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_general.html)의 `NotAction` 목록을 그대로 따르는 것이 안전합니다.

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyOutsideSeoul",
    "Effect": "Deny",
    "NotAction": ["iam:*", "sts:*", "organizations:*", "support:*", "cloudfront:*", "route53:*", "budgets:*", "health:*"],
    "Resource": "*",
    "Condition": {"StringNotEquals": {"aws:RequestedRegion": ["ap-northeast-2"]}}
  }]
}
```

### 6-3. 네트워크 — 인바운드 0, 엔드포인트만

- 결정 모델 서버는 `127.0.0.1`에만 바인딩하고 내부 ALB 뒤에 얇은 API 계층(인증·요청 검증·라벨 수 상한·타임아웃)을 둡니다. 전편의 벤치마크 인프라도 인바운드 없이 SSM Session Manager로만 접속했습니다.
- Bedrock(`bedrock-runtime`), S3, SSM은 VPC 엔드포인트로 연결하고 인터넷 게이트웨이는 두지 않습니다([Bedrock VPC 엔드포인트 문서](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html)).
- 저장은 모두 서울 리전 S3(KMS)·RDS. Bedrock 모델 호출 로깅을 켜면 로그도 호출한 리전(서울)에 남습니다([문서](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html)). Zone B 로그에는 설계상 비개인 페이로드만 있어야 하지만, KMS 암호화와 접근 제한은 그대로 적용합니다.

### 6-4. 감사 — "어디서 처리됐는가"를 매달 증명

CloudTrail은 크로스 리전 추론 요청을 호출한 리전(서울)에 기록하고, `additionalEventData.inferenceRegion`에 실제 처리 리전을 남깁니다. Athena로 서울 밖에서 처리된 호출을 뽑는 쿼리는 이런 모양입니다(단일 리전 호출은 이 필드가 비어 있을 수 있어 `COALESCE`로 처리).

```sql
SELECT eventtime, useridentity.arn AS caller, eventname,
       COALESCE(json_extract_scalar(additionaleventdata, '$.inferenceRegion'), 'ap-northeast-2') AS inference_region
FROM   cloudtrail_logs
WHERE  eventsource = 'bedrock.amazonaws.com'
  AND  eventname IN ('InvokeModel', 'InvokeModelWithResponseStream', 'Converse', 'ConverseStream')
  AND  COALESCE(json_extract_scalar(additionaleventdata, '$.inferenceRegion'), 'ap-northeast-2') <> 'ap-northeast-2'
ORDER  BY eventtime DESC;
```

이 결과에 Zone A 역할이 한 건이라도 나오면 경계 위반입니다. 월간 리포트, Zone B 페이로드 표본 검토 기록, 결정 모델 정답률·임계값 변경 이력 — 이 세 가지가 개인정보보호 담당자와 IRB에 내는 설명 자료가 됩니다.

## 7. 용량과 비용 감각

전편 실측(서울, g5.2xlarge A10G)을 기준으로 잡은 값입니다.

| 항목 | 값 | 비고 |
|---|---|---|
| 결정 1건 | warm cache p50 79 ms, p99 94 ms | 지시문·라벨 표를 캐시하고 문항 텍스트만 계산 |
| 한 대의 순차 처리량 | ≈12/s, 하루 ≈45만 결정 | 참조 구현의 서버는 단일 스레드라 최소치. 동시성·배치를 살리면 그 이상 |
| S1 챗봇 | 하루 5,000건 × 4 결정 = 2만 결정 | 한 대의 5% 미만. 2대(멀티 AZ)는 가용성 목적 |
| S3 연구 배치 | 500만 결정 | 1대 ≈11일 또는 5대 ≈2일, 비용은 같음(≈$165) |
| 자체 호스팅 고정비 | $1.49/h × 24 ≈ **$36/일/대**(온디맨드) | 야간에 S2·S3 배치를 같은 GPU에서 돌리면 가동률이 올라감. Savings Plan으로 절감 가능 |
| Bedrock(Zone B) | 하루 1,500건 생성 × (입력 1.5K + 출력 300 토큰) ≈ **$9/일** | Sonnet 5.5 `effort=low`, 공개 요금 기준. 비개인 생성만 보내므로 볼륨이 작음 |
| 손익분기 | 하루 ≈4.4만 결정 | Sonnet 5.5로 결정을 대신할 때와 비교. 다만 병원에서는 비용보다 **국내 처리 요건**이 자체 호스팅을 정함 |

Bedrock 쪽 설정은 전편의 결론을 그대로 씁니다. `output_config.effort=low`, `maxTokens` 512(분류형)~2K(초안 생성형), `stopReason`과 `content_filtered` 처리 분기, 시스템 프롬프트 고정으로 프롬프트 캐시 활용. 서울에서 `global.*`만 제공되는 현실은 바뀔 수 있으므로, 서울 단일 리전 호출이 가능한 모델이 추가되면 Zone A의 생성 선택지로 검토합니다.

## 8. 4주 PoC와 체크리스트

전편의 CloudFormation 템플릿(저장 스택·컴퓨트 스택)과 측정 스크립트를 그대로 재사용할 수 있습니다. GPU를 상시 가동하면 4주 ≈$1,000, 필요할 때만 켜는 PoC 방식이면 ≈$200입니다.

| 주 | 할 일 | 산출물 |
|---|---|---|
| 1 | 데이터 경계 정의(무엇이 Zone B로 갈 수 있는가를 문서로), S1 라벨 설계(문의 유형 5~8·부서 30·긴급도 척도), 익명 샘플 300건 라벨링 | 라벨 정의서, 태스크 파일 |
| 2 | Zone A 배포: 비식별화 파이프라인 + 결정 모델(서울, 인바운드 0), IAM/SCP 경계, CloudTrail 리포트 쿼리 | CloudFormation, 정답률·임계값 보고 |
| 3 | S1 end-to-end: 챗봇 → 결정 4개 → 템플릿/Bedrock 분기 → 응답 검증 → 응답. Zone B 페이로드 로깅 | 데모, 페이로드 감사 로그 |
| 4 | 측정: 정답률·p50/p99·Bedrock 호출 비율·Zone B 페이로드 표본 검토·비용. S2/S3 확장 계획 | 결과 보고서 |

**체크리스트**

1. Zone B로 나갈 수 있는 데이터 유형을 문서로 정의하고 CPO 승인을 받았는가.
2. 1차 비식별화가 결정론적(사전·패턴·날짜 시프트)으로 구현되어 있는가.
3. 결정 모델의 "개인정보 잔존" 임계값이 보수적으로(예: 2%) 설정되고, 차단 건이 사람 검토 큐로 가는가.
4. Zone A 역할의 IAM에 크로스 리전 프로파일·목적지 리전 모델 ARN이 없는가.
5. 개인정보 계정에 리전 제한 SCP가 걸려 있고, Zone B 역할은 별도 계정/OU에 있는가.
6. 인터넷 게이트웨이 없이 VPC 엔드포인트만으로 Bedrock·S3·SSM에 연결되는가.
7. Zone B로 나간 모든 페이로드가 서울 S3에 보관되고 1% 표본 검토가 일정으로 잡혀 있는가.
8. CloudTrail `inferenceRegion` 월간 리포트가 자동화되어 있는가.
9. 각 라벨에 "포함/제외 예"가 한 줄씩 적혀 있고, 병원 데이터 200~300건으로 정답률을 측정했는가.
10. 시나리오가 업무 흐름·행정·연구 큐레이션 범위에 머물고, 진단·치료 제안(SaMD 영역)을 건드리지 않는가.

## 9. 한계와 주의

- 다섯 시나리오는 설계안입니다. 전편의 측정은 범용 분류 문제(감정·라우팅·카테고리·UI 요소)와 공개 벤치마크에서 한 것이므로, 병원 어휘와 라벨 체계에서의 정답률은 PoC 1~2주차에 반드시 다시 재야 합니다.
- 규제 서술은 공개 자료 기준의 기술 설계 전제입니다. 법 적용은 병원의 CPO·법무·IRB가 확정합니다. 특히 가명정보 처리와 국외 이전, 그리고 SaMD 경계는 병원과 사업 형태에 따라 판단이 달라질 수 있습니다.
- 한국어 비식별화는 영어권만큼 성숙한 도구가 적습니다. 사전 기반 마스킹의 품질이 전체 안전성의 바닥이므로 EMR 마스터 연동과 표본 검토를 생략하면 안 됩니다.
- Claude 5.5의 thinking·거절 동작과 서울 리전의 모델 제공 목록은 시점(2026-09)의 관찰이며 바뀔 수 있습니다. 설정을 코드에 명시하고 `stopReason`을 확인하는 습관이 보험입니다.
- 결정 모델은 문장을 만들지 못하고, 계산·다단계 추론에 약합니다(전편 JevBench temporal_numeric 20%). 그런 일은 Zone A의 생성 모델이나 Zone B의 Claude에 맡기고, 결정 모델은 그 앞뒤의 판정에 두는 것이 이 구조의 요지입니다.

## 10. 참고 자료

- 전편: [DRAFT] "결정 모델(System One)"을 AWS에서 쓰는 방법 — 자체 호스팅 결정 모델 vs Amazon Bedrock Claude 5.5, 서울 리전 실측 (같은 책)
- ICLG, [Digital Health Laws and Regulations 2026 – Korea](https://iclg.com/practice-areas/digital-health-laws-and-regulations/korea/) (Lee & Ko) — 민감정보·가명정보·국외 이전·SaMD 서술의 근거
- Amazon Bedrock: [크로스 리전 추론](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html) · [추론 프로파일 사전 요건(IAM)](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html) · [VPC 엔드포인트](https://docs.aws.amazon.com/bedrock/latest/userguide/vpc-interface-endpoints.html) · [모델 호출 로깅](https://docs.aws.amazon.com/bedrock/latest/userguide/model-invocation-logging.html) · [Guardrails 민감정보 필터](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails-sensitive-filters.html) · [Claude adaptive thinking](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html)
- AWS Organizations, [SCP 예시 — 요청 리전 기반 접근 거부](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples_general.html)
- OHDSI, [OMOP Common Data Model](https://ohdsi.github.io/CommonDataModel/) — S3의 공개 표준 스키마
- TypeSafe AI, [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) · Prism ML, [Ternary-Bonsai-2-27B-gguf](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf) · [JevBench](https://github.com/fstandhartinger/jevbench) · [Strands Agents harness-sdk PR #4558](https://github.com/strands-agents/harness-sdk/pull/4558)
