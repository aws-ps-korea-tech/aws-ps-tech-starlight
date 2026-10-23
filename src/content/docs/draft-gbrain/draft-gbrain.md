---
title: "[DRAFT] gbrain 검색 파이프라인 이해하기: 하이브리드 검색에서 무엇을 고를 수 있고, 논문 코퍼스에는 어떻게 맞출까"
---

# [DRAFT] gbrain 검색 파이프라인 이해하기: 하이브리드 검색에서 무엇을 고를 수 있고, 논문 코퍼스에는 어떻게 맞출까

<p class="callout warning"><strong>비공개 초안 v0.1 (2026-10-12)</strong> - AWS 블로그 게재 후보. 근거는 gbrain v0.51.6.0 소스와 문서(docs/architecture/RETRIEVAL.md, docs/ENGINES.md)입니다. 게재 전 검토: 측정치는 upstream 문서 인용값이므로 버전 재확인, 그림은 draw.io로 교체, 리랭커 Bedrock 경유안은 검증 후 표현 조정.</p>

이 글은 오픈소스 지식 베이스 gbrain을 AWS에 올려 연구 노트와 논문을 쌓기 시작한 팀을 위해 썼습니다. "벡터 검색으로 설치했는데 하이브리드로 바꿀 수 있나", "검색 알고리즘을 직접 가져올 수 있나", "논문을 많이 읽는 연구실은 무엇을 켜야 하나"라는 세 가지 질문에 소스 코드를 근거로 답합니다. 결론부터 말하면, gbrain에서 선택하는 것은 알고리즘의 종류가 아니라 **파이프라인 각 단계의 설정과 모델**이며, 점수를 가장 크게 움직이는 것은 벡터와 키워드의 비율이 아니라 **지식 그래프와 리랭커**입니다.

## 개요

gbrain은 Markdown 페이지를 Postgres(또는 단일 파일 PGLite)에 저장하고, 에이전트가 CLI로 검색·질의하는 구조의 지식 베이스입니다. AWS에서는 Amazon RDS for PostgreSQL(pgvector)에 데이터를 두고, Amazon ECS에서 gbrain 서버를 실행하고, 임베딩은 Amazon Bedrock의 Titan Text Embeddings v2를 OpenAI 호환 게이트웨이(LiteLLM) 뒤에 두는 구성이 일반적입니다.

이 글에서 반복해 쓰는 용어를 먼저 정리합니다.

| 용어 | 뜻 |
|---|---|
| **recall arm** | 후보를 모아 오는 독립 경로. 벡터, 키워드(BM25), 제목 구문, 관계(타입 엣지)의 네 가지가 있습니다. |
| **RRF (Reciprocal Rank Fusion)** | 각 arm의 순위를 1/(k+rank)로 바꿔 더하는 융합 방식. gbrain은 k=60을 상수로 씁니다. |
| **리랭커(reranker)** | 융합된 상위 후보를 질의와 함께 다시 읽어 순서를 고치는 cross-encoder 모델. |
| **모드 번들** | 수십 개 설정값을 한 번에 정하는 프리셋. conservative, balanced, tokenmax 세 가지입니다. |
| **knob** | `search.<key>` 형태의 개별 설정키. 번들 값을 키 단위로 덮어씁니다. |

## 1. 검색 파이프라인 한눈에 보기

gbrain의 `query` 연산은 다음 순서로 동작합니다. `search` 연산은 같은 파이프라인에서 쿼리 확장을 끈 저비용 경로입니다.

<!-- 그림 1 삽입: 파이프라인 다이어그램(draw.io). 삽입 후 아래 ASCII 블록 삭제 -->
```
질의
 │
 ├─ (1) 인텐트 분류 ─ 정규식 기반, LLM 호출 없음
 │      entity / temporal / event / concept / general
 ├─ (2) 쿼리 확장 ─ LLM이 변형 2-3개 생성 (query 연산 또는 tokenmax에서만)
 │
 ├─ (3) recall arms ─ 4개 경로가 각자 후보를 모음
 │      벡터(pgvector HNSW)  키워드(BM25 tsvector)  제목 구문  관계(타입 엣지)
 │
 ├─ (4) RRF 융합 (k=60, 인텐트별 가중) → 코사인 재점수 → 부스트(백링크·최신성·그래프·정확 일치)
 ├─ (5) 그래프 확장 → 4단계 중복 제거
 ├─ (6) cross-encoder 리랭커 (balanced / tokenmax)
 └─ (7) 관계 재고정 → 별칭 홉 → 근거 스탬프 → limit → 토큰 예산
```

