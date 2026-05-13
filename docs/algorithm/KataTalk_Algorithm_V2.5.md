검토 결과, **현재 알고리즘은 이미 상용 SaaS의 핵심 뼈대는 충분히 강하지만**, 첨부 보고서를 반영하면 “AI 분석기”에서 **“바둑 교사형 해설 엔진”**으로 한 단계 더 강화할 수 있습니다.

보고서의 핵심 시사점은 명확합니다. 사용자는 단순 최선수보다 **왜 그 수가 좋은지, 내 수가 왜 나쁜지, 내 수준에서 무엇을 배워야 하는지**를 원하고, 가장 큰 병목은 **KataGo 수치와 인간 바둑 개념 사이의 매핑**, 그리고 **LLM 환각 제어**입니다. 또한 권장 구조도 단순 `KataGo + LLM`이 아니라, 분석 엔진 → 이벤트 선별 → 개념 추출 → 설명 계획 → LLM 생성 → 검증 루프 → UI/학습으로 나뉘어야 한다고 제안합니다. 

---

# 최종 강화 보고서: KataTalk 해설 알고리즘 V2.5

## 1. 결론

기존 설계는 다음에 강했습니다.

```text
1. 승률 착시 보정
2. BSI 기반 실수 심각도 계산
3. ADI 기반 Adaptive Deep Search
4. 전체 대국 궤적에서 패착 1개 + 주요 실수 2개 추출
5. Ownership 기반 LLM 환각 방지
6. 크레딧 기반 BM / 비동기 분석 / 환불 구조
```

그러나 보고서를 반영하면 반드시 추가해야 할 축이 있습니다.

```text
1. 수준별 설명 플래너
2. 바둑 개념 태그 추출기
3. 후보수 비교 엔진
4. 학습 가치 기반 Key Move 선정
5. 대화형 Q&A용 근거 저장소
6. LLM 출력 검증 루프
7. SGF 코멘트 / 다국어 / 음성 확장 구조
8. 평가 데이터셋 및 피드백 루프
```

즉, 기존 알고리즘은 **정확한 분석 엔진**이고, 강화 버전은 **학습 가능한 해설 엔진**입니다.

---

# 2. 강화된 전체 아키텍처

기존:

```text
KataGo JSON
 → BSI
 → ADI
 → Key Move
 → Ownership Token
 → LLM 해설
```

강화 후:

```text
KataGo JSON
   ↓
[1] Value & Search Analyzer
   - BSI, ADI, Δscore, Δwinrate, confidence
   ↓
[2] Concept Tagging Engine
   - 침입, 삭감, 보강, 연결, 끊음, 사활, 축, 끝내기, 선수/후수
   ↓
[3] Audience-Aware Explanation Planner
   - 초급 / 중급 / 고급 / 프로 지향 해설 구조 선택
   ↓
[4] Candidate Comparison Engine
   - AI 최선수
   - 유저 실전수
   - 인간적으로 둘 만한 대안
   ↓
[5] Learning Event Selector
   - 패착뿐 아니라 학습 가치가 큰 장면 선별
   ↓
[6] Grounded LLM Generator
   - 근거 제한 자연어 생성
   ↓
[7] Claim Verification Layer
   - 환각 / 과장 / 근거 없는 사활·축·침입 표현 차단
   ↓
[8] UI / Q&A / SGF / Voice Export
```

이 구조의 가장 큰 변화는 **LLM 앞에 “개념 추출기”와 “설명 계획기”를 둔 것**입니다.

---

# 3. 핵심 강화 1: Concept Tagging Engine

## 3.1 왜 필요한가

현재 ownership 기반으로 “상대 영향권 삭감”, “내 진영 보강” 정도는 구분할 수 있습니다. 하지만 보고서에서 지적한 사용자의 실제 요구는 더 구체적입니다.

```text
왜 이 수가 좋은가?
왜 내 수가 나쁜가?
이 돌은 죽었나?
이 수는 침입인가, 삭감인가, 보강인가?
다른 후보수는 왜 안 되는가?
```

따라서 착수마다 바둑 개념 태그를 붙이는 계층이 필요합니다.

---

## 3.2 Concept Ontology

