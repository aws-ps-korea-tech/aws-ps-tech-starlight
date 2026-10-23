---
title: "[DRAFT] \"결정 모델(System One)\"을 AWS에서 쓰는 방법 — 자체 호스팅 결정 모델 vs Amazon Bedrock Claude 5.5, 서울 리전 실측"
---

# [DRAFT] "결정 모델(System One)"을 AWS에서 쓰는 방법 — 자체 호스팅 결정 모델 vs Amazon Bedrock Claude 5.5, 서울 리전 실측

> **게시 전 검토 메모 (게시할 때 이 블록은 삭제)**
>
> - 이 글의 모든 측정치는 2026-09-28~29에 AWS Korea Public Sector SA 팀 계정에서 직접 실행한 결과입니다. 원본 JSON·로그·분석 스크립트는 내부 워크스페이스 `jev-typesafe/results/2026092{9-01,9-03,9-04,9-05}/`에 있습니다.
> - **의도적으로 뺀 것(공개 부적합)**: 사내 Slack 논의, 내부 PFR·정책 문서, 사내 위키 벤치마크, 내부 패키지 이름·코드 링크·S3 버킷·계정 ID. 본문에서 자체 호스팅 구현은 "참조 구현"으로만 부르고, 공개 도구(PrismML llama.cpp 포크 + Hugging Face 오픈웨이트)로 같은 원리를 구현하는 절차를 대신 안내했습니다. → **결정 필요**: 참조 구현의 이름/기여자를 밝힐지, 오픈소스 공개 승인을 받을지.
> - **검증 상태**: §7-3 Bedrock 측정 스크립트(`bedrock_decision_bench.py`)와 CloudFormation 템플릿은 실제 실행으로 검증했습니다. §7-4의 llama-server 참고 클라이언트(`self_hosted_decision_client.py`)는 원리 설명용이며 **아직 GPU 호스트에서 끝까지 돌려보지 않았습니다**(≈$1.5·30분이면 검증 가능). 게시 전 한 번 실행하거나 "참고 코드" 표기를 유지해야 합니다.
> - **요금**: Bedrock Claude 5.5 요금은 Anthropic 공개 요금($2/$10, $4/$20 per MTok)을 가정해 계산했습니다. Bedrock 요금 페이지의 서울/Global 크로스 리전 요금으로 게시 전 재확인 필요. g5.2xlarge 서울 $1.4903/h는 Pricing API 값.
> - **표현 검토**: §5-3 Opus 5.5 안전 분류기 거절 관찰은 사실 기술이지만 모델 벤더 관련 문구라 톤 확인 필요. §1-1의 TypeSafe/Jev 설명은 모두 공개 블로그·문서 기준이며 AWS의 보증이 아님을 명시했습니다.
> - 첨부 예정 파일: `blog/code/bedrock_decision_bench.py`, `blog/code/self_hosted_decision_client.py`, `blog/code/tasks.json`(84항목), `blog/code/storage.yaml`, `blog/code/compute.yaml`, `blog/code/bootstrap_bedrock.sh`. BookStack에는 링크 첨부만 가능하므로 팀 GitHub 등 공개 위치가 필요합니다.

---

## 한눈에 보기

- **결정 모델(decision model)** 은 문장을 "생성"하지 않고, 주어진 선택지 중 하나를 확률과 함께 "고르는" 모델입니다. 2026년 9월 TypeSafe AI가 발표한 System One 모델 *Jev* 가 이 범주를 대중화했고, 같은 원리를 오픈웨이트 모델로 구현할 수도 있습니다.
- 서울 리전에서 **오픈웨이트 결정 모델을 g5.2xlarge(NVIDIA A10G) 한 대에 자체 호스팅**한 것과 **Amazon Bedrock의 Claude Opus 5.5 / Sonnet 5.5**를 같은 84개 분류 문제(영어·한국어·UI 요소 선택)로 비교했습니다.
- 자체 호스팅은 **p50 79 ms, 정답률 98.8%**. Sonnet 5.5는 기본 설정에서 p50 667 ms, `effort=low` 설정에서 **p50 568 ms·정답률 98.8%**(같은 정답률, 7.2배 느림). Opus 5.5는 p50 1,297 ms에 로그인 UI 요소 선택 문제의 42%를 거절했습니다.
- Claude 5.5 세대를 결정기로 쓸 때는 `maxTokens`를 수백으로 올리고 **`output_config.effort=low`** 를 함께 주는 것이 권장 설정입니다. 기본 설정에서는 애매한 입력마다 adaptive thinking이 켜져 p99가 2.4초까지 늘어나고, 짧은 출력 예산과 충돌해 빈 응답이 나옵니다.
- 비용은 볼륨이 결정합니다. 하루 **약 4.4만 건** 이상 결정하면 자체 호스팅(≈$36/일)이 Sonnet 5.5보다 싸고, 그 이하이면 Bedrock이 싸며, **100 ms 이하 응답이나 국내 데이터 처리 요건**이 있으면 볼륨과 무관하게 자체 호스팅이 답입니다.
- 이 글의 모든 실험은 CloudFormation 템플릿과 스크립트로 **무인 재현**할 수 있게 만들었고(§7), 1회 실행 비용은 GPU 레그 ≈$1.5, Bedrock 레그 ≈$0.5입니다.

## 1. 왜 지금 "결정 모델"인가

LLM을 업무 시스템에 붙여 본 분들은 비슷한 경험이 있을 겁니다. 챗봇으로는 훌륭한데, 코드 한가운데서 "이 민원은 어느 부서로 보낼까", "이 리뷰는 부정적인가", "이 문서가 정책 위반인가"를 물으면 세 가지가 걸립니다.

1. **느립니다.** 한 문장짜리 답을 받는 데 0.5~3초가 걸립니다. 사람에게는 괜찮지만, 요청 하나를 처리하는 동안 결정을 10번 내려야 하는 워크플로에서는 병목입니다.
2. **형식이 깨집니다.** "라벨 하나만 답하세요"라고 해도 가끔 설명을 덧붙이거나, 없는 라벨을 만들거나, 빈 답을 줍니다. 파서와 재시도 로직이 따라붙습니다.
3. **확신을 모릅니다.** 모델이 95%는 맞히는데 나머지 5%가 언제인지 말해주지 않으면 사람 검토 없이 자동화할 수 없습니다.

결정 모델은 이 세 문제를 정면으로 겨눕니다. 비유하자면 LLM은 **보고서를 써 주는 작가**이고, 결정 모델은 **서류에 도장을 찍는 심사관**입니다. 심사관은 글을 쓰지 않습니다. "승인/보류/반려" 중 하나에 도장을 찍고, 옆에 "확신 92%"라고 적어 줍니다. 도장은 정해진 칸에만 찍히니 형식이 깨질 수 없고, 글을 쓰지 않으니 빠릅니다.

### 1-1. System One 모델과 Jev (공개 자료 기준)

TypeSafe AI는 2026-09-15 블로그 [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)에서 이 범주의 첫 상용 모델 *Jev*를 발표했습니다. 이름은 Kahneman의 "빠르고 직관적인 System 1 사고"에서 왔습니다. 공개된 설계 요점은 다음과 같습니다(모두 벤더 발표 내용이며, 이 글에서 검증한 것은 아닙니다).