주목할 점은 (3)입니다. 벡터 검색은 네 arm 중 하나일 뿐이고, 임베딩이 없을 때만 키워드 단독으로 떨어지는 fail-open 설계입니다. 즉 "벡터 기반 설치"와 "하이브리드 설치"라는 두 갈래는 존재하지 않고, 설치는 항상 하이브리드입니다.

## 2. 벡터와 키워드의 비율보다 그래프와 리랭커가 점수를 만듭니다

upstream 문서가 공개한 벤치마크 수치는 이 글의 권장안 대부분을 설명합니다.

| 구성 | BrainBench P@5 |
|---|---|
| 키워드만 | 약 18 |
| 벡터만 | 약 18 |
| 벡터 + 키워드 RRF (그래프 없음) | 약 18 |
| 풀스택 (그래프 + 리랭커 포함) | **49.1** (R@5 97.9) |

세 가지 단순 구성이 거의 같은 점수인 반면, 지식 그래프를 켠 풀스택이 31점을 더 가져갑니다. 리랭커는 LongMemEval-S recall@5를 93.4%에서 95.5%로 올리고 top-1 결과의 60%를 재배열하며, 지연은 p50 기준 약 150ms 늘어납니다. 반대로 쿼리 확장은 동일 가중치로 융합하면 93.2%에서 54.9%로 **떨어지는** 것이 확인되어, 모든 번들이 확장 변형 예산을 비워 두고 `search` 연산에서는 확장을 끕니다.

이 수치가 뜻하는 바는 단순합니다. 벡터 모델을 바꾸거나 키워드 가중치를 조절하는 일은 미세 조정이고, 그래프 엣지를 쌓고 리랭커를 켜는 일이 구조적 개선입니다.

## 3. 선택할 수 있는 것: 네 단계 사다리

사용자가 손댈 수 있는 지점은 코드 수정 없는 것부터 코드 주입까지 네 단계입니다.

### 3.1 모드 번들 선택

`gbrain config set search.mode <mode>` 한 줄로 바꾸며, 재색인이 필요하지 않습니다.

| knob | conservative | balanced (기본) | tokenmax |
|---|---|---|---|
| 결과 수 / 토큰 예산 | 10 / 4,000 | 25 / 12,000 | 50 / 무제한 |
| cross-encoder 리랭커 | off | **on** (입력 25) | on (입력 50) |
| 쿼리 확장(LLM) | off | off | on |
| 그래프 신호 | off | on | on |
| 관계 arm (타입 엣지, 깊이 2) | off | on | on |
| contextual retrieval | none | title (무료) | 청크당 LLM 요약 1회 |
| 인텐트 가중 / 캐시 | on / on | on / on | on / on |

conservative는 리랭커, 그래프 신호, 관계 arm이 모두 꺼져 있어 2절의 "벡터 + 키워드 RRF" 구성에 가깝습니다. 토큰 비용을 아끼려는 에이전트 환경에 맞춘 번들이며, 검색 품질 기준으로는 balanced가 출발점입니다.

### 3.2 개별 knob 덮어쓰기

우선순위는 호출별 옵션, `search.<key>` 개별 설정, 모드 번들, balanced 폴백 순입니다. 번들을 고른 뒤 필요한 키만 바꾸는 방식으로 쓰며, 대표적인 키는 다음과 같습니다.

| 영역 | 설정 | 효과 |
|---|---|---|
| 리랭커 | `search.reranker.enabled`, `search.reranker.model` | 리랭커 on/off와 모델 지정 |
| 키워드 FTS | 환경 변수 `GBRAIN_FTS_LANGUAGE` | Postgres 텍스트 검색 설정(`english`, `simple` 등). 변경 시 재색인 |
| 소스 가중·제외 | `GBRAIN_SOURCE_BOOST`, `GBRAIN_SEARCH_EXCLUDE` | 경로 접두사별 점수 배수, 검색 제외 |
| 인텐트 분류 | `search.intent_patterns` | 브레인별 정규식 패턴 추가 |
| 융합 가중 | `search.keyword_arm_confidence_floor`, `search.metadata_boost_gate`, `search.expansion_variant_budget` | arm 신뢰도 하한, 메타데이터 부스트 게이트, 확장 변형 예산 |

인텐트별 기본 가중은 코드에 들어 있습니다(entity 질의는 키워드 1.15배, event는 키워드 1.20배와 벡터 0.95배, concept는 키워드 0.9배와 벡터 1.2배).

### 3.3 임베딩과 리랭커 모델 교체