```ts
type GoConceptTag =
  | "invasion"          // 침입
  | "reduction"         // 삭감
  | "extension"         // 벌림 / 확장
  | "connection"        // 연결
  | "cut"               // 끊음
  | "atari"             // 단수
  | "capture"           // 잡음
  | "life_and_death"    // 사활
  | "ladder"            // 축
  | "net"               // 장문
  | "sente"             // 선수
  | "gote"              // 후수
  | "tenuki"            // 손빼기
  | "shape"             // 행마 / 모양
  | "thickness"         // 두터움
  | "sabaki"            // 사바키
  | "endgame"           // 끝내기
  | "ko"                // 패
  | "probe"             // 응수타진
  | "territory_defense" // 집 지키기
  | "weak_group_attack" // 약한 돌 공격
  | "weak_group_save";  // 약한 돌 수습
```

---

## 3.3 Concept Tag 추론 로직

각 수 (m)에 대해 다음 특징을 계산합니다.

```text
1. ownership_before
2. ownership_after
3. local ownership gain
4. 주변 그룹 liberty 변화
5. 연결/끊김 그래프 변화
6. PV 강제성
7. scoreLead 변화
8. policy prior
9. 후보수 간 목적 차이
10. 착점 주변 상대/내 돌 밀도
```

### 그룹 그래프 기반 연결/끊음 판정

```python
def detect_connection_or_cut(board_before, board_after, move):
    own_groups_before = get_adjacent_own_groups(board_before, move)
    opp_groups_before = get_adjacent_opp_groups(board_before, move)

    connects_own_groups = len(own_groups_before) >= 2
    separates_opp_groups = move_reduces_connection_path(board_before, move)

    tags = []

    if connects_own_groups:
        tags.append("connection")

    if separates_opp_groups:
        tags.append("cut")

    return tags
```

### 침입/삭감/보강 판정

```python
def classify_territorial_function(root_mu, gain):
    if root_mu < -0.55 and gain > 0.20:
        return "invasion"

    if -0.55 <= root_mu < -0.20 and gain > 0.12:
        return "reduction"

    if root_mu > 0.20 and gain > 0.08:
        return "territory_defense"

    if -0.20 <= root_mu <= 0.20 and gain > 0.10:
        return "influence_expansion"

    return "neutral_or_low_impact"
```

### 사활 판정

```python
def detect_life_death_context(ctx):
    local_group = find_nearest_weak_group(ctx.board_before, ctx.user_move)

    if not local_group:
        return False

    liberty_delta = ctx.liberty_after_best - ctx.liberty_after_user
    ownership_swing = ctx.local_ownership_gain_best - ctx.local_ownership_gain_user

    return (
        local_group.liberties <= 4 and
        ctx.delta_score >= 5.0 and
        ctx.distance <= 4 and
        (liberty_delta >= 2 or ownership_swing >= 0.25)
    )
```

---

## 3.4 최종 Concept Tag 결과 예시

```json
{
  "conceptTags": [
    {
      "tag": "reduction",
      "confidence": 0.86,
      "evidence": [
        "AI 최선수 주변이 상대 영향권",
        "착수 후 ownership gain +0.21",
        "상대 집 모양을 직접 낮춤"
      ]
    },
    {
      "tag": "sente",
      "confidence": 0.74,
      "evidence": [
        "PV에서 상대 응수가 강제됨",
        "AI PV forcedness 0.68"
      ]
    }
  ]
}
```

이 결과를 LLM에 넣으면, LLM은 더 이상 “이 수는 침입입니다”라고 마음대로 말하지 못하고, `reduction` 근거가 있을 때만 삭감이라고 말하게 됩니다.

---

# 4. 핵심 강화 2: 수준별 설명 플래너

## 4.1 왜 필요한가

보고서에 따르면 초보자와 고급자는 완전히 다른 설명을 원합니다. 초보자는 “왜 죽었는지”를 원하고, 고급자는 “왜 이 삭감 타이밍이 선수인지”를 원합니다. 

기존 카타톡 설계는 타이젬 9단 이상을 기준으로 했기 때문에, 상용 SaaS로 확장하려면 `audienceLevel`이 반드시 필요합니다.

---

## 4.2 Audience Profile