| 항목 | 기존 LLM | System One / Jev |
|---|---|---|
| 입력 | 대화 메시지 | `state`(비정형 텍스트/JSON) + `questions`(타입이 정해진 질문 목록) |
| 출력 | 문자열(파싱·검증 필요) | 질문마다 **확률 분포**. 프리미티브는 `Choice`(선택지 중 하나, 최대 255개), `Noul`(0~1 신뢰도), `Score`(등급) |
| 생성 방식 | 토큰을 하나씩 순차 생성 | 모든 답을 **한 번의 질의에서 병렬로** 산출 |
| 형식 오류 | 가능 | 구조적으로 0% (출력 공간이 사전에 정의됨) |
| 응답 시간(벤더 주장) | 수 초 | 70~500 ms |
| 요금(벤더 주장) | 입력 $0.2~10/MTok, 출력 별도 | 입력 $0.042/MTok, 출력 무료 |
| 학습법 | RLHF/RLVR | RLCD(Reinforcement Learning for Calibrated Decisions), 비공개 |

Jev는 호스팅 API로만 제공되고 가중치는 비공개입니다. 한계도 명확합니다. 텍스트만 받고(이미지 불가), 문자열을 생성할 수 없으며, 컨텍스트는 64K입니다. 즉 "요약해 줘"에는 못 쓰고, "이 요약이 원문과 일치하는가?"에는 아주 잘 맞습니다.

### 1-2. 같은 원리를 오픈웨이트로: 직접 로짓(direct-logit) 분류

Jev의 가중치는 비공개지만, "생성하지 않고 고른다"는 원리 자체는 일반 LLM으로도 구현할 수 있습니다. 방법은 단순합니다.

1. 프롬프트에 지시문과 **라벨 표**(코드 `A`, `B`, `C`… + 설명)를 넣고, 마지막에 "코드 하나로만 답하라"고 합니다.
2. 모델이 답할 첫 토큰 자리에서 **각 라벨 코드 토큰의 로짓(점수)만 읽습니다.** 텍스트 생성은 하지 않습니다(`n_predict=1` 또는 그 이하).
3. 라벨 코드들 사이에서 softmax를 취하면 확률 분포가 나옵니다. 라벨이 아닌 토큰은 아예 후보에서 제외되므로 형식 오류는 구조적으로 0입니다.