- **임베딩**: 프로바이더 레시피 26종(voyage, openai, google, mistral, nvidia, ollama, llama-server, litellm 등)이 있고, OpenAI 호환 `/v1/embeddings`를 내는 엔드포인트라면 무엇이든 `provider_base_urls`로 연결할 수 있습니다. vLLM, Text Embeddings Inference, llama.cpp가 모두 해당합니다. 벡터 차원이 바뀌면 `gbrain migrate embeddings`로 **전체 재임베딩**이 일어나므로, 모델은 코퍼스를 쌓기 전에 정하는 것이 좋습니다.
- **리랭커**: 기본은 Voyage rerank-2.5이고, `llama-server-reranker` 레시피가 범용 어댑터 역할을 합니다. 요청 `{query, documents, top_n}`에 응답 `{results: [{index, relevance_score}]}`를 돌려주는 엔드포인트면 어떤 cross-encoder라도 붙일 수 있습니다. Bedrock을 SigV4로 직접 호출하는 레시피는 없으므로, Bedrock 리랭커를 쓰려면 LiteLLM의 `/rerank` 경로를 거쳐야 하고 이 와이어 호환성은 별도 검증 항목입니다.

### 3.4 코드 수준 주입

gbrain은 `gbrain/search/hybrid`, `gbrain/engine`, `gbrain/embedding` 등을 라이브러리로 export합니다. `hybridSearch(engine, query, opts)`의 옵션에 함수를 넘겨 단계를 바꿀 수 있습니다.

| 주입 지점 | 바꿀 수 있는 것 |
|---|---|
| `queryEmbedFn(text)` | 질의 임베딩 함수 |
| `reranker.rerankerFn({query, documents, topN})` | 리랭커 함수 (HTTP 없이 로컬 모델도 가능) |
| `expandFn(query)` | 쿼리 확장 로직 |
| `rrfK`, `dedupOpts`, `walkDepth`, `embeddingColumn` | 융합 k, 중복 제거 임계값, 그래프 탐색 깊이, 임베딩 컬럼 |
| `onRerankPool`, `onMeta` | 리랭커 직전 중간 풀을 받아 자체 후처리나 평가 |

## 4. 직접 알고리즘을 가져올 수 있을까

위 사다리를 기준으로 정리하면 다음과 같습니다.

| 하고 싶은 것 | 가능 여부 | 방법 |
|---|---|---|
| 리랭커를 자체 모델로 교체 | 가능 | `llama-server-reranker` 레시피 또는 `rerankerFn` 주입 |
| 임베딩을 자체 모델로 교체 | 가능 | OpenAI 호환 엔드포인트 + `provider_base_urls`, 재임베딩 |
| 쿼리 확장 로직 교체 | 가능 | `expandFn` 주입 |
| 융합 가중·k·중복 제거 조정 | 가능 | 설정키 또는 호출별 옵션 |
| 중간 후보 풀에 자체 후처리 | 가능 | `onRerankPool` |
| RRF를 다른 융합 공식으로 교체 | 불가 (fork) | 코드 상수 |
| 새 recall arm 추가 | 불가 (fork) | |
| 청킹 방식 선택 (300단어, 겹침 50 고정) | 불가 (코드 레벨) | 재귀 청커 외에 semantic, 코드 청커가 있으나 CLI knob 없음 |
| HNSW m / ef_construction 조정 | 우회 가능 | SQL로 인덱스 직접 재생성 |
| 임베딩 컬럼 여러 개를 병행 운영 | 부분 | 읽기 레지스트리(`embedding_columns`)만 있고 쓰기 CLI는 아직 없음 |

요약하면 "모델과 단계별 함수는 가져올 수 있고, 융합 뼈대와 arm 구성은 가져올 수 없다"입니다. 대부분의 팀에게 필요한 것은 전자입니다.

## 5. 논문을 많이 읽는 연구실을 위한 권장 구성

### 5.1 balanced에서 시작하고, 개념 질의는 `query`로

리랭커 on이 논문 질의응답 품질의 최대 레버입니다. balanced의 contextual retrieval `title`은 각 청크 앞에 페이지 제목을 붙여 임베딩하는 무료 옵션으로, "어느 논문의 어느 문단인지"가 벡터에 들어가 논문 코퍼스에 특히 잘 맞습니다. tokenmax의 청크당 LLM 요약은 인제스트 비용의 주된 항목이므로, 수천 편 규모라면 balanced로 시작해 평가 뒤에 올리는 편이 안전합니다. "X 분야 연구 전부", "Y란 무엇인가" 같은 넓은 질의는 확장이 켜진 `query` 연산을, 특정 사실을 찾는 질의는 `search`를 씁니다.