```ts
type AudienceLevel =
  | "beginner"      // 20급~10급
  | "intermediate"  // 9급~1급
  | "dan"           // 아마 단급
  | "high_dan"      // 타이젬 7단~9단
  | "pro_style";    // 프로 해설 스타일
```

---

## 4.3 수준별 설명 전략

| 수준           | 설명 초점                   | 금지/주의            |
| ------------ | ----------------------- | ---------------- |
| beginner     | 연결, 끊김, 두 눈, 단수, 잡힘     | 승률/집 차이 과다 사용 금지 |
| intermediate | 큰 자리, 약한 돌, 선수후수, 기본 사활 | 너무 긴 PV 금지       |
| dan          | 방향, 형세, 두터움, 삭감, 타이밍    | 초보적 설명 반복 금지     |
| high_dan     | 후보수 비교, 집 차이, 수순 정확도    | 장황한 교육 말투 금지     |
| pro_style    | 핵심 판단만 압축               | 과도한 친절 설명 금지     |

---

## 4.4 Explanation Plan 생성

```python
def build_explanation_plan(ctx, audience_level):
    if audience_level == "beginner":
        return {
            "opening": "쉬운 말로 핵심 문제 설명",
            "focus": ["stone_status", "connection", "capture_risk"],
            "max_pv_moves": 3,
            "use_numbers": False,
            "study_point_style": "basic"
        }

    if audience_level == "high_dan":
        return {
            "opening": "바둑적 의미로 바로 진입",
            "focus": ["direction", "sente_gote", "score_loss", "pv_comparison"],
            "max_pv_moves": 6,
            "use_numbers": True,
            "study_point_style": "compressed"
        }

    if audience_level == "pro_style":
        return {
            "opening": "판단 요약",
            "focus": ["global_direction", "timing", "precise_punishment"],
            "max_pv_moves": 8,
            "use_numbers": True,
            "study_point_style": "minimal"
        }
```

---

# 5. 핵심 강화 3: 후보수 비교 엔진

## 5.1 왜 필요한가

보고서에서는 “AI 추천수가 너무 어렵다”는 수요가 중요하게 등장합니다. 즉, 사용자는 단순히 최선수만 원하는 것이 아니라 다음을 원합니다.

```text
1. AI 최선수
2. 내 실전수
3. 인간적으로 둘 만한 쉬운 대안
4. 왜 최선수와 대안이 다른가
```

따라서 `bestMove` 하나만 보여주면 부족합니다.

---

## 5.2 Human-Playable Alternative

AI 최선수가 너무 난해하면, top-N 후보 중 손해가 작고 이해하기 쉬운 수를 함께 제시합니다.

```python
def select_human_playable_alternative(move_infos, best, audience_level):
    candidates = []

    for m in move_infos[:10]:
        score_loss = best.scoreLead - m.scoreLead

        if score_loss < 0:
            continue

        difficulty = estimate_move_difficulty(m, audience_level)

        # 최선수와 1.5집 이내, 난이도 낮은 수
        if score_loss <= acceptable_loss(audience_level):
            candidates.append((difficulty, score_loss, m))

    candidates.sort(key=lambda x: (x[0], x[1]))

    return candidates[0][2] if candidates else None
```

---

## 5.3 Move Difficulty Score

```python
def estimate_move_difficulty(move, audience_level):
    policy_rarity = 1 - move.policy_prior
    pv_complexity = min(1.0, len(move.pv) / 12)
    tactical_risk = move.tactical_complexity
    ownership_vol = move.ownership_volatility

    return (
        0.35 * policy_rarity +
        0.25 * pv_complexity +
        0.20 * tactical_risk +
        0.20 * ownership_vol
    )
```

해석:

```text
난이도 높은 수:
- policy prior가 낮음
- PV가 길고 강제적임
- 사활/축/패가 얽힘
- ownership volatility가 높음

난이도 낮은 수:
- 자연스러운 후보수
- PV가 짧음
- 목적이 명확함
- 손해가 크지 않음
```

---

## 5.4 후보수 비교 출력 예시

