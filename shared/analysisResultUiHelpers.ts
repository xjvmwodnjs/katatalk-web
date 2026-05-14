/**
 * Analysis Result Page UI v1 — 순수 문자열/필터 헬퍼 (LLM·top_mistakes 생성 없음).
 */

const FORBIDDEN_UI = ["패착", "악수", "정답", "완착"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** UI 노출 금지 단어 포함 여부 */
export function uiTextContainsForbiddenLabel(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  return FORBIDDEN_UI.some((w) => t.includes(w));
}

const REASON_CODE_I18N: Record<string, Record<"ko" | "en" | "zh" | "ja", string>> = {
  high_adi: {
    ko: "추가 검토 필요도 높음",
    en: "Higher review priority (internal index)",
    zh: "复查优先度较高（内部指标）",
    ja: "再検討の優先度が高い（内部指標）",
  },
  deep_search_flag: {
    ko: "추가 분석 후보",
    en: "Further analysis candidate",
    zh: "进一步分析候选",
    ja: "追加解析の候補",
  },
  meaningful_bsi: {
    ko: "수치 차이 감지",
    en: "Numeric spread detected",
    zh: "数值差异信号",
    ja: "数値差のシグナル",
  },
  rare_user_move: {
    ko: "후보 분포와 다른 실전수",
    en: "Played move unlike candidate spread",
    zh: "与候选分布不同的实战手",
    ja: "候補分布と異なる実戦手",
  },
  partial_signal: {
    ko: "일부 신호 감지",
    en: "Partial signal detected",
    zh: "部分信号",
    ja: "一部シグナル",
  },
  high_rank_instability: {
    ko: "후보 간 차이 작음",
    en: "Small spread among top candidates",
    zh: "前列候选差异较小",
    ja: "上位候補間の差が小さい",
  },
  qualified: {
    ko: "검토 조건 충족",
    en: "Review criteria met",
    zh: "满足复核条件",
    ja: "検討条件を満たす",
  },
  multi_signal: {
    ko: "일부 신호 감지",
    en: "Multiple partial signals",
    zh: "多重部分信号",
    ja: "複数の部分シグナル",
  },
};

function looksLikeReasonCodeToken(s: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(s.trim());
}

const INTERNAL_SIGNAL: Record<"ko" | "en" | "zh" | "ja", string> = {
  ko: "내부 참고 신호",
  en: "Internal signal",
  zh: "内部参考",
  ja: "内部シグナル",
};

/** reason 원문 → 중립 표시 문구 (한국어 우선, en/zh/ja 최소) */
export function mapReasonPhraseForUi(reason: string, lang: "ko" | "en" | "zh" | "ja"): string {
  const r = reason.trim();
  const table: Record<string, Record<"ko" | "en" | "zh" | "ja", string>> = {
    "높은 ADI": {
      ko: "추가 검토 필요도 높음",
      en: "Higher review priority (internal index)",
      zh: "复查优先度较高（内部指标）",
      ja: "再検討の優先度が高い（内部指標）",
    },
    "BSI 신호": {
      ko: "수치 차이 감지",
      en: "Numeric spread detected",
      zh: "数值差异信号",
      ja: "数値差のシグナル",
    },
    "실전수 후보 순위 낮음": {
      ko: "후보 순위 차이",
      en: "Candidate rank spread",
      zh: "候选排名差异",
      ja: "候補順位の差",
    },
  };
  const row = table[r];
  if (row) {
    return row[lang];
  }
  const codeKey = r.toLowerCase();
  const codeRow = REASON_CODE_I18N[codeKey];
  if (codeRow) {
    return codeRow[lang];
  }
  if (looksLikeReasonCodeToken(r)) {
    return INTERNAL_SIGNAL[lang];
  }
  if (uiTextContainsForbiddenLabel(r)) {
    return INTERNAL_SIGNAL[lang];
  }
  return r;
}

/** `analysisPlan` 기준 final_position 턴은 카드에서 제외(이중 방어) */
export function isFinalPositionTurnFromRaw(raw: unknown, turnIndex: number): boolean {
  if (!isPlainObject(raw)) {
    return false;
  }
  const ap = raw.analysisPlan;
  if (!isPlainObject(ap)) {
    return false;
  }
  const turns = ap.candidateTurns;
  if (!Array.isArray(turns)) {
    return false;
  }
  for (const row of turns) {
    if (!isPlainObject(row)) {
      continue;
    }
    if (row.turnIndex === turnIndex && row.reason === "final_position") {
      return true;
    }
  }
  return false;
}