### 5.2 리랭커는 데이터 거주성으로 고릅니다

| 옵션 | 장점 | 고려 사항 |
|---|---|---|
| Voyage rerank-2.5 (기본) | 설정 한 줄, 품질 검증 | API 키 필요, 후보 본문이 외부 API로 전송되어 미공개 원고에는 부적합 |
| 자체 호스팅 Qwen3-Reranker-4B/8B (`llama-server-reranker`) | 추론 비용 외 과금 없음, 데이터 외부 전송 없음, 다국어 | GPU 없으면 수 초 지연(레시피 기본 timeout 30초), 운영 부담 |
| Amazon Bedrock Cohere Rerank 3.5 또는 Amazon Rerank (LiteLLM `/rerank` 경유) | 리전 내 처리, 키 없이 IAM 역할 | 응답 형식과 레시피 파서의 호환, 사용 리전의 모델 가용성 검증 필요 |

### 5.3 임베딩은 다국어와 긴 입력을 기준으로

Titan Text Embeddings v2(1024차원, 입력 8k 토큰, 100개 이상 언어)는 영어 논문 본문과 한국어 질의 조합에 무난하고 리전 내에서 처리됩니다. 상향 후보는 Bedrock의 Cohere Embed v4(다국어, 멀티모달, 긴 입력)와 자체 호스팅 Qwen3-Embedding-8B(32k 입력)입니다. SPECTER2나 SciNCL 같은 과학 특화 모델은 인용 신호로 학습되어 "관련 논문 찾기"에는 강하지만 영어 전용이고 입력이 512토큰이라 청크 단위 질의응답에는 범용 모델이 더 적합합니다. 두 모델을 병행하는 쓰기 경로가 아직 없으므로 현재는 하나를 고르게 됩니다.

### 5.4 키워드 arm의 한국어 처리를 알고 운영해야 합니다

키워드 arm은 Postgres 전문 검색(tsvector)으로 BM25를 계산합니다. 현재 기본 설정 `simple`은 어간 추출을 하지 않아 "embeddings"와 "embedding"을 다른 단어로 봅니다. 영어 본문이 대부분이면 `GBRAIN_FTS_LANGUAGE=english`가 BM25 arm 품질을 올립니다.

한국어 질의는 별도 경로를 탑니다. 질의에 CJK 문자가 하나라도 있으면 FTS 대신 공백으로 나눈 term을 AND 조건의 ILIKE로 찾는 폴백이 동작하며, IDF 가중과 인덱스가 없습니다. 중요한 함의는 **혼합 질의**입니다. "CRISPR 논문"처럼 영어 용어와 한국어가 섞이면 영어 term까지 ILIKE로 처리되어 BM25를 잃습니다. 전문용어 질의는 영어로만 쓰도록 운영 가이드를 두면 이 손실을 피할 수 있습니다. 한국어 질의 자체는 FTS 설정값과 무관하게 같은 경로이므로 `english`로 바꿔도 불리해지지 않습니다. 청크가 수십만 개 규모로 커지면 `content_chunks.chunk_text`에 pg_trgm GIN 인덱스를 수동으로 추가하는 방안이 있고(gbrain은 만들지 않으며 플래너가 ILIKE에 자동으로 사용), 효과는 측정으로 확인해야 합니다.

### 5.5 인용 그래프가 31점의 원천입니다

`citation-graph-ingest` 스킬은 참고문헌을 LLM이 분류해 `cites`, `extends`, `refutes`, `relies_on`, `supersedes` 타입 엣지로 기록합니다. balanced 이상에서 켜지는 관계 arm이 "X를 반박한 연구", "Y를 확장한 후속 연구" 같은 질의를 벡터 없이 풉니다. 저자, 연구실, 학회 페이지를 만들어 `[[wikilink]]`로 걸어 두면 LLM 비용 없이 엣지가 자동 생성됩니다.

### 5.6 인제스트 품질이 검색의 상한입니다

gbrain은 PDF 텍스트 추출을 직접 하지 않고 에이전트에 위임합니다. PDF를 Markdown으로 바꾸는 변환기의 수식, 표, 2단 레이아웃 처리 품질이 검색 품질을 결정합니다. 참고문헌 섹션과 보충자료는 `.raw/` 경로나 `GBRAIN_SEARCH_EXCLUDE` 접두사로 분리해 키워드 노이즈를 줄입니다. 기본 청크(300단어, 겹침 50, 최대 2,000토큰)는 논문 문단 단위에 적절하며, 긴 표는 토큰 캡에서 분할됩니다.