```json
{
  "candidateComparison": {
    "bestMove": {
      "coord": "C14",
      "purpose": "상대 영향권 삭감",
      "scoreLossFromBest": 0,
      "difficulty": 0.72
    },
    "userMove": {
      "coord": "K10",
      "purpose": "중앙 균형",
      "scoreLossFromBest": 4.7,
      "problem": "더 급한 삭감 타이밍을 놓침"
    },
    "humanAlternative": {
      "coord": "D13",
      "purpose": "좌상 압박 유지",
      "scoreLossFromBest": 0.9,
      "difficulty": 0.38
    }
  }
}
```

이 기능은 특히 유료 Premium의 차별화 포인트가 됩니다.

---

# 6. 핵심 강화 4: Learning Event Selector

## 6.1 왜 필요한가

기존 알고리즘은 “최종 패착 1개 + 주요 실수 2개”를 뽑습니다.
하지만 보고서를 반영하면, 사용자는 단순히 승부상 중요한 수뿐 아니라 **배울 가치가 큰 수**를 원합니다.

예를 들어 초보자에게는 최종 패착보다 “두 눈을 못 만들어 죽은 장면”이 더 중요할 수 있습니다.

---

## 6.2 LES: Learning Event Score

기존 `TIS`는 승부 영향력 중심입니다.
새로 `LES`를 추가합니다.

```text
LES = 학습 가치 점수
```

수식:

```text
LES =
0.30 × TIS_norm
+ 0.25 × concept_importance
+ 0.20 × level_fit
+ 0.15 × repeat_pattern
+ 0.10 × explainability
- 0.10 × complexity_penalty
```

---

## 6.3 요소 정의

```python
def learning_event_score(ctx, user_profile):
    return (
        0.30 * normalize(ctx.trajectory_impact_score) +
        0.25 * concept_importance(ctx.concept_tags, user_profile.level) +
        0.20 * level_fit(ctx, user_profile.level) +
        0.15 * repeat_pattern_score(ctx, user_profile.history) +
        0.10 * explainability_score(ctx) -
        0.10 * complexity_penalty(ctx, user_profile.level)
    )
```

### 예시

초보자:

```text
connection, atari, life_and_death → concept_importance 높음
복잡한 패, 장기적 두터움 → complexity_penalty 높음
```

고단자:

```text
sente, reduction, sabaki, direction, endgame → concept_importance 높음
단순 단수 실수 → 낮음
```

---

## 6.4 최종 Key Move 선정 방식 강화

기존:

```text
최종 패착 1개
주요 실수 2개
```

강화 후:

```text
1. Decisive Move
   - 승부상 최종 패착

2. Swing Moves
   - 승률/형세를 흔든 실수 2개

3. Learning Moves
   - 유저 수준에서 가장 배울 가치가 큰 장면 2~3개
```

Premium에서는 이렇게 보여줄 수 있습니다.

```json
{
  "keyMoves": {
    "decisiveMove": {},
    "swingMoves": [],
    "learningMoves": []
  }
}
```

---

# 7. 핵심 강화 5: 대화형 Q&A 엔진

## 7.1 왜 필요한가

보고서에서 대화형 질의응답 수요가 강하게 확인됩니다. 사용자는 다음을 묻고 싶어 합니다.

```text
왜 C14가 좋은데?
내 수 K10은 완전히 나쁜 수야?
D13은 어때?
이 돌은 죽은 거야?
이 장면에서 손 빼면 안 돼?
```

기존 결과 JSON을 Q&A에 재사용할 수 있게 구조화해야 합니다.

---

## 7.2 Q&A Grounding Context

각 핵심 수마다 다음을 저장합니다.

```json
{
  "qaContext": {
    "turn": 147,
    "legalClaims": [
      "AI 최선수는 C14이다",
      "C14의 주요 기능은 상대 영향권 삭감이다",
      "실전수 K10은 중앙 균형을 의식한 수이다",
      "실전수는 약 4.7집 손해이다",
      "사활 flag는 false이다",
      "축 flag는 false이다"
    ],
    "forbiddenClaims": [
      "이 수로 돌이 죽었다고 단정하지 말 것",
      "축이라고 말하지 말 것",
      "침입이라고 말하지 말 것"
    ],
    "candidateMoves": [
      {
        "coord": "C14",
        "role": "best",
        "conceptTags": ["reduction", "sente"]
      },
      {
        "coord": "K10",
        "role": "user",
        "conceptTags": ["influence_balance"]
      },
      {
        "coord": "D13",
        "role": "human_alternative",
        "conceptTags": ["pressure", "shape"]
      }
    ]
  }
}
```

