/**
 * Analysis result page copy + reason/SGF/vm warning translation (ko/en/ja/zh).
 * UI 레이어에서만 사용 — ViewModel은 code/key만 제공.
 */

import type { SgfPlaybackWarningV1 } from "./sgfPlaybackV1";

export type AnalysisResultLang = "ko" | "en" | "ja" | "zh";

export function normalizeAnalysisResultLang(lang: string | null | undefined): AnalysisResultLang {
  const l = (lang ?? "ko").toLowerCase();
  if (l === "en" || l === "ja" || l === "zh" || l === "ko") {
    return l;
  }
  return "ko";
}

function interp(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] !== undefined && params[key] !== null ? String(params[key]) : ""
  );
}

const FORBIDDEN_BY_LANG: Record<AnalysisResultLang, readonly string[]> = {
  ko: ["패착", "악수", "정답", "완착"],
  en: ["blunder", "mistake", "best move", "correct answer"],
  ja: ["悪手", "正解", "最善手"],
  zh: ["恶手", "正解", "最佳手"],
};

/** UI 노출 금지 단어 포함 여부 — 언어 지정 시에도 ko/en/ja/zh 금지어를 모두 검사(교차 노출 방지) */
export function uiTextContainsForbiddenLabel(text: string, _lang?: AnalysisResultLang): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  const langs: AnalysisResultLang[] = ["ko", "en", "ja", "zh"];
  for (const L of langs) {
    const hay = L === "en" ? t.toLowerCase() : t;
    for (const w of FORBIDDEN_BY_LANG[L]) {
      const needle = L === "en" ? w.toLowerCase() : w;
      if (hay.includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

const INTERNAL_SIGNAL: Record<AnalysisResultLang, string> = {
  ko: "내부 참고 신호",
  en: "Internal reference signal",
  zh: "内部参考信号",
  ja: "内部参照シグナル",
};

const REASON_CODE_I18N: Record<string, Record<AnalysisResultLang, string>> = {
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
  signal_high_adi: {
    ko: "추가 검토 필요도 높음",
    en: "Higher review priority (internal index)",
    zh: "复查优先度较高（内部指标）",
    ja: "再検討の優先度が高い（内部指標）",
  },
  signal_bsi: {
    ko: "수치 차이 감지",
    en: "Numeric spread detected",
    zh: "数值差异信号",
    ja: "数値差のシグナル",
  },
  played_candidate_rank_gap: {
    ko: "후보 순위 차이",
    en: "Candidate rank spread",
    zh: "候选排名差异",
    ja: "候補順位の差",
  },
};

const LEGACY_KO_PHRASES: Record<string, Record<AnalysisResultLang, string>> = {
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

function looksLikeReasonCodeToken(s: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(s.trim());
}

export function internalReferenceSignalLabel(lang: AnalysisResultLang): string {
  return INTERNAL_SIGNAL[lang];
}

export function mapReasonPhraseForUi(reason: string, lang: AnalysisResultLang): string {
  const r = reason.trim();
  const legacy = LEGACY_KO_PHRASES[r];
  if (legacy) {
    return legacy[lang];
  }
  const codeKey = r.toLowerCase();
  const codeRow = REASON_CODE_I18N[codeKey];
  if (codeRow) {
    return codeRow[lang];
  }
  if (looksLikeReasonCodeToken(r)) {
    return INTERNAL_SIGNAL[lang];
  }
  if (uiTextContainsForbiddenLabel(r, lang)) {
    return INTERNAL_SIGNAL[lang];
  }
  return r;
}

const SGF_WARN: Record<
  SgfPlaybackWarningV1["code"],
  Record<AnalysisResultLang, string>
> = {
  no_root: {
    ko: "루트 '(;' 를 찾지 못해 메인라인을 읽지 못했습니다.",
    en: "Could not find a root '(;' node; mainline was not parsed.",
    ja: "ルートの '(;' が見つからず、メインラインを読み取れませんでした。",
    zh: "未找到根节点 '(;'，无法解析主线。",
  },
  setup_markers_ignored: {
    ko: "AB[]/AW[]/AE[] 설치 표기를 확인했습니다.",
    en: "Setup markers (AB[]/AW[]/AE[]) were found.",
    ja: "AB[]/AW[]/AE[] の配置マーカーを確認しました。",
    zh: "检测到 AB[]/AW[]/AE[] 布局标记。",
  },
  setup_stones_applied: {
    ko: "초기 setup stones {count}개를 보드에 반영했습니다.",
    en: "Applied {count} initial setup stone(s) to the board.",
    ja: "初期 setup stones {count} 個を盤面に反映しました。",
    zh: "已将 {count} 个初始布局棋子应用到棋盘。",
  },
  setup_stone_conflict: {
    ko: "초기 setup stone 좌표가 중복 충돌했습니다({point}). 뒤에 나온 색을 적용했습니다.",
    en: "Initial setup stone conflict at {point}; the later color was applied.",
    ja: "初期 setup stone の座標が競合しました（{point}）。後の色を適用しました。",
    zh: "初始布局棋子坐标冲突（{point}）；已采用后出现的颜色。",
  },
  setup_after_move_unsupported: {
    ko: "첫 착수 이후의 AB[]/AW[]/AE[]는 v1에서 지원하지 않아 무시했습니다.",
    en: "AB[]/AW[]/AE[] after the first move is not supported in v1 and was ignored.",
    ja: "初手以降の AB[]/AW[]/AE[] は v1 では未対応のため無視しました。",
    zh: "第一手之后的 AB[]/AW[]/AE[] 在 v1 中不支持，已忽略。",
  },
  missing_ff_assumed_v4: {
    ko: "FF가 없어 FF[4]로 가정했습니다.",
    en: "FF is missing; assumed FF[4].",
    ja: "FF がないため FF[4] とみなしました。",
    zh: "缺少 FF；已按 FF[4] 处理。",
  },
  missing_gm_assumed_go: {
    ko: "GM이 없어 GM[1](Go)로 가정했습니다.",
    en: "GM is missing; assumed GM[1] (Go).",
    ja: "GM がないため GM[1]（囲碁）とみなしました。",
    zh: "缺少 GM；已按 GM[1]（围棋）处理。",
  },
  unsupported_game_type: {
    ko: "지원하지 않는 GM 값입니다({gm}). GM[1]만 지원합니다.",
    en: "Unsupported GM value ({gm}); only GM[1] is supported.",
    ja: "未対応の GM 値です（{gm}）。GM[1] のみ対応します。",
    zh: "不支持的 GM 值（{gm}）；仅支持 GM[1]。",
  },
  handicap_property_present: {
    ko: "HA handicap 속성이 있습니다. 실제 초기 돌 위치는 AB[]를 기준으로 반영합니다.",
    en: "HA handicap property is present; actual initial stones are taken from AB[].",
    ja: "HA handicap 属性があります。実際の初期石位置は AB[] を基準に反映します。",
    zh: "存在 HA handicap 属性；实际初始棋子位置以 AB[] 为准。",
  },
  unbalanced_parens: {
    ko: "괄호 균형이 맞지 않아 여기까지 파싱했습니다.",
    en: "Unbalanced parentheses; parsing stopped at this point.",
    ja: "括弧の対応が不十分なため、ここまで解析しました。",
    zh: "括号不平衡，解析在此停止。",
  },
  invalid_sz: {
    ko: "SZ 값이 비정상입니다({raw}). 19로 가정합니다.",
    en: "Invalid SZ value ({raw}); assuming 19.",
    ja: "SZ 値が不正です（{raw}）。19 とみなします。",
    zh: "SZ 值无效（{raw}），按 19 处理。",
  },
  sz_not_19: {
    ko: "SZ가 19가 아닙니다({size}). 좌표는 SGF 열·행 규칙 그대로입니다.",
    en: "SZ is not 19 ({size}). Coordinates follow raw SGF column/row letters.",
    ja: "SZ が 19 ではありません（{size}）。座標は SGF の列・行のままです。",
    zh: "SZ 不是 19（{size}）。坐标按 SGF 列/行规则。",
  },
  selected_turn_clamped_negative: {
    ko: "selectedTurnIndex가 음수여서 0으로 맞췄습니다.",
    en: "selectedTurnIndex was negative; clamped to 0.",
    ja: "selectedTurnIndex が負のため 0 に調整しました。",
    zh: "selectedTurnIndex 为负，已钳制为 0。",
  },
  selected_turn_clamped_high: {
    ko: "selectedTurnIndex가 메인라인 길이({max})를 넘어 맞췄습니다.",
    en: "selectedTurnIndex exceeded mainline length ({max}); clamped.",
    ja: "selectedTurnIndex がメインライン長（{max}）を超えたため調整しました。",
    zh: "selectedTurnIndex 超过主线长度（{max}），已钳制。",
  },
  invalid_point_format: {
    ko: "수 {turnIndex}: 착점 표기({point})를 해석하지 못해 건너뜁니다.",
    en: "Move {turnIndex}: could not parse coordinate ({point}); skipped.",
    ja: "手 {turnIndex}: 着手表記（{point}）を解釈できずスキップしました。",
    zh: "第 {turnIndex} 手：无法解析坐标（{point}），已跳过。",
  },
  coord_len_error: {
    ko: "수 {turnIndex}: 좌표 길이 오류({point}) — 건너뜀.",
    en: "Move {turnIndex}: coordinate length error ({point}) — skipped.",
    ja: "手 {turnIndex}: 座標長エラー（{point}）— スキップ。",
    zh: "第 {turnIndex} 手：坐标长度错误（{point}）— 已跳过。",
  },
  coord_out_of_range: {
    ko: "수 {turnIndex}: 좌표 범위 밖({point}) — 건너뜀.",
    en: "Move {turnIndex}: coordinate out of range ({point}) — skipped.",
    ja: "手 {turnIndex}: 座標が範囲外（{point}）— スキップ。",
    zh: "第 {turnIndex} 手：坐标越界（{point}）— 已跳过。",
  },
  duplicate_move: {
    ko: "수 {turnIndex}: 이미 돌이 있는 교차점({point}) — 덮어쓰지 않고 건너뜀.",
    en: "Move {turnIndex}: intersection already occupied ({point}) — skipped without overwrite.",
    ja: "手 {turnIndex}: 交点に既に石があります（{point}）— 上書きせずスキップ。",
    zh: "第 {turnIndex} 手：交叉点已有棋子（{point}）— 未覆盖，已跳过。",
  },
  variation_branch_skipped: {
    ko: "변화도 블록 {count}개는 v1에서 건너뛰었습니다(메인라인만).",
    en: "Skipped {count} variation branch(es); v1 uses mainline only.",
    ja: "変化図 {count} 件は v1 ではスキップしました（メインラインのみ）。",
    zh: "已跳过 {count} 个变化图分支；v1 仅使用主线。",
  },
  unclosed_property: {
    ko: "속성 값의 대괄호가 닫히지 않아 인덱스 {at} 근처에서 복구했습니다.",
    en: "Unclosed property bracket; recovered near position {at}.",
    ja: "プロパティの括弧が閉じていません（位置 {at} 付近）。",
    zh: "属性方括号未闭合，在位置 {at} 附近恢复解析。",
  },
  suicide_not_fully_handled_v1: {
    ko: "수 {turnIndex}: 착수 후 자기 돌 연결군에 호가 없을 수 있습니다. v1은 ko/자살을 완전히 판정하지 않습니다.",
    en: "Move {turnIndex}: the placed group may have no liberties; ko/suicide are not fully ruled in v1.",
    ja: "手 {turnIndex}: 着手後の連に呼吸がない可能性があります。v1 ではコウ/自殺手を完全には扱いません。",
    zh: "第 {turnIndex} 手：落子后己方块可能无气；v1 不完整处理劫/自杀。",
  },
};

export function translateSgfPlaybackWarning(warning: SgfPlaybackWarningV1, lang: AnalysisResultLang): string {
  const row = SGF_WARN[warning.code];
  if (!row) {
    return warning.code;
  }
  return interp(row[lang], warning.params);
}

const VM_WARN: Record<string, Record<AnalysisResultLang, string>> = {
  beta_numeric_reference: {
    ko: "현재 결과는 KataGo 수치 기반 베타 참고 정보이며, 수순에 대한 최종 판단이나 해설은 제공하지 않습니다.",
    en: "Beta numeric reference from KataGo — no final judgment or move-by-move teaching text.",
    ja: "KataGo 数値ベータの参考情報であり、各手の最終判断や解説テキストは提供しません。",
    zh: "当前为 KataGo 数值型内测参考信息，不提供对每手的最终判断或讲解文本。",
  },
  mock_demo_disclaimer: {
    ko: "이 결과는 mock/데모용 JSON일 수 있으며, 운영 KataGo 분석과 다릅니다. 단정적인 기보·평가 해석으로 사용하지 마세요.",
    en: "This payload may be mock/demo JSON and differs from production KataGo output. Do not treat it as authoritative game commentary.",
    ja: "この結果は mock/デモ用 JSON の可能性があり、本番の KataGo 解析と異なります。断定的な棋譜・評価として扱わないでください。",
    zh: "此结果可能为 mock/演示 JSON，与线上 KataGo 分析不同。请勿当作定论棋谱或评价。",
  },
  unknown_result_format: {
    ko: "지원하지 않는 결과 형식입니다.",
    en: "Unsupported result format.",
    ja: "未対応の結果形式です。",
    zh: "不支持的结果格式。",
  },
};

export function translateVmWarning(
  warning: { code: string; params?: Record<string, string | number> },
  lang: AnalysisResultLang
): string {
  const row = VM_WARN[warning.code];
  if (!row) {
    return warning.code;
  }
  return interp(row[lang], warning.params);
}

const PLACEHOLDER: Record<string, Record<AnalysisResultLang, string>> = {
  sgf_ph_no_source: {
    ko: "SGF 원문(sgf_content)이 결과에 없어 재생 ViewModel을 만들 수 없습니다. DB·별도 API에서 로드하는 경우 필드에 포함하세요.",
    en: "No SGF text (sgf_content) in the result, so a playback view model cannot be built. Include the field when loading from a DB or another API.",
    ja: "結果に SGF 本文（sgf_content）がないため再生 ViewModel を作成できません。DB などから読み込む場合はフィールドを含めてください。",
    zh: "结果中缺少 SGF 正文（sgf_content），无法构建回放视图模型。从数据库或其他接口加载时请包含该字段。",
  },
  sgf_ph_mock_scope: {
    ko: "mock 결과에서는 ViewModel이 후보/PV를 노출하지 않습니다.",
    en: "Mock results do not expose candidates/PV in this view model.",
    ja: "mock 結果ではこの ViewModel は候補/PV を表示しません。",
    zh: "mock 结果不在此视图模型中展示候选/PV。",
  },
  sgf_ph_unknown: {
    ko: "형식을 확인한 뒤 파서를 확장하세요.",
    en: "Verify the format, then extend the parser as needed.",
    ja: "形式を確認し、必要に応じてパーサを拡張してください。",
    zh: "请确认格式后按需扩展解析器。",
  },
};

export function translatePlaceholderMessageKey(key: string, lang: AnalysisResultLang): string {
  const row = PLACEHOLDER[key];
  if (!row) {
    return key;
  }
  return row[lang];
}

const LABEL_KEYS: Record<string, Record<AnalysisResultLang, string>> = {
  ar_label_review_candidate: {
    ko: "검토 후보",
    en: "Review candidate",
    ja: "検討候補",
    zh: "复核候选",
  },
  ar_label_followup_candidate: {
    ko: "추가 분석 후보",
    en: "Further analysis candidate",
    ja: "追加解析候補",
    zh: "进一步分析候选",
  },
  ar_label_large_delta: {
    ko: "변화가 큰 장면",
    en: "Large numeric swing",
    ja: "変化が大きい局面",
    zh: "变化较大的局面",
  },
  ar_label_played_vs_candidate_gap: {
    ko: "실전수와 후보수 차이가 큰 장면",
    en: "Large gap between played move and top candidates",
    ja: "実戦手と候補手の差が大きい局面",
    zh: "实战手与候选手差异较大的局面",
  },
};

export function translateCandidateLabelKey(key: string, lang: AnalysisResultLang): string {
  const row = LABEL_KEYS[key];
  if (!row) {
    return key;
  }
  return row[lang];
}

/** Winrate chart axis labels — keyed by `WinrateNormalizedV1.displayLabelKey` */
const WINRATE_DISPLAY_LABEL_KEYS: Record<string, Record<AnalysisResultLang, string>> = {
  katagoOutputWinrate: {
    ko: "KataGo 기준 승률 (%)",
    en: "KataGo output winrate (%)",
    ja: "KataGo 出力の勝率 (%)",
    zh: "KataGo 输出胜率 (%)",
  },
};

export function translateWinrateDisplayLabelKey(key: string, lang: AnalysisResultLang): string {
  const row = WINRATE_DISPLAY_LABEL_KEYS[key];
  if (!row) {
    return key;
  }
  return row[lang];
}

type UiBlock = {
  summaryStatusComplete: string;
  summaryTitle: string;
  betaNote: string;
  engine: string;
  totalMoves: string;
  flagsSectionTitle: string;
  flagMT: string;
  flagBSI: string;
  flagADI: string;
  flagDSP: string;
  flagDSR: string;
  deepSearchRowTitle: string;
  dsOn: string;
  dsOff: string;
  yesShort: string;
  noShort: string;
  mockBanner: string;
  unknownBanner: string;
  boardTitle: string;
  boardBadge: string;
  boardPhGrid: string;
  boardSnapshotHint: string;
  boardDebugOrder: string;
  boardDebugLast: string;
  boardDebugStones: string;
  boardDebugSz: string;
  boardNoLast: string;
  boardAriaSnapshot: string;
  boardViewOnlyNote: string;
  navAriaToolbar: string;
  navFirst: string;
  navPrev: string;
  navNext: string;
  navEnd: string;
  navTurnCounter: string;
  navSliderAria: string;
  navKeyboardHint: string;
  navEmptyMainline: string;
  boardGhostLegend: string;
  boardGhostLegendFallback: string;
  boardGhostPvLegend: string;
  boardGhostPvLegendFallback: string;
  winrateTitle: string;
  winrateYAxis: string;
  winrateEmpty: string;
  winrateToggleNote: string;
  winratePerspectiveNote: string;
  winrateFullTimelineNote: string;
  winrateClickHint: string;
  chartAriaTurn: string;
  candidatesTitle: string;
  candidatesEmpty: string;
  playedMove: string;
  candidateMove: string;
  bsi: string;
  adi: string;
  dsSelected: string;
  dsCompleted: string;
  candidateSelected: string;
  variationTitle: string;
  variationSubDeep: string;
  variationSubMulti: string;
  variationEmpty: string;
  variationTurn: string;
  variationPlayed: string;
  variationCandidate: string;
  variationPvDisclaimer: string;
};

const UI: Record<AnalysisResultLang, UiBlock> = {
  ko: {
    summaryStatusComplete: "분석 완료",
    summaryTitle: "분석 요약",
    betaNote:
      "현재 결과는 KataGo 수치 기반 베타 참고 정보이며, 수순에 대한 최종 판단이나 해설은 제공하지 않습니다.",
    engine: "엔진",
    totalMoves: "총 수순",
    flagsSectionTitle: "신호·플랜",
    flagMT: "Multi-turn",
    flagBSI: "BSI",
    flagADI: "ADI",
    flagDSP: "Deep Search Plan",
    flagDSR: "Deep Search Results",
    deepSearchRowTitle: "Deep Search",
    dsOn: "Deep Search 실행됨",
    dsOff: "Deep Search 미실행(요약만)",
    yesShort: "예",
    noShort: "아니오",
    mockBanner: "데모용 예시 결과입니다. 실제 KataGo 분석 결과가 아닙니다.",
    unknownBanner: "지원하지 않는 결과 형식입니다.",
    boardTitle: "바둑판",
    boardBadge: "보기 전용 · v1",
    boardPhGrid: "SGF 원문이 없어 바둑판을 표시할 수 없습니다.",
    boardSnapshotHint: "선택한 수순까지의 메인라인 국면입니다(착수 불가).",
    boardAriaSnapshot: "바둑판 국면 스냅샷",
    boardViewOnlyNote: "보기 전용 — 착수·변화도 탐색은 지원하지 않습니다.",
    navAriaToolbar: "수순 탐색",
    navFirst: "처음",
    navPrev: "이전",
    navNext: "다음",
    navEnd: "끝",
    navTurnCounter: "{current} / {total}",
    navSliderAria: "수순 슬라이더",
    navKeyboardHint: "←/→ 수순 · Home/End 처음/끝 (보기 전용)",
    navEmptyMainline: "메인라인 수가 없어 수순 탐색을 사용할 수 없습니다.",
    boardGhostLegend: "반투명 마커: 참고 후보수",
    boardGhostLegendFallback: "반투명 마커: 참고 좌표",
    boardGhostPvLegend: "KataGo 참고도(PV) 첫 수",
    boardGhostPvLegendFallback: "참고도 첫 수",
    boardDebugOrder: "현재 수순(메인라인)",
    boardDebugLast: "마지막 착수(GTP)",
    boardDebugStones: "돌 개수",
    boardDebugSz: "보드 크기(SZ)",
    boardNoLast: "(없음 — 패스만 또는 초기)",
    winrateTitle: "승률 / 흐름",
    winrateYAxis: "KataGo 기준 승률 (%)",
    winrateEmpty: "표시할 승률 추이가 없습니다.",
    winrateToggleNote: "흑/백 관점 전환 — 준비 중",
    winratePerspectiveNote: "KataGo 출력 관점이며 흑/백 고정 해석이 아닙니다.",
    winrateFullTimelineNote: "메인라인 전체 수순 흐름(KataGo timeline 분석 출력).",
    winrateClickHint: "점을 눌러 해당 수순을 선택할 수 있습니다.",
    chartAriaTurn: "수",
    candidatesTitle: "핵심 검토 후보",
    candidatesEmpty: "표시할 검토 후보가 없습니다.",
    playedMove: "실전수",
    candidateMove: "후보수",
    bsi: "BSI",
    adi: "ADI",
    dsSelected: "Deep Search 선택",
    dsCompleted: "Deep Search 완료",
    candidateSelected: "선택됨",
    variationTitle: "KataGo 참고도",
    variationSubDeep: "Deep Search 참고도",
    variationSubMulti: "Multi-turn 참고도",
    variationEmpty: "표시할 참고도 없음",
    variationTurn: "수순",
    variationPlayed: "실전수",
    variationCandidate: "후보수",
    variationPvDisclaimer: "참고 변화(PV)이며 유일한 진행으로 단정하지 않습니다.",
  },
  en: {
    summaryStatusComplete: "Analysis complete",
    summaryTitle: "Analysis summary",
    betaNote: "Beta numeric reference from KataGo — no final judgment or move-by-move teaching text.",
    engine: "Engine",
    totalMoves: "Total moves",
    flagsSectionTitle: "Signals / plan",
    flagMT: "Multi-turn",
    flagBSI: "BSI",
    flagADI: "ADI",
    flagDSP: "Deep Search Plan",
    flagDSR: "Deep Search Results",
    deepSearchRowTitle: "Deep Search",
    dsOn: "Deep Search ran",
    dsOff: "Deep Search off (summary only)",
    yesShort: "Yes",
    noShort: "No",
    mockBanner: "Demo sample result — not a live KataGo analysis output.",
    unknownBanner: "Unsupported result format.",
    boardTitle: "Board",
    boardBadge: "View only · v1",
    boardPhGrid: "No SGF text — board cannot be shown.",
    boardSnapshotHint: "Mainline position up to the selected move (no placing stones).",
    boardAriaSnapshot: "Go board position snapshot",
    boardViewOnlyNote: "View only — no moves or variation browsing.",
    navAriaToolbar: "Move navigation",
    navFirst: "Start",
    navPrev: "Previous",
    navNext: "Next",
    navEnd: "End",
    navTurnCounter: "{current} / {total}",
    navSliderAria: "Move index slider",
    navKeyboardHint: "←/→ moves · Home/End start/end (view only)",
    navEmptyMainline: "No mainline moves — turn navigation is unavailable.",
    boardGhostLegend: "Faded markers: reference candidate moves",
    boardGhostLegendFallback: "Faded markers: reference coordinates",
    boardGhostPvLegend: "KataGo reference line (PV) first move",
    boardGhostPvLegendFallback: "Reference line first move",
    boardDebugOrder: "Current move index (mainline)",
    boardDebugLast: "Last stone (GTP)",
    boardDebugStones: "Stone count",
    boardDebugSz: "Board size (SZ)",
    boardNoLast: "(none — pass only or empty)",
    winrateTitle: "Winrate / flow",
    winrateYAxis: "KataGo output winrate (%)",
    winrateEmpty: "No winrate series to display.",
    winrateToggleNote: "Black/white perspective — coming soon",
    winratePerspectiveNote: "Shown as KataGo output; not fixed as black-only or white-only winrate.",
    winrateFullTimelineNote: "Full mainline flow (KataGo timeline analysis output).",
    winrateClickHint: "Click a point to select that move index.",
    chartAriaTurn: "Move",
    candidatesTitle: "Key review candidates",
    candidatesEmpty: "No review candidates to show.",
    playedMove: "Played move",
    candidateMove: "Top candidate",
    bsi: "BSI",
    adi: "ADI",
    dsSelected: "Deep Search selected",
    dsCompleted: "Deep Search completed",
    candidateSelected: "Selected",
    variationTitle: "KataGo reference line",
    variationSubDeep: "Deep Search reference line",
    variationSubMulti: "Multi-turn reference line",
    variationEmpty: "No reference line to show",
    variationTurn: "Move",
    variationPlayed: "Played",
    variationCandidate: "Candidate",
    variationPvDisclaimer: "Reference PV only — not a single authoritative continuation.",
  },
  ja: {
    summaryStatusComplete: "解析完了",
    summaryTitle: "分析サマリ",
    betaNote: "KataGo 数値ベータの参考情報であり、各手の最終判断や解説テキストは提供しません。",
    engine: "エンジン",
    totalMoves: "総手数",
    flagsSectionTitle: "シグナル/プラン",
    flagMT: "Multi-turn",
    flagBSI: "BSI",
    flagADI: "ADI",
    flagDSP: "Deep Search Plan",
    flagDSR: "Deep Search Results",
    deepSearchRowTitle: "Deep Search",
    dsOn: "Deep Search 実行",
    dsOff: "Deep Search オフ（要約のみ）",
    yesShort: "はい",
    noShort: "いいえ",
    mockBanner: "デモ用のサンプルで、本番の KataGo 解析ではありません。",
    unknownBanner: "未対応の結果形式です。",
    boardTitle: "碁盤",
    boardBadge: "閲覧のみ · v1",
    boardPhGrid: "SGF 本文がないため盤面を表示できません。",
    boardSnapshotHint: "選択手数までのメインライン局面です（着手不可）。",
    boardAriaSnapshot: "碁盤局面スナップショット",
    boardViewOnlyNote: "閲覧のみ — 着手・変化図の探索は未対応です。",
    navAriaToolbar: "手数ナビ",
    navFirst: "最初",
    navPrev: "前へ",
    navNext: "次へ",
    navEnd: "最後",
    navTurnCounter: "{current} / {total}",
    navSliderAria: "手数スライダー",
    navKeyboardHint: "←/→ 手数 · Home/End 最初/最後（閲覧のみ）",
    navEmptyMainline: "メインラインの手がありません — 手数ナビは使用できません。",
    boardGhostLegend: "半透明マーカー: 参考候補手",
    boardGhostLegendFallback: "半透明マーカー: 参考座標",
    boardGhostPvLegend: "KataGo 参考図(PV)の初手",
    boardGhostPvLegendFallback: "参考図の初手",
    boardDebugOrder: "現在の手数（メインライン）",
    boardDebugLast: "最終着手（GTP）",
    boardDebugStones: "石の数",
    boardDebugSz: "盤サイズ（SZ）",
    boardNoLast: "（なし — pass のみまたは空）",
    winrateTitle: "勝率 / 推移",
    winrateYAxis: "KataGo 出力の勝率 (%)",
    winrateEmpty: "表示できる勝率系列がありません。",
    winrateToggleNote: "黒白視点の切替 — 準備中",
    winratePerspectiveNote: "KataGo 出力の視点であり、黒または白の固定解釈ではありません。",
    winrateFullTimelineNote: "メインライン全手の推移（KataGo timeline 分析出力）。",
    winrateClickHint: "点をクリックして手数を選べます。",
    chartAriaTurn: "手",
    candidatesTitle: "主要な検討候補",
    candidatesEmpty: "表示する検討候補がありません。",
    playedMove: "実戦手",
    candidateMove: "候補手",
    bsi: "BSI",
    adi: "ADI",
    dsSelected: "Deep Search 選択",
    dsCompleted: "Deep Search 完了",
    candidateSelected: "選択中",
    variationTitle: "KataGo 参照",
    variationSubDeep: "Deep Search 参照",
    variationSubMulti: "Multi-turn 参照",
    variationEmpty: "表示する参考がありません",
    variationTurn: "手数",
    variationPlayed: "実戦手",
    variationCandidate: "候補手",
    variationPvDisclaimer: "参考用の変化（PV）であり、単一の断定手順としては扱いません。",
  },
  zh: {
    summaryStatusComplete: "分析完成",
    summaryTitle: "分析摘要",
    betaNote: "当前为 KataGo 数值型内测参考信息，不提供对每手的最终判断或讲解文本。",
    engine: "引擎",
    totalMoves: "总手数",
    flagsSectionTitle: "信号与计划",
    flagMT: "Multi-turn",
    flagBSI: "BSI",
    flagADI: "ADI",
    flagDSP: "Deep Search Plan",
    flagDSR: "Deep Search Results",
    deepSearchRowTitle: "Deep Search",
    dsOn: "已运行 Deep Search",
    dsOff: "Deep Search 关闭（仅摘要）",
    yesShort: "是",
    noShort: "否",
    mockBanner: "演示用示例，不是真实 KataGo 分析结果。",
    unknownBanner: "不支持的结果格式。",
    boardTitle: "棋盘",
    boardBadge: "仅查看 · v1",
    boardPhGrid: "无 SGF 正文，无法显示棋盘。",
    boardSnapshotHint: "至所选手数的主线局面（不可落子）。",
    boardAriaSnapshot: "棋盘局面快照",
    boardViewOnlyNote: "仅查看 — 不支持落子或变化图浏览。",
    navAriaToolbar: "手数导航",
    navFirst: "开头",
    navPrev: "上一手",
    navNext: "下一手",
    navEnd: "末尾",
    navTurnCounter: "{current} / {total}",
    navSliderAria: "手数滑块",
    navKeyboardHint: "←/→ 手数 · Home/End 首尾（仅查看）",
    navEmptyMainline: "主线无手 — 无法使用手数导航。",
    boardGhostLegend: "半透明标记：参考候选手",
    boardGhostLegendFallback: "半透明标记：参考坐标",
    boardGhostPvLegend: "KataGo 参考图(PV)第一手",
    boardGhostPvLegendFallback: "参考图第一手",
    boardDebugOrder: "当前手数（主线）",
    boardDebugLast: "最后一手（GTP）",
    boardDebugStones: "棋子数",
    boardDebugSz: "棋盘大小（SZ）",
    boardNoLast: "（无实子 — 仅 pass 或空）",
    winrateTitle: "胜率 / 走势",
    winrateYAxis: "KataGo 输出胜率 (%)",
    winrateEmpty: "没有可显示的胜率序列。",
    winrateToggleNote: "黑/白视角 — 准备中",
    winratePerspectiveNote: "为 KataGo 输出视角，不作黑方或白方固定解读。",
    winrateFullTimelineNote: "主线全盘走势（KataGo timeline 分析输出）。",
    winrateClickHint: "点击节点可选择对应手数。",
    chartAriaTurn: "手",
    candidatesTitle: "重点复核候选",
    candidatesEmpty: "没有可显示的复核候选。",
    playedMove: "实战手",
    candidateMove: "候选手",
    bsi: "BSI",
    adi: "ADI",
    dsSelected: "Deep Search 已选",
    dsCompleted: "Deep Search 已完成",
    candidateSelected: "已选择",
    variationTitle: "KataGo 参考图",
    variationSubDeep: "Deep Search 参考",
    variationSubMulti: "Multi-turn 参考",
    variationEmpty: "无参考变化可显示",
    variationTurn: "手数",
    variationPlayed: "实战手",
    variationCandidate: "候选手",
    variationPvDisclaimer: "仅为参考变化（PV），不作为唯一权威应手序列。",
  },
};

export function getAnalysisResultUiStrings(lang: AnalysisResultLang): UiBlock {
  return UI[lang];
}