이 글의 자체 호스팅 측정에는 이 원리를 구현한 **참조 구현**을 사용했습니다. 모델은 Prism ML이 공개한 **Bonsai 2 27B**(Qwen3.8-27B를 3진(ternary) 가중치로 압축한 오픈웨이트 모델, Apache 2.0, GGUF 7.2 GB, [Hugging Face 모델 카드](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf))이고, 추론 엔진은 이 모델 전용 커널이 들어간 [PrismML llama.cpp 포크](https://github.com/PrismML-Eng/llama.cpp)입니다. 27B급 모델이 8 GB 미만이라 **24 GB GPU 한 장(g5.2xlarge, g6.2xlarge)** 에 여유 있게 올라가는 점이 이 조합을 고른 이유입니다. 공개 벤치마크 JevBench([fstandhartinger/jevbench](https://github.com/fstandhartinger/jevbench)) 231문항에서 이 방식은 84.85%(Jev 1.13.0은 86.6%)를 기록했습니다(§4-3).

## 2. AWS에서의 선택지

| 경로 | 오늘 가능한가 | 장점 | 단점 |
|---|---|---|---|
| **A. Amazon Bedrock LLM을 결정기로 사용** (Converse API, "라벨 하나만 답하라") | 예 | 인프라 0, 종량 과금, 최신 모델 | 0.5~1.3초 지연, 형식 위반·thinking 변수(§5), 최신 Anthropic 모델은 서울에서 `global.*` 크로스 리전 프로파일만 제공 |
| **B. 오픈웨이트 결정 모델 자체 호스팅** (EC2 g5/g6 또는 SageMaker, 직접 로짓 분류) | 예 | **~80 ms**, 형식 오류 0, 데이터가 계정·리전 밖으로 나가지 않음, 볼륨이 크면 저렴 | GPU 고정비(≈$36/일), 운영 부담, 정확도가 최신 프론티어보다 1~2pt 낮을 수 있음 |
| C. TypeSafe Jev API를 AWS 워크로드에서 직접 호출 | 얼리 액세스 초대 필요 | 벤더 주장 성능 | AWS 밖 서드파티 API(별도 계약·데이터 처리 검토), Bedrock 미제공 |
| D. Bedrock LLM + [system-one-adapter](https://github.com/typesafe-ai/system-one-adapter-python) | 예 | System One API 형태로 감쌀 수 있음 | 속도·비용은 A와 같음(인터페이스만 흉내) |

현실적인 권장 패턴은 **A + B 하이브리드**입니다. 빠르고 반복적인 결정(분류·라우팅·가드레일·점수화)은 자체 호스팅 결정 모델이 맡고, 문장을 만들어야 하는 일(답변 생성·요약)은 Bedrock LLM이 맡습니다.

```
사용자/시스템 이벤트
        │
        ▼
┌─────────────────────────────┐   ~80 ms, 확률 포함
│ 결정 모델 (EC2 g5.2xlarge)    │──▶ 라우팅 / 가드레일 / 점수 / 분기
│ 직접 로짓 분류, 서울 리전 내 처리 │
└─────────────────────────────┘
        │  "생성이 필요한 경우만"
        ▼
┌─────────────────────────────┐   0.5~1.5 s
│ Amazon Bedrock (Claude 등)    │──▶ 답변·요약·초안 생성
└─────────────────────────────┘
```

**데이터 상주(data residency)** 도 선택에 영향을 줍니다. 2026-09 기준 서울 리전에서 최신 Anthropic 모델(Opus 5.5·Sonnet 5.5)은 `global.*` 크로스 리전 추론 프로파일로만 호출되며, 이 프로파일은 요청을 **한국 밖 리전에서 처리할 수 있습니다**([Bedrock 크로스 리전 추론 문서](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html)). 국내 처리가 요건인 공공·의료 워크로드라면 결정 단계만이라도 자체 호스팅으로 두는 것이 실질적인 해법입니다.

## 3. 무엇을, 어떻게 측정했나

### 3-1. 문제 세트: 7개 태스크 × 12문항 = 84문항

실무에서 흔한 "결정" 모양을 골랐고, 한국어 성능을 보기 위해 세 태스크는 한국어로 그대로 옮겼습니다. 전체 파일은 `tasks.json`(84문항, 정답 포함)으로 공개합니다.

| 태스크 | 라벨 수 | 예시 입력 → 정답 |
|---|---|---|
| sentiment-3 | 3 | "Absolutely love this blender. Crushes ice in seconds…" → `positive` |
| sentiment-ko-3 | 3 | "이 블렌더 정말 마음에 들어요. 얼음이 몇 초 만에 갈리고…" → `positive` |
| support-routing-6 | 6 (billing/shipping/returns/technical/account/other) | "I was charged twice for the same order this morning." → `billing` |
| support-routing-ko-6 | 6 | "오늘 아침에 같은 주문으로 두 번 결제됐어요." → `billing` |
| product-category-20 | 20 | "Stainless Steel 12-Inch Nonstick Frying Pan with Lid" → `kitchen` |
| product-category-ko-20 | 20 | "스테인리스 12인치 논스틱 프라이팬 (뚜껑 포함)" → `kitchen` |
| ui-element-choice-8 | 8 (로그인 페이지 DOM 요소 id) | "Enter the test account's email address." → `ap_email` |

마지막 태스크는 브라우저 테스트 자동화를 흉내 낸 것입니다. 테스트 스텝을 영어 문장으로 주고, 로그인 페이지의 후보 요소 8개(`ap_email`, `ap_password`, `signInSubmit`, `rememberMe` …) 중 하나를 고르게 합니다. 에이전트가 화면을 조작할 때 매 스텝 내리는 결정과 같은 모양입니다.

### 3-2. 측정 방법

- **같은 인스턴스에서 양쪽을 호출**했습니다. 결정 모델은 로컬 프로세스, Bedrock은 같은 호스트에서 서울 엔드포인트로. 지연은 호출 측 왕복 시간(클라이언트 ms)이며, Bedrock은 응답의 `metrics.latencyMs`(서버 보고)도 함께 기록했습니다.
- 84문항을 **2패스**(168 요청/시스템) 돌려 p50/p90/p99와 정답률을 냈고, 동시성 4로 처리량도 재봤습니다.
- 결정 모델은 두 모드로 측정했습니다. **uncached**는 매 요청의 프롬프트 전체를 계산하고, **warm cache**는 "지시문+라벨 표" 접두부를 태스크별로 캐시해 문항 텍스트만 새로 계산합니다(운영 시의 정상 상태).
- Bedrock 쪽 프롬프트는 시스템 메시지("라벨 id 하나만 답하라") + 지시문 + 입력 + 라벨 목록이고, 처음에는 `maxTokens 16`(라벨 하나면 충분한 예산)으로 시작했습니다. 이 선택이 §5의 발견으로 이어집니다.
- 채점은 응답을 정규화해 라벨 id와 정확히 일치하면 정답, 라벨이 아닌 문장이 오면 그 안에 포함된 라벨을 뽑는 폴백을 적용한 뒤 정답 여부를 판정했습니다. 빈 응답은 오답입니다.

### 3-3. 인프라: 사람이 붙어 있지 않아도 끝나는 실험

GPU 인스턴스는 켜 두는 것만으로 돈이 나가므로, **자체 종료하는 무인 실행**으로 설계했습니다(전체 템플릿은 §7과 부록).

- `storage` 스택(유지, ≈$0): 결과 버킷(암호화·퍼블릭 차단·180일 만료) + 인스턴스 역할(버킷 입력 읽기·결과 쓰기·`bedrock:InvokeModel`·SSM만).
- `compute` 스택(실험 때만): 인스턴스 1대 + 아웃바운드 전용 보안 그룹(인바운드 0, 접속은 SSM Session Manager) + "CPU 유휴 1시간이면 종료" CloudWatch 알람. user-data가 S3에서 부트스트랩 스크립트를 받아 실행하고, 결과를 S3에 올린 뒤 `shutdown -h now` → `InstanceInitiatedShutdownBehavior: terminate`로 인스턴스가 스스로 사라집니다. 스택 삭제 한 줄이면 모든 과금이 멈춥니다.
- GPU 레그는 Deep Learning AMI(Ubuntu 24.04, NVIDIA 드라이버·CUDA 포함) g5.2xlarge, Bedrock 전용 레그는 Amazon Linux 2023 t3.small(GPU 불필요, ≈$0.03/h)로 분리했습니다.

한 번의 GPU 실행은 28분(설치·컴파일 12분, 모델 다운로드 포함 / A/B 11분 / JevBench 3분 / 배치 1분), 실비 ≈$1.4였습니다.

## 4. 결과: 서울 리전, g5.2xlarge(A10G) vs Claude Opus 5.5 / Sonnet 5.5

168 요청/시스템, 2026-09-29 07:48~08:18 KST. Bedrock 두 모델은 서울 엔드포인트의 `global.anthropic.claude-opus-5-5`, `global.anthropic.claude-sonnet-5-5`(당시 서울에서 보이는 최신 Opus·Sonnet)이고, `maxTokens 16`(§5에서 재측정).

| | 결정 모델 warm cache | 결정 모델 uncached | Bedrock Opus 5.5 | Bedrock Sonnet 5.5 |
|---|---|---|---|---|
| p50 | **79 ms** | 258 ms | 1,297 ms | 659 ms |
| p90 | 87 ms | 483 ms | 1,887 ms | 1,092 ms |
| p99 | 94 ms | 487 ms | 2,716 ms | 1,227 ms |
| 서버 보고 p50 | – | – | 1,286 ms | 645 ms |
| 정답률 | **98.8%** | 98.8% | 91.7% | 97.6% |
| 동시성 4 처리량 | (단일 스레드 서버) | | 2.78 items/s | 5.48 items/s |
| 1K 결정당 비용(§6) | ≈$0.033 | ≈$0.11 | ≈$1.62 | ≈$0.81 |

- warm cache 기준 결정 모델은 Sonnet 5.5보다 **8.3배**, Opus 5.5보다 **16.4배** 빠릅니다. 정답률은 Sonnet 5.5와 사실상 같고(84문항 중 1건 차이), Opus 5.5가 뒤지는 이유는 모델의 분류 능력이 아니라 §5-3의 거절입니다.
- 클라이언트 왕복과 서버 보고 지연의 차이는 **11~14 ms**입니다. 서울 엔드포인트까지의 네트워크 비용은 미미하고, 지연의 본체는 크로스 리전 라우팅과 추론 자체입니다.
- **한국어**: 세 한국어 태스크의 정답률은 영어와 같았고, 결정 모델의 지연은 +1~5%(토큰 수가 조금 늘어난 만큼)에 그쳤습니다. Bedrock은 차이가 없었습니다.

### 4-1. 태스크별 정답률 / p50 (ms)

| 태스크 | 결정 모델 warm | 결정 모델 uncached | Opus 5.5 | Sonnet 5.5 |
|---|---|---|---|---|
| product-category-20 | 100% / 83 | 100% / 436 | 100% / 1,245 | 100% / 651 |
| product-category-ko-20 | 100% / 87 | 100% / 487 | 100% / 1,262 | 100% / 619 |
| sentiment-3 | 100% / 78 | 100% / 206 | 100% / 1,254 | 100% / 672 |
| sentiment-ko-3 | 100% / 82 | 100% / 213 | 100% / 1,271 | 100% / 654 |
| support-routing-6 | 100% / 77 | 100% / 254 | 92% / 1,294 | 92% / 647 |
| support-routing-ko-6 | 92% / 78 | 92% / 258 | 92% / 1,438 | 92% / 647 |
| ui-element-choice-8 | 100% / 79 | 100% / 355 | **58%** / 1,861 | 100% / 1,127 |

support-routing에서 모든 시스템이 공통으로 틀린 문항이 하나 있습니다. "오늘 배송기사님이 정말 친절하셨다고 꼭 전하고 싶었어요"(정답 `other`, 칭찬)를 `shipping`으로 분류합니다. 이후 실험(§5)에서 Claude 5.5의 thinking을 켜도, effort를 바꿔도 이 문항은 계속 틀렸습니다. 모델 문제가 아니라 **라벨 정의 문제**입니다. `other` 설명에 "칭찬·감사 등 처리 불필요 메시지"를 명시하면 해결될 성격이고, 결정 모델을 도입할 때 라벨 설명을 다듬는 일이 프롬프트 엔지니어링의 대부분을 차지한다는 좋은 예입니다.

### 4-2. 참고: 1차 실험(us-east-1, g6.2xlarge L4, 이전 세대 Claude)

같은 84문항을 하루 전 us-east-1에서 돌린 결과입니다. 이때는 g5 용량이 없어 **g6.2xlarge(NVIDIA L4 24 GB, $0.98/h)** 를 썼습니다.

| | 결정 모델 warm | 결정 모델 uncached | Haiku 4.5 | Sonnet 4.5 | Sonnet 5 |
|---|---|---|---|---|---|
| p50 | 97 ms | 354 ms | 558 ms | 1,338 ms | 1,604 ms |
| p99 | 112 ms | 671 ms | 690 ms | 2,677 ms | 3,071 ms |
| 정답률 | 98.8% | 98.8% | 99.4% | 98.8% | 98.8% |
| 1K 결정당 | ≈$0.026 | ≈$0.12 | ≈$0.33 | ≈$0.98 | (요금 미확인) |

두 가지를 배웠습니다. 첫째, **GPU 세대가 지연을 바꿉니다.** 같은 모델이 A10G(메모리 대역폭 600 GB/s)에서는 79 ms, L4(300 GB/s)에서는 97 ms로, 저비트 모델의 추론은 메모리 대역폭에 묶여 있습니다. 정확도는 GPU와 무관합니다. 둘째, Haiku 4.5는 이 문제 세트에서 정답률·가격 모두 매력적입니다(Sonnet 5.5의 40% 가격). 볼륨이 작다면 결정기로 Haiku급 모델을 먼저 검토할 가치가 있습니다.

### 4-3. 공개 벤치마크 JevBench 231문항

문제 세트가 우리가 만든 것이라 "쉬운 문제만 고른 것 아니냐"는 의심이 들 수 있습니다. 그래서 공개 벤치마크 [JevBench](https://github.com/fstandhartinger/jevbench)의 public split 231문항(easy 48·standard 72·hard 111; 선택·예/아니오·점수 세 유형)을 같은 A10G 호스트에서 돌렸습니다.

| 지표 | 결정 모델(Bonsai 2 27B, 직접 로짓) | 비교 |
|---|---|---|
| 정답률 | **84.85% (196/231)** | Jev 1.13.0(호스팅) 86.6% — JevBench 공개 결과 기준 |
| ECE(캘리브레이션 오차) / Brier | 0.026 / 0.227 | 낮을수록 좋음. 확률이 "말한 만큼 맞는다"는 뜻 |
| 스키마 유효성 | 100% (231/231) | 구조적으로 보장 |
| 지연 p50 / p95 | 217 ms / 2.62 s | 긴 정책 문서·다단계 추론 문항이 p95를 끌어올림 |

유형별로는 extraction·intent·routing·tool_selection·ordinal·fact가 100%, ambiguous 71%, long_policy 68%, **temporal_numeric 20%**(날짜·수치 계산)가 최약점입니다. 즉 이 방식은 "읽고 고르는" 문제에 강하고, 계산이나 여러 단계 추론이 필요한 문제에는 LLM을 쓰는 것이 맞습니다.

## 5. Claude 5.5 세대를 "결정기"로 쓸 때 반드시 알아야 할 것

1차 실험(Sonnet 5/4.5, Haiku 4.5)에는 없던 현상이 5.5 세대에서 나타났고, 원인을 찾기 위해 두 번의 추가 실험을 했습니다. 결론부터 말하면 **`maxTokens`를 올리고 `effort=low`를 주면 해결**됩니다.

### 5-1. adaptive thinking이 짧은 출력 예산을 삼킨다

5.5 세대는 adaptive thinking이 기본으로 켜져 있어, 모델이 스스로 "생각이 필요하다"고 판단한 입력에서 추론 블록(`reasoningContent`)을 먼저 씁니다. 결정기 용도로 `maxTokens 16`을 주면 애매한 입력에서 16토큰을 모두 추론에 써 버리고 **텍스트가 비어 있는 채로 `max_tokens` 종료**가 됩니다. 이번 세트에서는 "친절한 기사님" 문항(영·한)이 정확히 그 경우였습니다.

그래서 `maxTokens`를 16과 512로 같은 호스트에서 연속 측정했습니다(Sonnet 5.5, 168 요청씩).

| maxTokens | p50 | p99 | max | 정답률 | 빈 응답 | thinking 발동 | 라벨 외 응답 | 1K 결정당 |
|---|---|---|---|---|---|---|---|---|
| 16 | 679 ms | 1,267 | 2,294 | 97.6% | 3 | 3 (1.8%) | 4 | $0.81 |
| 512 | 585 ms | **2,208** | **4,012** | 98.2% | 0 | 3 (1.8%) | 1 | $0.87 (+7%) |

예산을 늘리면 빈 응답은 사라지지만 **정답은 1건만 늘고, p99가 1.3초에서 2.2초로 나빠집니다.** thinking이 발동하는 문항은 예산과 무관하게 같았습니다. 예산은 "빨리 실패(빈 응답)"와 "느리게 답함(3~4초)" 중 하나를 고르는 것뿐입니다. 결정 API에 지연 SLO가 있다면 thinking 문항이 그대로 SLO 위반이 됩니다.

### 5-2. `effort=low`가 해법이다

Anthropic의 effort 파라미터는 Bedrock Converse에서 `additionalModelRequestFields`의 `output_config.effort`로 전달합니다([Bedrock adaptive thinking 문서](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html), [Anthropic effort 문서](https://platform.claude.com/docs/en/build-with-claude/effort)). `maxTokens 512`를 고정하고 네 가지 설정을 같은 호스트에서 연속 측정했습니다(Sonnet 5.5, 168 요청씩).

| 설정 | p50 | p99 | max | 정답률 | thinking 발동 | 라벨 외 응답 | 1K 결정당 |
|---|---|---|---|---|---|---|---|
| 기본(= `high`) | 667 ms | **2,448** | **3,908** | 98.8% | 4 (2.4%) | 0 | $0.868 |
| `effort: medium` | 582 | 1,207 | 2,710 | 98.2% | 0 | 2 | $0.817 |
| **`effort: low`** | 568 | **1,166** | **1,641** | **98.8%** | **0** | 1 | **$0.812** |
| `effort: low` + `thinking: between_tools` | 753 | 1,214 | 2,102 | 97.6% | 0 | 0 | $0.805 |

- `low`는 thinking을 **0건**으로 만들면서 정답률을 잃지 않았습니다(98.8% = 기본값 = 자체 호스팅 결정 모델). p99는 절반(2.4→1.2초), max는 3.9→1.6초. 기본 설정의 thinking 4건은 "2~4초를 써서 같은 답을 내는" 비용이었습니다.
- `medium`은 어정쩡합니다. thinking 블록 대신 **본문에 사고 과정을 산문으로** 쓰는 응답이 나와(2건, 1.2~2.7초) 파서에 폴백이 필요했습니다. `low`에서도 1건 남았습니다.
- `thinking: between_tools`(Sonnet 5.5의 최저 thinking 설정)는 형식 위반이 0이지만 **모든 호출이 균일하게 +185 ms** 느려지고 정답률도 떨어져 권하지 않습니다.
- p50의 667→568 ms 차이는 대부분 측정 시간대 효과입니다(첫 설정 구간이 늘 조금 느렸고, 즉답의 출력 토큰 분포는 네 설정에서 동일). 확정적인 효과는 **꼬리 지연(p99·max)과 비용 변동성의 소거**입니다.

권장 설정을 코드로 쓰면 이렇습니다(boto3).

```python
response = client.converse(
    modelId="global.anthropic.claude-sonnet-5-5",
    system=[{"text": "You are a text classifier. ... Reply with exactly one label id and nothing else."}],
    messages=[{"role": "user", "content": [{"text": prompt}]}],
    inferenceConfig={"maxTokens": 512},                       # 16처럼 짧게 두면 thinking이 예산을 삼킨다
    additionalModelRequestFields={"output_config": {"effort": "low"}},  # thinking을 끈다
)
content = response["output"]["message"]["content"]
text = "".join(p.get("text", "") for p in content).strip()  # reasoningContent 블록은 text가 없다
if response["stopReason"] != "end_turn" or text.lower() not in label_ids:
    ...  # 폴백: 재시도, 다른 모델, 또는 사람 검토 큐
```

### 5-3. Opus 5.5의 안전 분류기와 UI 요소 선택

Opus 5.5는 로그인 페이지 요소 선택 태스크 12문항 중 **5문항을 거절**했습니다(`stopReason=content_filtered`, 빈 content). `maxTokens`를 256으로 올려도 같았으니 토큰 문제가 아닙니다. AWS 블로그가 안내한 대로 Opus 5.5는 사이버 보안 등 민감 영역의 안전 분류기를 탑재한 첫 Opus이고, "이메일 입력란을 찾아 채워라"류의 로그인 폼 자동화가 자격 증명 탈취 패턴으로 분류된 것으로 보입니다. Sonnet 5.5와 자체 호스팅 결정 모델은 같은 문항에서 100%였습니다. **UI 자동화·에이전트 브라우징의 요소 선택에는 Opus 5.5를 쓰지 않는 것이 안전**하고, 어떤 모델이든 `content_filtered`를 처리하는 분기가 필요합니다.

### 5-4. 형식 위반은 0이 아니다

"라벨 id 하나만 답하라"는 시스템 프롬프트에도 Claude는 168건 중 1~4건에서 설명문을 붙이거나 빈 응답을 냈습니다. 직접 로짓 방식의 결정 모델은 라벨 토큰만 읽으므로 이 문제가 구조적으로 없습니다(JevBench 231건 스키마 유효성 100%). LLM을 결정기로 쓸 때는 (a) 정규화·부분 일치 폴백, (b) `stopReason` 확인, (c) 실패 시 재시도 또는 사람 검토 큐를 처음부터 설계에 넣어야 합니다.

## 6. 비용: 고정비 vs 종량

두 방식은 과금 구조가 다릅니다. 자체 호스팅은 **켜 둔 시간**에, Bedrock은 **처리한 토큰**에 과금됩니다. 그래서 "1K 결정당 비용"은 자체 호스팅의 경우 가동률 가정이 필요합니다.

| 시스템 | 산식 | 1K 결정당 |
|---|---|---|
| 결정 모델 g5.2xlarge 서울, warm cache | $1.4903/h ÷ (1,000/79 ms × 3,600 ≈ 45.6K/h), GPU 100% 가동 가정 | **≈$0.033** |
| 결정 모델 g5.2xlarge, uncached | $1.4903/h ÷ (≈14K/h) | ≈$0.11 |
| Sonnet 5.5 (`effort=low`) | 380 입력 토큰 × $2/MTok + 5 출력 × $10/MTok | ≈$0.81 |
| Sonnet 5.5 (기본, thinking 포함) | 위 + thinking 발동분 | ≈$0.87 (thinking 문항 비율 1%당 +$0.03) |
| Opus 5.5 | 380 × $4 + 출력 | ≈$1.62 |

- **손익분기**: 자체 호스팅 고정비 $1.4903 × 24 ≈ **$35.8/일**. Sonnet 5.5(`low`) $0.81/1K 기준 하루 **≈4.4만 결정**, Opus 5.5 기준 ≈2.2만 결정, 1차의 Haiku 4.5($0.33/1K) 기준이면 ≈10.8만 결정을 넘어야 자체 호스팅이 싸집니다.
- 볼륨이 적으면 Bedrock이 싸고 운영도 없습니다. 볼륨이 크거나, **≤100 ms 응답**이 필요하거나(Sonnet 5.5 최적 설정도 p50 570 ms·p99 1.2초), **국내 데이터 처리 요건**이 있으면 자체 호스팅이 답입니다.
- 자체 호스팅 비용은 더 내려갈 여지가 있습니다. 측정에 쓴 참조 구현의 HTTP 서버는 단일 스레드이고 배치 크기 4에서 처리량 이득이 +11%에 그쳤습니다. 배치·동시성을 제대로 살리는 서빙(예: 여러 워커, 연속 배칭)이면 1K당 비용은 더 낮아지고, Savings Plan을 적용하면 고정비도 줄어듭니다. 반대로 GPU 가동률이 30%라면 1K당 비용은 3배가 됩니다.
- Bedrock 요금은 이 글 작성 시점의 Anthropic 공개 요금을 가정했습니다. 실제 계산은 [Amazon Bedrock 요금 페이지](https://aws.amazon.com/bedrock/pricing/)의 리전·크로스 리전 요금으로 다시 하시기 바랍니다.
- 이번 실험 전체의 실비는 다섯 번의 실행(GPU 2회, CPU 3회)을 합쳐 **≈$4.5**였습니다. 무인 종료 설계 덕에 잊고 켜 둔 인스턴스는 없었습니다.

## 7. 재현 절차

전체 파일: `storage.yaml`, `compute.yaml`, `bootstrap_bedrock.sh`, `bedrock_decision_bench.py`, `self_hosted_decision_client.py`, `tasks.json`(부록 A~C). 아래 명령의 `<...>` 자리만 채우면 됩니다.

### 7-1. 준비물

- AWS 계정, 리전 `ap-northeast-2`, AWS CLI v2, 기본 VPC(퍼블릭 서브넷 + 인터넷 게이트웨이. 인바운드는 열지 않으므로 퍼블릭 IP는 아웃바운드 용도).
- Bedrock 콘솔에서 사용할 Anthropic 모델 접근 활성화. 서울에서 Opus 5.5·Sonnet 5.5는 `global.anthropic.claude-*-5-5` 프로파일 ID를 씁니다.
- GPU 레그: EC2 "Running On-Demand G and VT instances" vCPU 쿼터 ≥ 8. 쿼터가 있어도 특정 AZ에 용량이 없을 수 있으니(`InsufficientInstanceCapacity`) `SubnetId`를 비워 EC2가 AZ를 고르게 하고, 그래도 없으면 `g6.2xlarge`(L4)로 바꿉니다. 정확도는 같고 지연만 20~25% 늘어납니다.

### 7-2. storage 스택 (한 번만, ≈$0)

```bash
REGION=ap-northeast-2
BUCKET=decision-bench-<account-id>-$REGION
aws cloudformation deploy --region $REGION --stack-name decision-bench-storage \
  --template-file storage.yaml --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides BucketName=$BUCKET RoleName=decision-bench-instance-apne2
```

버킷(퍼블릭 차단·SSE-S3·TLS 강제·180일 만료)과 인스턴스 역할(버킷 `input/*` 읽기, `runs/*` 쓰기, `bedrock:InvokeModel`, SSM)이 만들어집니다. **역할 이름은 리전별로 다르게** 두세요. IAM은 글로벌이라 다른 리전의 역할을 넘겨도 EC2는 받아 주지만, 호스트가 S3에서 `AccessDenied`를 받고 로그 한 줄 없이 종료됩니다(저희가 두 번 겪었습니다).

### 7-3. Bedrock 레그 (t3.small, ≈6~11분, ≈$0.5)

```bash
aws s3 cp tasks.json               s3://$BUCKET/input/tasks.json
aws s3 cp bedrock_decision_bench.py s3://$BUCKET/input/bedrock_decision_bench.py
aws s3 cp bootstrap_bedrock.sh     s3://$BUCKET/input/bootstrap_bedrock.sh
cat > run.env <<EOF
BUCKET=$BUCKET
RUN_ID=$(date -u +%Y%m%d-%H%M)
REGION=$REGION
MODEL=global.anthropic.claude-sonnet-5-5
MAX_TOKENS=512
EFFORTS="default low"
PASSES=2
EOF
aws s3 cp run.env s3://$BUCKET/input/run.env

VPC=$(aws ec2 describe-vpcs --region $REGION --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
aws cloudformation create-stack --region $REGION --stack-name decision-bench-compute-bedrock \
  --template-body file://compute.yaml --parameters \
  ParameterKey=BucketName,ParameterValue=$BUCKET ParameterKey=RunId,ParameterValue=$(grep RUN_ID run.env | cut -d= -f2) \
  ParameterKey=InstanceProfileName,ParameterValue=decision-bench-instance-apne2 ParameterKey=VpcId,ParameterValue=$VPC \
  ParameterKey=InstanceType,ParameterValue=t3.small ParameterKey=RootVolumeGiB,ParameterValue=8 \
  ParameterKey=AmiId,ParameterValue=/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  ParameterKey=RootDeviceName,ParameterValue=/dev/xvda ParameterKey=BootstrapKey,ParameterValue=input/bootstrap_bedrock.sh \
  ParameterKey=MaxRunHours,ParameterValue=1
```

호스트가 boto3를 설치하고, 모델 프로브(한 단어 응답) 후 `EFFORTS`의 각 설정으로 `bedrock_decision_bench.py`를 돌려 결과 JSON을 `s3://$BUCKET/runs/<RUN_ID>/results/`에 올리고 `DONE` 마커를 쓴 뒤 스스로 종료합니다. 진행 상황은 60초마다 갱신되는 `runs/<RUN_ID>/bootstrap.log`로 봅니다. 끝나면 `aws cloudformation delete-stack --stack-name decision-bench-compute-bedrock`으로 보안 그룹·알람을 정리합니다.

노트북에서 바로 돌려 보고 싶다면 인스턴스 없이도 됩니다. 단, 노트북→서울 엔드포인트의 네트워크 지연이 더해지므로 절대 지연은 이 글보다 커집니다.

```bash
python3 -m venv .venv && .venv/bin/pip install -q boto3
.venv/bin/python bedrock_decision_bench.py --tasks tasks.json --region ap-northeast-2 \
  --model global.anthropic.claude-sonnet-5-5 --max-tokens 512 --effort low --passes 2
```

### 7-4. 자체 호스팅 레그 (g5.2xlarge, ≈30분, ≈$1.5) — 공개 도구 버전

이 글의 자체 호스팅 수치는 참조 구현으로 측정한 것이지만, 원리는 아래 공개 도구 조합으로 그대로 재현할 수 있습니다. **아래 절차는 문서·모델 카드 기준으로 정리한 참고 절차이며, 부록 C의 클라이언트는 원리 설명용 코드입니다**(게시 전 검토 메모 참조).

1. `compute.yaml`을 기본값(DLAMI Ubuntu 24.04, `g5.2xlarge`, 150 GiB gp3, `/dev/sda1`)으로 생성합니다. DLAMI에는 NVIDIA 드라이버와 CUDA가 들어 있고, 인스턴스 스토어 NVMe가 `/opt/dlami/nvme`에 마운트되어 있습니다. **모델 파일은 NVMe에 두세요**(EBS에서 로드하면 수 분, NVMe면 수 초).
2. 부트스트랩에서 PrismML llama.cpp 포크를 빌드하고 모델을 받습니다. 모델 카드가 강조하듯 **스톡 llama.cpp는 이 GGUF(`PQ2_0`/`PTQ1_0`)를 읽지 못합니다.**

   ```bash
   apt-get install -y cmake build-essential python3-pip && pip install -q "huggingface_hub[cli]"
   cd /opt/dlami/nvme
   git clone https://github.com/PrismML-Eng/llama.cpp && cd llama.cpp
   cmake -B build -DGGML_CUDA=ON && cmake --build build -j --target llama-server
   hf download prism-ml/Ternary-Bonsai-2-27B-gguf Ternary-Bonsai-2-27B-PQ2_0.gguf --local-dir /opt/dlami/nvme/models
   ./build/bin/llama-server -m /opt/dlami/nvme/models/Ternary-Bonsai-2-27B-PQ2_0.gguf \
       -ngl 99 -fa on -c 8192 --host 127.0.0.1 --port 8080 &
   ```

   (A10G에서 CUDA 빌드는 약 10분입니다. 프로덕션이라면 빌드·모델을 넣은 AMI를 미리 굽거나 컨테이너 이미지로 만들어 두세요. 첫 부팅은 EBS 지연 로딩 때문에 늘 느리다는 점도 기억해 두면 좋습니다.)
3. `self_hosted_decision_client.py`로 호출합니다. 핵심은 세 가지입니다. 라벨마다 단일 토큰 코드(`A`,`B`,…)를 붙인 표를 프롬프트에 넣고, thinking 모델이므로 `<think>\n\n</think>`를 비워 미리 채워 답 토큰이 바로 나오게 하고, `n_predict=1, n_probs=N`으로 **첫 토큰의 후보 확률만** 받아 라벨 코드 사이에서 정규화합니다. `cache_prompt: true`를 주면 "지시문+라벨 표" 접두부가 서버에 캐시되어 warm cache 동작이 됩니다.
4. 결정 API를 실제로 노출할 때는 이 서버를 그대로 열지 마세요. `127.0.0.1`에 묶고, 앞단에 인증·요청 검증·라벨 수 상한·타임아웃을 두는 얇은 API 계층(예: 같은 호스트의 FastAPI + ALB/API Gateway, 또는 SageMaker 실시간 엔드포인트로 패키징)을 두는 것이 정석입니다.

### 7-5. 정리와 비용 안전장치

- 인스턴스는 부트스트랩 종료 시 스스로 꺼지고(`InstanceInitiatedShutdownBehavior: terminate`), 그래도 살아 있으면 CPU 3% 미만 1시간에 CloudWatch 알람이 종료시킵니다. 알람은 `TreatMissingData: notBreaching`이어야 합니다. `breaching`으로 두면 부팅 직후 데이터가 없는 구간에 알람이 울려 인스턴스가 몇 분 만에 사라집니다.
- 디버깅이 필요하면 `s3://$BUCKET/runs/<RUN_ID>/KEEP_ALIVE` 빈 객체를 미리 두면 호스트가 종료하지 않고, `aws ssm start-session --target <instance-id>`로 들어갈 수 있습니다(인바운드 포트 없음).
- 실험이 끝나면 compute 스택을 지우고, `Project` 태그로 Cost Explorer를 24~48시간 뒤에 확인하세요(당일 조회는 태그 전파 지연으로 $0으로 보일 수 있습니다).

## 8. 어디에 쓰면 좋은가

결정 모델이 잘 맞는 자리는 한 문장으로 요약됩니다. **"코드 속에 있는, 사람이 규칙으로 쓰기엔 애매하고 LLM을 부르기엔 너무 잦은 판단."** TypeSafe는 이를 "스마트 if문(smart if-statements)"이라고 부릅니다. 공개 자료와 이번 실험을 바탕으로, 공공·교육·연구 기관에서 바로 떠올릴 수 있는 자리를 정리했습니다.

| 영역 | 구체적인 결정 | 왜 결정 모델인가 | 이번 실험의 근거 |
|---|---|---|---|
| **민원·상담 라우팅** | 접수 문의를 담당 부서/팀(수십 개)으로 배정, 긴급도 판정 | 건당 80 ms·$0.03/1K이면 접수 즉시 배정 가능, 확률이 낮으면 사람 검토 큐로 | support-routing 6라벨·상품 카테고리 20라벨 100%, 한국어 동일 |
| **문서·기록물 분류** | 공문·보고서·회의록의 분류 체계 배정, 비공개 정보 포함 여부(`Noul`) | 대량(수십만 건) 일괄 처리에 종량 LLM보다 30배 저렴 | 20라벨 분류 100%, JevBench extraction·intent 100% |
| **에이전트 워크플로의 분기** | 다음 도구 선택, 재시도/종료 판단, 사용자 의도 재확인 필요 여부 | 에이전트는 한 요청에 결정을 수십 번 내림. 결정마다 1초씩 쓰면 체감 속도가 무너짐 | JevBench routing·tool_selection 100%; 오픈소스 에이전트 SDK에서 결정 모델 인터페이스 논의 진행 중([Strands harness-sdk PR #4558](https://github.com/strands-agents/harness-sdk/pull/4558)) |
| **가드레일·검증** | 입력의 정책 위반 여부, 프롬프트 인젝션 의심, LLM 답변이 근거 문서와 일치하는지(judge) | LLM 응답마다 검증기를 한 번 더 부르는 비용을 1/30로. 확률 출력으로 임계값 조정 가능 | JevBench judge·policy 82~92%(캘리브레이션 ECE 0.026) |
| **LLM 모델 라우팅** | 질의 난이도에 따라 소형/대형 모델 선택 | 쉬운 질의를 Haiku급으로 보내 비용 절감. LiteLLM 등이 결정 모델 기반 자동 라우팅을 제공 | – (가격 표 §6) |
| **대량 데이터 큐레이션(map-reduce)** | 연구 데이터셋 라벨링, 논문/문헌 1차 스크리닝, 로그 분류, 설문 자유응답 코딩 | 1K당 $0.03이면 100만 건이 $30. 확률로 "확실한 것만 자동, 나머지 검토" | product-category-20 100%, JevBench fact·ordinal 100% |
| **실시간 UX** | 검색 의도 판별, 폼 입력 검증, 게임/인터랙티브 콘텐츠의 상태 판단 | 100 ms 이하라 사용자가 기다리지 않음 | warm cache p50 79 ms, p99 94 ms |
| **UI 테스트 자동화** | 테스트 스텝 문장 → 화면 요소 선택 | 스텝마다 결정, 실패 시 재시도. 모델 거절(§5-3) 위험이 없음 | ui-element-choice 100% (Opus 5.5 58%) |
| **교육** | 학생 질문의 유형 분류(행정/학사/기술), 루브릭 기반 채점 보조(`Score`), 표절·정책 위반 1차 판정 | 학기 초 폭증하는 문의를 즉시 분류, 채점은 확률과 함께 교수자 검토로 | sentiment/routing 100%; JevBench score 유형 83% |
| **의료·바이오 연구** | 임상 노트/유전체 보고서의 트리아지 분류, 변이 해석 문헌 스크리닝, 데이터 국내 처리 | 개인정보·국내 처리 요건 → 자체 호스팅이 필수 | 데이터 상주 §2 |

**맞지 않는 자리**도 분명합니다. 문장을 만들어야 하는 일(답변·요약·번역), 계산이나 여러 단계 추론이 필요한 판단(JevBench temporal_numeric 20%), 이미지 입력, 선택지가 수백 개를 넘는 문제(Jev는 255개, 직접 로짓은 토크나이저의 단일 토큰 코드 수에 묶임), 수만 토큰을 넘는 컨텍스트. 이런 일은 Bedrock LLM에 맡기고, 결정 모델은 그 앞뒤에서 "이 요청을 LLM에 보낼 것인가", "LLM의 답을 내보낼 것인가"를 결정하는 자리에 두는 것이 하이브리드의 요지입니다.

**자체 호스팅 vs Bedrock을 고르는 기준**

| 조건 | 권장 |
|---|---|
| 하루 결정 수 < 2~4만, 지연 1초 허용, 데이터 국외 처리 허용 | Bedrock (Sonnet 5.5 `effort=low` 또는 Haiku급), 인프라 0 |
| 하루 결정 수 > 4만, 또는 GPU를 다른 워크로드와 공유 | 자체 호스팅 (g5.2xlarge, Savings Plan) |
| ≤100 ms 응답, 형식 오류 0, 확률 출력 필요 | 자체 호스팅 결정 모델 |
| 국내 데이터 처리 요건, 폐쇄망 | 자체 호스팅 (서울 리전, 인바운드 0 설계) |
| 이미지·생성·긴 추론 | Bedrock LLM |

## 9. 한계와 다음 단계

- 문제 세트는 84문항으로 작고 저희가 만든 것입니다. 공개 벤치마크(JevBench 231)로 보완했지만, 여러분의 데이터로 §7의 스크립트를 돌려 보는 것이 가장 확실합니다. `tasks.json`의 형식만 맞추면 됩니다.
- Bedrock 지연은 측정 시간대에 따라 ±15% 변동했습니다(같은 설정의 p50이 659→679→667 ms). 설정 간 비교는 같은 호스트·같은 시간 창에서 연속 측정한 값만 신뢰하고, 절대값은 참고로 보세요.
- 참조 구현의 HTTP 서버는 단일 스레드라 처리량 수치는 "최소치"입니다. 여러 워커나 연속 배칭이면 1K당 비용은 더 내려갑니다.
- Jev 자체는 측정하지 않았습니다(얼리 액세스). Jev의 수치는 모두 벤더와 공개 벤치마크의 것입니다.
- Claude 5.5의 thinking·거절 동작은 이 글 작성 시점(2026-09)의 관찰이며 모델 업데이트로 바뀔 수 있습니다. 설정(`maxTokens`, `effort`)을 코드에 명시하고 `stopReason`을 항상 확인하는 습관이 모델 변화에 대한 보험입니다.
- 다음으로 해 볼 만한 것: 국내 민원 분류 체계로 만든 한국어 벤치마크, SageMaker 실시간 엔드포인트로 패키징한 결정 모델(오토스케일링·인증 포함), Haiku 4.5 + `effort` 조합, 설정을 문항 단위로 교차(interleave)해 시간대 효과를 완전히 분리한 재측정.

## 10. 참고 자료

- TypeSafe AI, [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) (2026-09-15) · [문서](https://docs.typesafe.ai/) · [system-one-adapter-python](https://github.com/typesafe-ai/system-one-adapter-python)
- Prism ML, [Ternary-Bonsai-2-27B-gguf 모델 카드](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf) (Apache 2.0) · [Bonsai-demo](https://github.com/PrismML-Eng/Bonsai-demo) · [llama.cpp 포크](https://github.com/PrismML-Eng/llama.cpp)
- [JevBench](https://github.com/fstandhartinger/jevbench) — Jev급 결정 모델 공개 벤치마크
- Amazon Bedrock: [Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) · [Claude adaptive thinking](https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html) · [크로스 리전 추론](https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html) · [요금](https://aws.amazon.com/bedrock/pricing/)
- Anthropic, [Effort](https://platform.claude.com/docs/en/build-with-claude/effort) · [Claude in Amazon Bedrock](https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock)
- AWS, [Deep Learning AMI](https://docs.aws.amazon.com/dlami/) · [EC2 G5 인스턴스](https://aws.amazon.com/ec2/instance-types/g5/) · [Strands Agents harness-sdk PR #4558 (DecisionModel 설계)](https://github.com/strands-agents/harness-sdk/pull/4558)

---

## 부록 A. `storage.yaml`

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: Decision-model benchmark -- durable side (results bucket + instance role). Cheap to keep.
Parameters:
  BucketName: {Type: String}
  RoleName:   {Type: String, Description: "IAM is global: use a distinct name per regional stack"}
Resources:
  ResultsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Ref BucketName
      PublicAccessBlockConfiguration: {BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true}
      OwnershipControls: {Rules: [{ObjectOwnership: BucketOwnerEnforced}]}
      BucketEncryption: {ServerSideEncryptionConfiguration: [{ServerSideEncryptionByDefault: {SSEAlgorithm: AES256}}]}
      LifecycleConfiguration: {Rules: [{Id: expire-after-180-days, Status: Enabled, ExpirationInDays: 180}]}
  ResultsBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref ResultsBucket
      PolicyDocument:
        Version: "2012-10-17"
        Statement:
          - {Sid: DenyInsecureTransport, Effect: Deny, Principal: "*", Action: "s3:*",
             Resource: [!GetAtt ResultsBucket.Arn, !Sub "${ResultsBucket.Arn}/*"],
             Condition: {Bool: {"aws:SecureTransport": "false"}}}
  InstanceRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Ref RoleName
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement: [{Effect: Allow, Principal: {Service: ec2.amazonaws.com}, Action: sts:AssumeRole}]
      ManagedPolicyArns: [arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore]
      Policies:
        - PolicyName: decision-bench
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - {Sid: ReadInputs,   Effect: Allow, Action: [s3:GetObject],               Resource: !Sub "${ResultsBucket.Arn}/input/*"}
              - {Sid: WriteResults, Effect: Allow, Action: [s3:PutObject, s3:GetObject], Resource: !Sub "${ResultsBucket.Arn}/runs/*"}
              - {Sid: ListBucket,   Effect: Allow, Action: [s3:ListBucket],              Resource: !GetAtt ResultsBucket.Arn}
              - {Sid: Bedrock,      Effect: Allow, Action: [bedrock:InvokeModel],        Resource: "*"}
  InstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties: {InstanceProfileName: !Ref RoleName, Roles: [!Ref InstanceRole]}
Outputs:
  BucketName:          {Value: !Ref ResultsBucket}
  InstanceProfileName: {Value: !Ref InstanceProfile}
```

## 부록 B. `compute.yaml`

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: Decision-model benchmark -- one instance that runs the benchmark unattended and terminates itself.
Parameters:
  BucketName:          {Type: String}
  RunId:               {Type: String}
  InstanceProfileName: {Type: String, Description: "Output of the SAME-REGION storage stack (no default on purpose)"}
  VpcId:               {Type: AWS::EC2::VPC::Id}
  SubnetId:            {Type: String, Default: "", Description: "Empty = let EC2 pick an AZ with capacity"}
  InstanceType:        {Type: String, Default: g5.2xlarge}
  AmiId:               {Type: "AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>",
                        Default: /aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-24.04/latest/ami-id}
  RootVolumeGiB:       {Type: Number, Default: 150}
  RootDeviceName:      {Type: String, Default: /dev/sda1, Description: "/dev/sda1 for the Ubuntu DLAMI, /dev/xvda for AL2023"}
  BootstrapKey:        {Type: String, Default: input/bootstrap.sh}
  MaxRunHours:         {Type: String, Default: "4"}
Conditions:
  HasSubnet: !Not [!Equals [!Ref SubnetId, ""]]
Resources:
  SecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: benchmark host, egress only (access via SSM Session Manager)
      VpcId: !Ref VpcId
      SecurityGroupEgress: [{IpProtocol: "-1", CidrIp: 0.0.0.0/0}]
  Instance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: !Ref AmiId
      InstanceType: !Ref InstanceType
      SubnetId: !If [HasSubnet, !Ref SubnetId, !Ref "AWS::NoValue"]
      SecurityGroupIds: [!Ref SecurityGroup]
      IamInstanceProfile: !Ref InstanceProfileName
      InstanceInitiatedShutdownBehavior: terminate
      EbsOptimized: true
      MetadataOptions: {HttpTokens: required, HttpEndpoint: enabled}
      BlockDeviceMappings:
        - DeviceName: !Ref RootDeviceName
          Ebs: {VolumeType: gp3, VolumeSize: !Ref RootVolumeGiB, DeleteOnTermination: true, Encrypted: true}
      Tags: [{Key: Project, Value: decision-bench}, {Key: Name, Value: !Sub "decision-bench-${RunId}"}]
      UserData:
        Fn::Base64: !Sub |
          #!/bin/bash
          LOG=/var/log/bootstrap.log
          echo "[$(date -u +%FT%TZ)] user-data start run=${RunId}" | tee -a $LOG > /dev/console
          # 빠르게 부팅하는 호스트는 인스턴스 프로파일 자격 증명이 IMDS에 뜨기 전에 user-data가 돌 수 있다
          TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
          for i in $(seq 1 60); do
            ROLE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/)
            [ -n "$ROLE" ] && curl -s -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/iam/security-credentials/$ROLE" | grep -q '"Code" : "Success"' && break
            sleep 2
          done
          fetch() { for i in 1 2 3 4 5 6; do aws s3 cp "$1" "$2" --region ${AWS::Region} >> $LOG 2>&1 && return 0; echo "retry $i: $1" | tee -a $LOG > /dev/console; sleep 10; done; return 1; }
          fetch s3://${BucketName}/${BootstrapKey} /root/bootstrap.sh
          fetch s3://${BucketName}/input/run.env /root/run.env
          chmod 700 /root/bootstrap.sh /root/run.env
          timeout ${MaxRunHours}h bash /root/bootstrap.sh >> $LOG 2>&1
          RC=$?
          echo "[$(date -u +%FT%TZ)] bootstrap exit code $RC" | tee -a $LOG > /dev/console
          aws s3 cp $LOG s3://${BucketName}/runs/${RunId}/bootstrap.log --region ${AWS::Region} 2> /dev/console
          echo $RC | aws s3 cp - s3://${BucketName}/runs/${RunId}/EXIT_CODE --region ${AWS::Region} 2> /dev/console
          if aws s3 ls s3://${BucketName}/runs/${RunId}/KEEP_ALIVE --region ${AWS::Region} >/dev/null 2>&1; then
            echo "KEEP_ALIVE marker present; not shutting down" >> $LOG
          else
            shutdown -h now
          fi
  IdleTerminateAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: !Sub "decision-bench-${RunId}-idle-terminate"
      Namespace: AWS/EC2
      MetricName: CPUUtilization
      Dimensions: [{Name: InstanceId, Value: !Ref Instance}]
      Statistic: Average
      Period: 600
      EvaluationPeriods: 6
      DatapointsToAlarm: 6
      Threshold: 3
      ComparisonOperator: LessThanThreshold
      TreatMissingData: notBreaching
      AlarmActions: [!Sub "arn:aws:automate:${AWS::Region}:ec2:terminate"]
Outputs:
  InstanceId:    {Value: !Ref Instance}
  SsmSession:    {Value: !Sub "aws ssm start-session --target ${Instance} --region ${AWS::Region}"}
  ResultsPrefix: {Value: !Sub "s3://${BucketName}/runs/${RunId}/"}
```

## 부록 C. 스크립트

- `bootstrap_bedrock.sh` — 호스트에서 boto3 설치 → 모델 프로브 → `EFFORTS` 각 설정으로 `bedrock_decision_bench.py` 실행 → 결과 S3 동기화 → `DONE` 마커.
- `bedrock_decision_bench.py` — Bedrock Converse 결정기 측정(호출별 지연·stopReason·reasoning 유무·토큰 기록, p50/p90/p99·정답률 요약). §7-3의 노트북 실행 예시와 동일 파일.
- `self_hosted_decision_client.py` — llama-server 직접 로짓 결정 클라이언트(참고 코드).
- `tasks.json` — 7태스크 84문항(정답 포함).

(파일은 이 글에 첨부하거나 팀 저장소에 공개합니다.)