---

## 7.3 Q&A 답변 흐름

```python
def answer_user_question(question, move_context):
    intent = classify_question_intent(question)

    evidence = retrieve_relevant_evidence(
        intent=intent,
        move_context=move_context
    )

    draft = llm_generate_answer(
        question=question,
        evidence=evidence,
        forbidden_claims=move_context.qaContext.forbiddenClaims
    )

    verified = verify_llm_claims(draft, move_context)

    if not verified.ok:
        return fallback_grounded_answer(evidence)

    return draft
```

---

# 8. 핵심 강화 6: Claim Verification Layer

## 8.1 왜 필요한가

보고서의 가장 중요한 경고는 LLM 환각입니다.
따라서 LLM 출력 후 반드시 검증 계층이 있어야 합니다.

---

## 8.2 Claim Schema

LLM 문장을 다시 구조화합니다.

```json
{
  "claims": [
    {
      "type": "concept",
      "text": "C14는 상대 영향권 삭감입니다.",
      "concept": "reduction",
      "requiredEvidence": ["ownership_best_region", "ownership_gain"]
    },
    {
      "type": "tactical",
      "text": "이 수는 사활의 급소입니다.",
      "concept": "life_and_death",
      "requiredEvidence": ["lifeAndDeathFlag"]
    }
  ]
}
```

---

## 8.3 검증 로직

```python
def verify_claims(claims, ctx):
    violations = []

    for claim in claims:
        if claim.concept == "life_and_death":
            if not ctx.exceptionFlags.lifeAndDeath:
                violations.append("사활 근거 없음")

        if claim.concept == "ladder":
            if not ctx.exceptionFlags.ladder:
                violations.append("축 근거 없음")

        if claim.concept == "invasion":
            if "invasion" not in ctx.conceptTags:
                violations.append("침입 태그 없음")

        if claim.concept == "reduction":
            if "reduction" not in ctx.conceptTags:
                violations.append("삭감 태그 없음")

        if claim.type == "score":
            if abs(claim.scoreLoss - ctx.scoreLoss) > 0.5:
                violations.append("집 손해 수치 불일치")

    return {
        "ok": len(violations) == 0,
        "violations": violations
    }
```

---

## 8.4 실패 시 재작성

```python
def generate_verified_commentary(ctx):
    draft = generate_commentary(ctx)
    claims = extract_claims(draft)

    result = verify_claims(claims, ctx)

    if result.ok:
        return draft

    revised = regenerate_with_constraints(
        ctx=ctx,
        violations=result.violations
    )

    second_check = verify_claims(extract_claims(revised), ctx)

    if second_check.ok:
        return revised

    return template_based_safe_commentary(ctx)
```

이 구조가 있으면 LLM이 그럴듯한 바둑 소설을 쓰는 위험을 크게 줄일 수 있습니다.

---

# 9. 핵심 강화 7: 평가 지표와 피드백 루프

## 9.1 왜 필요한가

보고서에서 지적하듯 자연어 해설은 “착수 예측 정확도”만으로 평가할 수 없습니다.
제품화하려면 별도 평가 지표가 필요합니다.

---

## 9.2 평가 지표

```text
1. Engine Consistency
   - 해설이 KataGo 수치와 모순되지 않는가?

2. Concept Accuracy
   - 침입/삭감/연결/사활 태그가 맞는가?

3. Hallucination Rate
   - 근거 없는 축, 사활, 패, 죽음 표현이 있는가?

4. Level Fit
   - 사용자 기력에 맞는 설명인가?

5. Helpfulness
   - 사용자가 이해했다고 느끼는가?

6. Key Move Precision
   - 선정된 패착/실수가 실제 복기 가치가 있는가?

7. Q&A Groundedness
   - 후속 질문 답변이 분석 근거 안에서 이루어지는가?
```

---

## 9.3 사용자 피드백 수집