### 5.7 평가 루프를 먼저 만듭니다

설정을 바꾸기 전에 비교 기준을 확보합니다. `GBRAIN_CONTRIBUTOR_MODE=1`로 실제 질의를 캡처하고 `gbrain eval export`로 내보낸 뒤, 변경 후 `gbrain eval replay --against before.ndjson`으로 전후를 비교합니다. 정답 라벨이 있으면 `gbrain eval --qrels labels.tsv`를 쓰고, 개별 질의는 `gbrain search --explain`과 `gbrain search diagnose "<질의>" --target <slug>`로 어느 arm이 후보를 놓쳤는지 확인합니다.

## 6. AWS 위의 참조 구성

<!-- 그림 2 삽입: AWS 구성도(draw.io). ECS(gbrain + LiteLLM) / RDS pgvector / Bedrock(임베딩, 리랭커) / 선택: 자체 호스팅 리랭커 -->

| 구성요소 | AWS 서비스 | 비고 |
|---|---|---|
| 저장소 | Amazon RDS for PostgreSQL + pgvector | HNSW `vector_cosine_ops`, halfvec 가능 |
| 서버 | Amazon ECS (Fargate) | `gbrain config set`은 ECS Exec으로 실행 |
| 임베딩 | Amazon Bedrock Titan Text Embeddings v2 | LiteLLM `litellm` 레시피 경유, 리전 내 처리 |
| 리랭커 (택 1) | Bedrock Cohere Rerank 3.5 via LiteLLM `/rerank`, 또는 Amazon EC2(GPU)의 Qwen3-Reranker | 전자는 와이어 검증 후 채택 |
| 그래프 분류·확장 LLM | Amazon Bedrock | citation-graph-ingest, `query` 확장 |

## 7. 적용 순서와 변경 비용

| 순서 | 변경 | 방법 | 비용 |
|---|---|---|---|
| 1 | 평가 기준선 확보 | `GBRAIN_CONTRIBUTOR_MODE=1`, `eval export` | 없음 |
| 2 | conservative에서 balanced로 | `gbrain config set search.mode balanced` | 즉시, 재색인 없음. 리랭커 미설정 시 `reranker_skipped`로 fail-open |
| 3 | 리랭커 추가 | 5.2 중 택 1 + `search.reranker.*` | Bedrock 경유안은 검증 PoC 선행 |
| 4 | FTS `english` | 환경 변수 변경 + 재배포 + `gbrain reindex --markdown --no-embed` | 임베딩 재호출 없음 |
| 5 | 인용 그래프 적재 | citation-graph-ingest 스킬 | 참고문헌 수 x LLM 분류 호출 |
| 6 | (선택) 임베딩 교체 | 모델 변경 + `gbrain migrate embeddings` | 전체 재임베딩, 코퍼스 확정 전 결정 |

각 단계 뒤에 `eval replay`로 전후를 비교하면 어느 변경이 실제로 점수를 올렸는지 분리해 볼 수 있습니다.

## 마무리

gbrain의 검색은 설치 시점에 벡터냐 하이브리드냐를 고르는 구조가 아니라, 항상 하이브리드로 동작하는 파이프라인의 단계별 설정과 모델을 운영 중에 바꾸는 구조입니다. 공개 벤치마크는 벡터와 키워드의 조합보다 지식 그래프와 리랭커가 점수를 만든다는 점을 보여 주며, 논문 코퍼스에서는 인용 그래프와 리전 내 리랭커, 영어 FTS 설정, 그리고 인제스트 변환 품질이 우선순위입니다. 자체 알고리즘은 모델과 단계별 함수 수준에서 가져올 수 있고, 융합 뼈대를 바꾸려면 fork가 필요합니다.

## 참고 자료

- gbrain 저장소: [github.com/garrytan/gbrain](https://github.com/garrytan/gbrain) (v0.51.6.0 기준, `docs/architecture/RETRIEVAL.md`, `docs/ENGINES.md`, `docs/embedding-migrations.md`)
- 검색 소스: `src/core/search/hybrid.ts`, `mode.ts`, `intent-weights.ts`, `cjk-keyword-sql.ts`, `embedding-column.ts`
- [pgvector](https://github.com/pgvector/pgvector) HNSW 인덱스
- [Amazon Bedrock Titan Text Embeddings v2](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)
- [Amazon Bedrock Rerank API](https://docs.aws.amazon.com/bedrock/latest/userguide/rerank.html)