```json
{
  "feedback": {
    "commentaryId": "commentary-147",
    "rating": 5,
    "tags": [
      "helpful",
      "too_difficult",
      "wrong_concept",
      "too_long",
      "want_more_variation"
    ],
    "freeText": "삭감 설명은 좋았는데 D13 대안도 설명해주면 좋겠어요."
  }
}
```

이 데이터는 나중에 다음에 활용됩니다.

```text
1. 해설 템플릿 개선
2. concept tag classifier 보정
3. 사용자 수준별 설명 길이 조절
4. 미세조정 데이터셋 구축
5. 환각 테스트셋 구축
```

---

# 10. 최종 강화 JSON 스키마

기존 응답에 아래 필드를 추가하는 것이 좋습니다.

```json
{
  "audience": {
    "level": "high_dan",
    "commentaryStyle": "professional",
    "language": "ko",
    "detailLevel": "dense"
  },
  "keyMoves": {
    "decisiveMove": {},
    "swingMoves": [],
    "learningMoves": []
  },
  "conceptTags": [
    {
      "turn": 147,
      "tags": [
        {
          "tag": "reduction",
          "confidence": 0.86,
          "evidence": ["ownership_gain", "opponent_influence_region"]
        }
      ]
    }
  ],
  "candidateComparison": {
    "bestMove": {},
    "userMove": {},
    "humanAlternative": {}
  },
  "qaContext": {
    "enabled": true,
    "groundingMode": "analysis_only"
  },
  "exports": {
    "sgfCommentAvailable": true,
    "voiceCommentaryAvailable": true,
    "supportedLanguages": ["ko", "en", "ja", "zh"]
  },
  "verification": {
    "claimCheckPassed": true,
    "hallucinationRisk": "low",
    "blockedClaims": []
  }
}
```

---

# 11. 실제 답변 예시: 강화 전 vs 강화 후

## 입력 상황

```json
{
  "turn": 147,
  "player": "B",
  "userMove": "K10",
  "bestMove": "C14",
  "scoreLoss": 4.7,
  "winrateLoss": 0.183,
  "BSI": 67.4,
  "ADI": 0.74,
  "distance": 8.9,
  "ownershipContext": {
    "bestRegion": "상대 영향권",
    "bestAction": "상대 영향권 삭감",
    "userRegion": "미생 또는 중립 전투 지역",
    "userAction": "중앙 균형"
  },
  "conceptTags": ["reduction", "sente", "global_direction"],
  "humanAlternative": "D13"
}
```

---

## 기존 해설

```text
147수 K10은 이 대국의 흐름이 크게 넘어간 최종 패착에 가까운 장면입니다.

실전수는 중앙의 균형을 의식한 수였지만, 이 국면의 핵심은 좌상 C14의 삭감이었습니다. C14를 먼저 두면 상대의 집 모양을 낮추면서 연결 압박까지 선수로 이어질 가능성이 컸습니다. 반면 K10은 국지적으로 완전히 무의미한 수는 아니지만, 더 급한 상대 영향권 삭감 타이밍을 놓친 수였습니다.

수치상으로는 약 4.7집 손해이며, 흑의 승률은 46.4%에서 28.1%로 내려갔습니다.
```

---

## 강화 후 고단자용 해설

```text
147수 K10은 중앙의 균형보다 좌상 삭감의 선수를 먼저 봐야 했던 장면입니다.

AI가 제시한 C14는 단순히 집을 줄이는 수가 아니라, 백의 좌상 모양을 낮추면서 이후 D14, C13 계열의 압박을 선수로 만드는 의미가 있습니다. 반면 실전 K10은 중앙에서의 균형감은 있지만, 좌상 백 집의 상한을 낮추는 직접성이 부족했습니다.

내용상 손해는 약 4.7집이고, 이 수 이후 흑 승률은 46.4%에서 28.1%로 내려갑니다. 거리 차이도 8.9로 커서, 국소 수읽기 착각이라기보다 전장 선택과 선수 판단에서 밀린 패착급 장면입니다.

현실적 대안으로는 C14가 가장 정확하지만, D13 정도도 좌상 압박을 유지하면서 손해를 1집 내외로 줄일 수 있는 인간적으로 이해하기 쉬운 선택입니다.

학습 포인트:
중앙의 막연한 균형보다 상대 확정가의 상한을 직접 낮추는 선수가 더 큰 순간을 구분해야 합니다.
```

---

## 강화 후 초중급자용 해설

```text
147수 K10은 완전히 이상한 수는 아니지만, 지금 가장 큰 곳을 놓친 수입니다.

이 장면에서는 중앙보다 좌상 쪽 백 집을 줄이는 일이 더 급했습니다. AI 추천수 C14는 백의 집이 커지는 것을 막으면서, 다음에도 흑이 계속 압박할 수 있는 수입니다. 반면 실전 K10은 중앙을 보는 수라서, 백의 좌상 집을 직접 줄이지 못했습니다.

쉽게 말하면, 흑은 “중앙을 넓게 보려는 수”를 뒀지만, 실제로는 “상대 집을 바로 줄이는 수”가 더 컸습니다.

학습 포인트:
상대 집이 커지려는 곳이 보이면, 막연히 중앙을 두기보다 먼저 그 집을 줄일 수 있는지 확인해 보세요.
```

---

## 대화형 Q&A 예시

사용자 질문:

```text
그럼 K10은 완전히 나쁜 수야?
```

답변:

```text
완전히 의미 없는 수는 아닙니다. K10은 중앙 균형을 의식한 수라서 방향 자체가 아주 틀렸다고 보기는 어렵습니다.

다만 이 장면에서는 중앙보다 좌상 C14가 더 급했습니다. C14는 백의 집 모양을 직접 낮추고, 이후 흑이 계속 압박할 수 있는 선수성이 있습니다. 그래서 K10의 문제는 “나쁜 곳에 둔 것”이라기보다, “더 급한 곳을 먼저 두지 못한 것”에 가깝습니다.
```

사용자 질문:

```text
D13은 어때?
```

답변:

```text
D13은 C14보다는 약간 느슨하지만, 인간적으로는 충분히 이해하기 쉬운 대안입니다.

C14가 백의 집 모양을 가장 직접적으로 낮추는 수라면, D13은 좌상 압박을 유지하면서 모양을 안정적으로 가져가는 수입니다. AI 최선수와 비교하면 약간 손해는 있지만, K10처럼 전장을 크게 벗어나지는 않기 때문에 실전 대안으로는 훨씬 좋습니다.
```

---

# 12. 최종 권장 개발 우선순위

## 1단계: 즉시 반영

```text
1. conceptTags 필드 추가
2. audienceLevel 필드 추가
3. candidateComparison 추가
4. LLM forbiddenClaims 추가
5. 검증 실패 시 template fallback 추가
```

## 2단계: Premium 차별화

```text
1. humanAlternative 추천
2. Learning Move 2~3개 추가
3. 대화형 Q&A
4. SGF comment export
5. ownership heatmap UI
```

## 3단계: 장기 강화

```text
1. 전문가 해설 데이터셋 구축
2. concept tag classifier 학습
3. 사용자 피드백 기반 설명 최적화
4. 다국어 바둑 용어 사전
5. 음성 코치
6. LoGos류 바둑 전문 LLM을 critic 또는 reranker로 실험
```

---

# 13. 최종 결론

첨부 보고서를 반영하면 카타톡 알고리즘은 충분히 더 강화할 수 있습니다.

가장 중요한 변경점은 **“패착을 찾아 설명하는 엔진”에서 “사용자 수준에 맞춰 이유를 가르치는 엔진”으로 확장하는 것**입니다.

최종 구조는 이렇게 정의하는 것이 가장 좋습니다.

```text
KataGo = 계산 엔진
BSI/ADI = 실수와 탐색 필요도 판단
Trajectory Analyzer = 대국 흐름상 핵심 장면 추출
Concept Tagger = 바둑 개념 변환기
Explanation Planner = 사용자 수준별 설명 설계자
LLM = 제한된 자연어 렌더러
Claim Verifier = 환각 차단기
Q&A Engine = 복기 교사 인터페이스
```

따라서 카타톡의 최종 경쟁력은 단순히 “KataGo를 붙인 LLM”이 아니라, **KataGo의 수치를 인간 바둑 개념으로 번역하고, 그 번역 결과를 사용자의 수준에 맞춰 검증된 자연어로 설명하는 하이브리드 튜터링 시스템**이 되는 것입니다.
