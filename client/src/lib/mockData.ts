// =============================================================
// Design: "바둑판 위의 데이터 연구소" — SaaS Edition
// i18n + 데모용 mock 리포트(실제 분석과 다를 수 있음 — KataGo 수치·PV 베타 중심)
// =============================================================

export type Player = "B" | "W";

export interface Mistake {
  turn: number;
  player: Player;
  zone: Record<Language, string>;
  winrate_drop_percent: number;
  llm_explanation: Record<Language, string>;
  pv: string[];
}

export interface AnalysisReport {
  game_info: {
    black_player: string;
    white_player: string;
    date: string;
    total_moves: number;
    result: Record<Language, string>;
    komi: number;
    final_winrate_black: number;
  };
  top_mistakes: Mistake[];
}

export const MOCK_DATA: AnalysisReport = {
  game_info: {
    black_player: "김민준 (3단)",
    white_player: "이서연 (2단)",
    date: "2026-05-10",
    total_moves: 212,
    result: { ko: "흑 불계승", en: "Black wins by resignation", zh: "黑中盘胜", ja: "黒中押し勝ち" },
    komi: 6.5,
    final_winrate_black: 78.3,
  },
  top_mistakes: [
    {
      turn: 45,
      player: "B",
      zone: { ko: "우상귀", en: "Upper-right corner", zh: "右上角", ja: "右上隅" },
      winrate_drop_percent: 21.5,
      llm_explanation: {
        ko: "[데모] 승률 변화를 보여 주기 위한 예시 문장입니다. 자연어 해설·패착 확정은 제공하지 않으며, 운영 분석은 KataGo 수치·PV·내부 신호(BSI/ADI/deepSearchPlan 후보) 중심입니다.",
        en: "[Demo] Sample copy to illustrate a winrate swing. We do not provide natural-language commentary or blunder verdicts; live output is KataGo numeric/PV plus internal signals (BSI/ADI/deepSearchPlan candidates).",
        zh: "[演示] 用于展示胜率变化的示例文案。不提供自然语言解说或败着判定；线上结果为 KataGo 数值/PV 及内部信号（BSI/ADI/deepSearchPlan 候选）。",
        ja: "[デモ] 勝率変化を示すためのサンプル文です。自然言語解説や悪手断定は行わず、本番は KataGo 数値・PV と内部シグナル（BSI/ADI/deepSearchPlan 候補）が中心です。",
      },
      pv: ["P16", "O15", "Q15", "R15", "P15"],
    },
    {
      turn: 78,
      player: "W",
      zone: { ko: "하변 중앙", en: "Lower center", zh: "下边中央", ja: "下辺中央" },
      winrate_drop_percent: 15.2,
      llm_explanation: {
        ko: "[데모] 두 번째 예시 구간입니다. 아래 텍스트는 제품 기능을 암시하지 않으며, BSI/ADI/deepSearchPlan 은 내부 분석 신호·후보 선정 수준입니다.",
        en: "[Demo] Second sample row. Text does not imply shipped features; BSI/ADI/deepSearchPlan are internal signals / candidate selection only.",
        zh: "[演示] 第二段示例。下文不代表已上线能力；BSI/ADI/deepSearchPlan 仅为内部信号与候选。",
        ja: "[デモ] 2件目のサンプル。本文は提供機能を保証せず、BSI/ADI/deepSearchPlan は内部シグナル／候補選定レベルです。",
      },
      pv: ["K4", "J5", "L4", "M4", "K5"],
    },
    {
      turn: 112,
      player: "B",
      zone: { ko: "좌변", en: "Left side", zh: "左边", ja: "左辺" },
      winrate_drop_percent: 11.8,
      llm_explanation: {
        ko: "[데모] 세 번째 예시입니다. Deep Search 실행·LLM 해설·Q&A 는 현재 저장소 범위에 포함되지 않습니다.",
        en: "[Demo] Third sample. Deep Search execution, LLM commentary, and Q&A are out of scope for this repo today.",
        zh: "[演示] 第三条示例。Deep Search 执行、LLM 解说与问答不在当前仓库范围内。",
        ja: "[デモ] 3件目。Deep Search 実行・LLM 解説・Q&A は現時点のリポジトリ範囲外です。",
      },
      pv: ["D10", "C10", "E10", "D9", "E9"],
    },
    {
      turn: 155,
      player: "W",
      zone: { ko: "중앙", en: "Center", zh: "中腹", ja: "中央" },
      winrate_drop_percent: 9.4,
      llm_explanation: {
        ko: "[데모] 네 번째 예시입니다. 승률·PV 는 KataGo 엔진 산출을 바탕으로 한 참고 수치이며, 최종 판단을 대신하지 않습니다.",
        en: "[Demo] Fourth sample. Winrate/PV are engine-derived references, not a substitute for human judgment.",
        zh: "[演示] 第四条示例。胜率/PV 为引擎参考值，不能替代人工作出结论。",
        ja: "[デモ] 4件目。勝率・PV はエンジン由来の参考値であり、最終判断の代替ではありません。",
      },
      pv: ["J10", "K10", "H10", "G10", "J11"],
    },
  ],
};

// ─────────────────────────────────────────────
// Complete i18n Translation Object
// ─────────────────────────────────────────────
export type Language = "ko" | "en" | "zh" | "ja";

export interface Translations {
  // Header & Nav
  brandName: string;
  login: string;
  signup: string;
  subscribe: string;
  logout: string;
  logoutSuccess: string;
  loginRequired: string;
  myProfile: string;
  
  // Hero / Upload
  heroTitle: string;
  heroSubtitle: string;
  uploadTitle: string;
  uploadDescription: string;
  uploadButton: string;
  uploadDragDrop: string;
  uploadFormats: string;
  analyzing: string;
  
  // Report
  title: string;
  subtitle: string;
  gameInfo: string;
  blackPlayer: string;
  whitePlayer: string;
  date: string;
  totalMoves: string;
  result: string;
  komi: string;
  finalWinrate: string;
  topMistakes: string;
  mistakeCount: string;
  turn: string;
  black: string;
  white: string;
  winrateDrop: string;
  aiExplanation: string;
  viewPV: string;
  hidePV: string;
  pvTitle: string;
  pvDescription: string;
  analysisBy: string;
  uploadNew: string;
  moves: string;
  backToUpload: string;
  /** 데/mock 리포트 상단 안내 — 실제 KataGo 결과와 구분 */
  reportDemoNotice: string;

  // Severity
  severity: {
    critical: string;
    major: string;
    moderate: string;
  };
  
  // Pricing
  pricingTitle: string;
  pricingSubtitle: string;
  pricingCheckoutButton: string;
  pricingCheckoutUrlError: string;
  creditRefundPolicyAck: string;
  /** 크레딧 팩 이름 (Starter / Standard / Pro 등) */
  creditPackStarter: string;
  creditPackStandard: string;
  creditPackPro: string;
  creditsUnit: string;
  pricingPriceCheckoutNote: string;
  creditBulletPerSgf: string;
  creditBulletBalancePersistent: string;
  creditRefundMustAgree: string;
  creditCheckoutLoginTitle: string;
  creditCheckoutLoginDesc: string;
  creditCheckoutLoginCta: string;
  pricingCheckoutFailedTitle: string;
  pricingCheckoutFailedDesc: string;
  pricingCheckoutServerErrorDetail: string;
  pricingNetworkError: string;
  pricingCheckoutRedirecting: string;
  pricing401Description: string;
  billingPaidTitle: string;
  billingCreditsAppliedNotice: string;
  billingCreditDelayedMessage: string;
  billingCreditPendingNeutralTitle: string;
  billingCreditPendingNeutralDesc: string;
  billingCreditMaybeAppliedTitle: string;
  billingCreditMaybeAppliedDesc: string;
  billingCreditsCheckFail: string;
  billingCreditsRefreshError: string;
  billingCancelled: string;
  free: string;
  basic: string;
  premium: string;
  perMonth: string;
  currentPlan: string;
  choosePlan: string;
  popular: string;
  pricingFeatures: {
    free: string[];
    basic: string[];
    premium: string[];
  };
  
  // Profile summary
  profilePlan: string;
  profileRemaining: string;
  profileUsed: string;
  
  // Footer
  footerPowered: string;
  footerDisclaimer: string;
}

export const TRANSLATIONS: Record<Language, Translations> = {
  ko: {
    brandName: "KataTalk (베타)",
    login: "로그인",
    signup: "회원가입",
    subscribe: "크레딧 충전",
    logout: "로그아웃",
    logoutSuccess: "로그아웃 되었습니다.",
    loginRequired: "로그인이 필요합니다.",
    myProfile: "내 프로필",
    
    heroTitle: "KataGo 기반 기보 분석 (베타)",
    heroSubtitle: "SGF 를 업로드하면 환경에 따라 mock 파이프라인 또는 KataGo worker 가 수치·PV 중심으로 결과를 채웁니다. 자연어 해설·패착 확정·Deep Search 실행은 포함하지 않습니다.",
    uploadTitle: "기보 분석 시작",
    uploadDescription: "SGF 파일을 드래그하거나 클릭하여 업로드하세요",
    uploadButton: "SGF 파일 업로드",
    uploadDragDrop: "또는 파일을 여기에 끌어다 놓으세요",
    uploadFormats: "지원 형식: .sgf, .SGF",
    analyzing: "분석을 진행 중입니다…",
    
    title: "기보 분석 리포트 (데모/베타)",
    subtitle: "KataGo 수치·PV 및 내부 신호(BSI/ADI/deepSearchPlan 후보) — 확정 해설 아님",
    gameInfo: "대국 정보",
    blackPlayer: "흑",
    whitePlayer: "백",
    date: "대국 일자",
    totalMoves: "총 수",
    result: "결과",
    komi: "덤",
    finalWinrate: "최종 흑 승률",
    topMistakes: "승률 변화 예시 (UI 데모)",
    mistakeCount: "개 구간 (샘플)",
    turn: "수",
    black: "흑",
    white: "백",
    winrateDrop: "승률 변화",
    aiExplanation: "참고 설명 (예시)",
    viewPV: "참고 PV 펼치기",
    hidePV: "PV 접기",
    pvTitle: "참고 PV (KataGo)",
    pvDescription: "아래 순서는 엔진이 제시한 참고 진행이며, 최선·단정 판단을 대신하지 않습니다.",
    analysisBy: "분석: KataGo (worker v1 베타)",
    uploadNew: "새 기보 분석",
    moves: "수",
    backToUpload: "새 기보 분석하기",
    reportDemoNotice:
      "이 섹션은 연습용 mock 리포트입니다. 운영 빌드의 KataGo 결과는 JSON 필드 중심이며, 아래 카드 문구는 기능을 암시하지 않습니다.",
    severity: { critical: "승률 변동 큼 (데모 라벨)", major: "승률 변동 중간 (데모 라벨)", moderate: "승률 변동 소 (데모 라벨)" },
    
    pricingTitle: "크레딧 충전",
    pricingSubtitle:
      "원하는 크레딧 팩을 선택한 뒤 환불 정책에 동의하고 안전한 글로벌 카드 결제로 진행하세요.",
    pricingCheckoutButton: "결제 페이지로 이동",
    pricingCheckoutUrlError: "결제 URL 생성에 실패했습니다.",
    creditRefundPolicyAck:
      "디지털 분석 크레딧은 사용 즉시 차감되며, 이미 사용한 크레딧은 환불되지 않는다는 점에 동의합니다.",
    creditPackStarter: "Starter",
    creditPackStandard: "Standard",
    creditPackPro: "Pro",
    creditsUnit: "크레딧",
    pricingPriceCheckoutNote: "결제 금액은 결제 확인 화면에 표시됩니다.",
    creditBulletPerSgf: "SGF 분석 1회당 1 크레딧 차감",
    creditBulletBalancePersistent: "충전 크레딧은 만료 없이 잔액으로 유지합니다 (정책 변경 시 별도 고지).",
    creditRefundMustAgree: "환불 정책에 동의해야 결제를 진행할 수 있습니다.",
    creditCheckoutLoginTitle: "로그인 후 크레딧 충전 가능",
    creditCheckoutLoginDesc: "로그인 페이지로 이동합니다.",
    creditCheckoutLoginCta: "로그인하고 충전하기",
    pricingCheckoutFailedTitle: "결제를 시작할 수 없습니다.",
    pricingCheckoutFailedDesc: "잠시 후 다시 시도해 주세요.",
    pricingCheckoutServerErrorDetail:
      "서버 설정(APP_BASE_URL·Lemon Squeezy)을 확인하거나 잠시 후 다시 시도해 주세요.",
    pricingNetworkError: "네트워크 오류로 결제를 시작하지 못했습니다.",
    pricingCheckoutRedirecting: "결제 페이지로 이동 중입니다…",
    pricing401Description: "/login 에서 로그인한 뒤 다시 시도해 주세요.",
    billingPaidTitle: "결제가 완료되었습니다.",
    billingCreditsAppliedNotice: "크레딧이 계정에 반영되었습니다.",
    billingCreditDelayedMessage:
      "결제는 완료되었지만 크레딧 반영이 지연되고 있습니다. 잠시 후 새로고침하거나 문의해 주세요.",
    billingCreditPendingNeutralTitle: "크레딧 반영 상태를 확인 중입니다.",
    billingCreditPendingNeutralDesc:
      "결제 직전 잔액 기록이 없어 자동으로 확정할 수 없습니다. 상단 크레딧 잔액을 확인하거나 잠시 후 새로고침해 주세요.",
    billingCreditMaybeAppliedTitle: "결제가 반영되었을 수 있습니다.",
    billingCreditMaybeAppliedDesc:
      "최근 충전 기록이 확인되었습니다. 크레딧 잔액을 확인해 주세요. 반영이 없으면 잠시 후 다시 시도해 주세요.",
    billingCreditsCheckFail: "결제 직후 크레딧을 확인하지 못했습니다.",
    billingCreditsRefreshError: "크레딧 새로고침 중 오류가 발생했습니다.",
    billingCancelled: "결제를 취소했습니다.",
    free: "무료 체험",
    basic: "Basic",
    premium: "Premium",
    perMonth: "/ 월",
    currentPlan: "현재 플랜",
    choosePlan: "선택하기",
    popular: "인기",
    pricingFeatures: {
      free: ["월 3회 분석(플랜 문구는 UI 예시)", "KataGo·mock 환경별 베타", "다국어 UI", "참고 PV 1개"],
      basic: ["월 30회 분석(예시)", "multi-turn·BSI/ADI 수치(내부 신호)", "다국어 UI", "참고 PV 5개", "승률 표시"],
      premium: ["분석 한도·우선순위(예시 문구)", "동일 엔진 베타", "다국어 UI", "PV 다중", "승률·지표(해석 아님)", "우선 큐(예시)"],
    },
    
    profilePlan: "보유 크레딧",
    profileRemaining: "차감 기준",
    profileUsed: "사용한 횟수",
    
    footerPowered: "KataGo 기반 분석 (베타)",
    footerDisclaimer: "MVP/베타 UI입니다. 일부 화면은 mock 예시이며, 유료 전에는 표기·결과 범위를 반드시 확인하세요.",
  },
  en: {
    brandName: "KataTalk (beta)",
    login: "Log In",
    signup: "Sign Up",
    subscribe: "Buy credits",
    logout: "Log Out",
    logoutSuccess: "You have been logged out.",
    loginRequired: "Please log in to continue.",
    myProfile: "My Profile",
    
    heroTitle: "KataGo-based game review (beta)",
    heroSubtitle:
      "Upload an SGF: depending on environment you get a mock pipeline or the KataGo worker filling numeric/PV-focused JSON. Natural-language commentary, blunder verdicts, and Deep Search execution are not included.",
    uploadTitle: "Start Analysis",
    uploadDescription: "Drag or click to upload your SGF file",
    uploadButton: "Upload SGF File",
    uploadDragDrop: "or drag and drop your file here",
    uploadFormats: "Supported formats: .sgf, .SGF",
    analyzing: "Running analysis…",
    
    title: "Game review (demo / beta)",
    subtitle: "KataGo numbers/PV and internal signals (BSI/ADI/deepSearchPlan candidates) — not definitive teaching text",
    gameInfo: "Game Information",
    blackPlayer: "Black",
    whitePlayer: "White",
    date: "Date",
    totalMoves: "Total Moves",
    result: "Result",
    komi: "Komi",
    finalWinrate: "Final Black Winrate",
    topMistakes: "Sample winrate swings (UI demo)",
    mistakeCount: "sample rows",
    turn: "Move",
    black: "Black",
    white: "White",
    winrateDrop: "Winrate change",
    aiExplanation: "Sample note (not NL product)",
    viewPV: "Show reference PV",
    hidePV: "Hide PV",
    pvTitle: "Reference PV (KataGo)",
    pvDescription: "Sequence below is engine-suggested reference play, not a guaranteed best move or verdict.",
    analysisBy: "Analysis: KataGo (worker v1 beta)",
    uploadNew: "Analyze New Game",
    moves: "moves",
    backToUpload: "Analyze New Game",
    reportDemoNotice:
      "This section is a practice mock report. Production KataGo output is JSON-centric; card text does not imply shipped NL features.",
    severity: { critical: "Large swing (demo label)", major: "Medium swing (demo label)", moderate: "Small swing (demo label)" },
    
    pricingTitle: "Buy Credits",
    pricingSubtitle:
      "Choose a credit pack, agree to the refund policy, and continue to secure global card checkout.",
    pricingCheckoutButton: "Proceed to Checkout",
    pricingCheckoutUrlError: "Could not create checkout URL.",
    creditRefundPolicyAck:
      "I understand that digital analysis credits are deducted when used, and used credits are non-refundable.",
    creditPackStarter: "Starter",
    creditPackStandard: "Standard",
    creditPackPro: "Pro",
    creditsUnit: "credits",
    pricingPriceCheckoutNote: "The charge amount is shown on the payment confirmation screen.",
    creditBulletPerSgf: "1 credit per SGF analysis run",
    creditBulletBalancePersistent:
      "Purchased credits stay on your balance with no expiry (policy changes will be announced separately).",
    creditRefundMustAgree: "You must agree to the refund policy before continuing to checkout.",
    creditCheckoutLoginTitle: "Sign in to purchase credits",
    creditCheckoutLoginDesc: "Redirecting you to the sign-in page.",
    creditCheckoutLoginCta: "Sign in to continue",
    pricingCheckoutFailedTitle: "Could not start checkout.",
    pricingCheckoutFailedDesc: "Please try again in a moment.",
    pricingCheckoutServerErrorDetail:
      "Check billing configuration (APP_BASE_URL / Lemon Squeezy) or try again later.",
    pricingNetworkError: "Network error. Could not start checkout.",
    pricingCheckoutRedirecting: "Opening checkout…",
    pricing401Description: "Please sign in at /login and try again.",
    billingPaidTitle: "Payment completed.",
    billingCreditsAppliedNotice: "Credits have been added to your account.",
    billingCreditDelayedMessage:
      "Your payment went through, but credits are taking longer to appear. Please refresh in a moment or contact support.",
    billingCreditPendingNeutralTitle: "Checking whether credits were applied.",
    billingCreditPendingNeutralDesc:
      "We could not record your balance before checkout, so we cannot confirm automatically. Please check your credit balance above or refresh shortly.",
    billingCreditMaybeAppliedTitle: "Credits may already be applied.",
    billingCreditMaybeAppliedDesc:
      "A recent top-up was found in your history. Please verify your balance. If it looks wrong, try again in a moment.",
    billingCreditsCheckFail: "Could not verify credits right after payment.",
    billingCreditsRefreshError: "Something went wrong while refreshing credits.",
    billingCancelled: "Checkout was cancelled.",
    free: "Free Trial",
    basic: "Basic",
    premium: "Premium",
    perMonth: "/ month",
    currentPlan: "Current Plan",
    choosePlan: "Choose Plan",
    popular: "Popular",
    pricingFeatures: {
      free: ["3 analyses / month (plan copy is illustrative)", "KataGo or mock depending on env", "Multi-language UI", "1 reference PV"],
      basic: ["30 analyses / month (illustrative)", "Multi-turn + BSI/ADI numbers (internal signals)", "Multi-language UI", "5 PV lines", "Winrate display"],
      premium: ["Limits / priority (illustrative)", "Same engine beta", "Multi-language UI", "Multiple PVs", "Charts (not teaching verdicts)", "Priority queue (illustrative)"],
    },
    
    profilePlan: "Your credits",
    profileRemaining: "Usage",
    profileUsed: "Reviews used",
    
    footerPowered: "KataGo-based analysis (beta)",
    footerDisclaimer: "MVP/beta UI. Some screens are mock samples; verify scope before paid launch.",
  },
  zh: {
    brandName: "KataTalk（测试版）",
    login: "登录",
    signup: "注册",
    subscribe: "充值",
    logout: "退出登录",
    logoutSuccess: "已成功退出登录。",
    loginRequired: "请先登录。",
    myProfile: "我的资料",
    
    heroTitle: "基于 KataGo 的棋谱分析（测试版）",
    heroSubtitle:
      "上传 SGF 后，根据环境由 mock 流程或 KataGo worker 写入以数值/PV 为主的 JSON。不包含自然语言解说、败着裁定或 Deep Search 执行。",
    uploadTitle: "开始分析",
    uploadDescription: "拖拽或点击上传SGF文件",
    uploadButton: "上传SGF文件",
    uploadDragDrop: "或将文件拖放到此处",
    uploadFormats: "支持格式: .sgf, .SGF",
    analyzing: "正在分析…",
    
    title: "棋谱分析报告（演示/测试）",
    subtitle: "KataGo 数值·PV 及内部信号（BSI/ADI/deepSearchPlan 候选）— 非定论讲解",
    gameInfo: "对局信息",
    blackPlayer: "黑方",
    whitePlayer: "白方",
    date: "对局日期",
    totalMoves: "总手数",
    result: "结果",
    komi: "贴目",
    finalWinrate: "最终黑方胜率",
    topMistakes: "胜率变化示例（界面演示）",
    mistakeCount: "个示例段落",
    turn: "手",
    black: "黑",
    white: "白",
    winrateDrop: "胜率变化",
    aiExplanation: "参考说明（示例）",
    viewPV: "展开参考 PV",
    hidePV: "收起 PV",
    pvTitle: "参考 PV（KataGo）",
    pvDescription: "以下顺序为引擎参考变化，不代表必胜或最终判断。",
    analysisBy: "分析：KataGo（worker v1 测试版）",
    uploadNew: "分析新棋谱",
    moves: "手",
    backToUpload: "分析新棋谱",
    reportDemoNotice: "此区块为练习用 mock 报告。线上 KataGo 输出以 JSON 为主；卡片文字不代表已上线自然语言功能。",
    severity: { critical: "波动较大（演示标签）", major: "波动中等（演示标签）", moderate: "波动较小（演示标签）" },
    
    pricingTitle: "购买点数",
    pricingSubtitle: "请选择点数方案，同意退款说明后，使用安全的全球银行卡完成支付。",
    pricingCheckoutButton: "前往支付页面",
    pricingCheckoutUrlError: "无法生成支付链接。",
    creditRefundPolicyAck: "我同意：数字分析点数在使用后立即扣除，已使用的点数不予退款。",
    creditPackStarter: "Starter",
    creditPackStandard: "Standard",
    creditPackPro: "Pro",
    creditsUnit: "点",
    pricingPriceCheckoutNote: "具体金额以支付确认页显示为准。",
    creditBulletPerSgf: "每次SGF分析消耗1点",
    creditBulletBalancePersistent: "充值点数不设有效期，余额长期保留（政策如有变更将另行通知）。",
    creditRefundMustAgree: "需同意退款说明后方可继续支付。",
    creditCheckoutLoginTitle: "登录后即可充值点数",
    creditCheckoutLoginDesc: "将前往登录页面。",
    creditCheckoutLoginCta: "登录并充值",
    pricingCheckoutFailedTitle: "无法开始结账。",
    pricingCheckoutFailedDesc: "请稍后重试。",
    pricingCheckoutServerErrorDetail: "请检查账单配置（APP_BASE_URL / Lemon Squeezy）或稍后重试。",
    pricingNetworkError: "网络异常，无法开始结账。",
    pricingCheckoutRedirecting: "正在前往支付页面…",
    pricing401Description: "请在 /login 登录后重试。",
    billingPaidTitle: "支付已完成。",
    billingCreditsAppliedNotice: "点数已计入账户。",
    billingCreditDelayedMessage:
      "支付已成功，但点数入账有所延迟。请稍后刷新页面或联系支持。",
    billingCreditPendingNeutralTitle: "正在确认点数入账状态。",
    billingCreditPendingNeutralDesc:
      "未记录结账前余额，无法自动确认。请查看上方点数余额或稍后刷新。",
    billingCreditMaybeAppliedTitle: "支付可能已入账。",
    billingCreditMaybeAppliedDesc:
      "检测到近期充值记录。请核对点数余额；若未到账请稍后再试。",
    billingCreditsCheckFail: "支付完成后暂时无法验证点数。",
    billingCreditsRefreshError: "刷新点数时出错。",
    billingCancelled: "已取消支付。",
    free: "免费体验",
    basic: "Basic",
    premium: "Premium",
    perMonth: "/ 月",
    currentPlan: "当前方案",
    choosePlan: "选择方案",
    popular: "热门",
    pricingFeatures: {
      free: ["每月 3 次分析（文案为示例）", "KataGo 或 mock 视环境", "多语言界面", "1 条参考 PV"],
      basic: ["每月 30 次分析（示例）", "multi-turn + BSI/ADI 数值（内部信号）", "多语言界面", "5 条 PV", "胜率展示"],
      premium: ["额度/优先（示例）", "同一引擎测试版", "多语言界面", "多条 PV", "图表（非棋理裁定）", "优先队列（示例）"],
    },
    
    profilePlan: "当前积分",
    profileRemaining: "消耗",
    profileUsed: "已使用次数",
    
    footerPowered: "基于 KataGo 的分析（测试版）",
    footerDisclaimer: "MVP/测试界面；部分为 mock 示例。付费前请核对能力与范围。",
  },
  ja: {
    brandName: "KataTalk（ベータ）",
    login: "ログイン",
    signup: "新規登録",
    subscribe: "チャージ",
    logout: "ログアウト",
    logoutSuccess: "ログアウトしました。",
    loginRequired: "ログインが必要です。",
    myProfile: "マイプロフィール",
    
    heroTitle: "KataGo ベースの棋譜解析（ベータ）",
    heroSubtitle:
      "SGF をアップロードすると、環境により mock パイプラインまたは KataGo worker が数値・PV 中心の JSON を埋めます。自然言語解説・悪手断定・Deep Search 実行は含みません。",
    uploadTitle: "解析を開始",
    uploadDescription: "SGFファイルをドラッグまたはクリックしてアップロード",
    uploadButton: "SGFファイルをアップロード",
    uploadDragDrop: "またはファイルをここにドロップ",
    uploadFormats: "対応形式: .sgf, .SGF",
    analyzing: "解析中…",
    
    title: "棋譜解析レポート（デモ／ベータ）",
    subtitle: "KataGo 数値・PV と内部シグナル（BSI/ADI/deepSearchPlan 候補）— 定説的解説ではありません",
    gameInfo: "対局情報",
    blackPlayer: "黒",
    whitePlayer: "白",
    date: "対局日",
    totalMoves: "総手数",
    result: "結果",
    komi: "コミ",
    finalWinrate: "最終黒勝率",
    topMistakes: "勝率変化の例（UI デモ）",
    mistakeCount: "件のサンプル",
    turn: "手目",
    black: "黒",
    white: "白",
    winrateDrop: "勝率変化",
    aiExplanation: "参考メモ（サンプル）",
    viewPV: "参考 PV を表示",
    hidePV: "PV を閉じる",
    pvTitle: "参考 PV（KataGo）",
    pvDescription: "以下の順はエンジン参考の進行で、最善や断定判断の代替ではありません。",
    analysisBy: "解析: KataGo（worker v1 ベータ）",
    uploadNew: "新しい棋譜を解析",
    moves: "手",
    backToUpload: "新しい棋譜を解析する",
    reportDemoNotice:
      "この欄は練習用 mock レポートです。本番の KataGo 出力は JSON が中心で、カード文面は提供機能を保証しません。",
    severity: { critical: "変動大（デモラベル）", major: "変動中（デモラベル）", moderate: "変動小（デモラベル）" },
    
    pricingTitle: "クレジットを購入",
    pricingSubtitle:
      "プランを選び、返金ポリシーに同意したうえで、安全なグローバルカード決済に進んでください。",
    pricingCheckoutButton: "決済ページへ進む",
    pricingCheckoutUrlError: "決済URLを作成できませんでした。",
    creditRefundPolicyAck:
      "デジタル解析クレジットは使用時に差し引かれ、使用済みのクレジットは返金されないことに同意します。",
    creditPackStarter: "Starter",
    creditPackStandard: "Standard",
    creditPackPro: "Pro",
    creditsUnit: "クレジット",
    pricingPriceCheckoutNote: "請求金額は決済確認画面に表示されます。",
    creditBulletPerSgf: "SGF解析1回につきクレジット1を消費",
    creditBulletBalancePersistent:
      "チャージしたクレジットに有効期限はなく残高として保持されます（変更時は別途お知らせします）。",
    creditRefundMustAgree: "返金ポリシーに同意しないと決済に進めません。",
    creditCheckoutLoginTitle: "ログイン後にクレジットを購入できます",
    creditCheckoutLoginDesc: "ログインページへ移動します。",
    creditCheckoutLoginCta: "ログインして購入する",
    pricingCheckoutFailedTitle: "決済を開始できませんでした。",
    pricingCheckoutFailedDesc: "しばらくしてから再度お試しください。",
    pricingCheckoutServerErrorDetail:
      "請求設定（APP_BASE_URL / Lemon Squeezy）を確認するか、時間をおいて再試行してください。",
    pricingNetworkError: "ネットワークエラーで決済を開始できませんでした。",
    pricingCheckoutRedirecting: "決済ページへ移動しています…",
    pricing401Description: "/login でログインしてから再度お試しください。",
    billingPaidTitle: "お支払いが完了しました。",
    billingCreditsAppliedNotice: "クレジットがアカウントに反映されました。",
    billingCreditDelayedMessage:
      "お支払いは完了していますが、クレジット反映が遅れています。しばらくしてから更新するか、サポートへお問い合わせください。",
    billingCreditPendingNeutralTitle: "クレジット反映状況を確認しています。",
    billingCreditPendingNeutralDesc:
      "決済前の残高記録がないため自動では確定できません。画面上部の残高を確認するか、しばらくしてから再読み込みしてください。",
    billingCreditMaybeAppliedTitle: "決済が反映済みの可能性があります。",
    billingCreditMaybeAppliedDesc:
      "直近のチャージ記録が見つかりました。残高をご確認ください。反映がない場合は時間をおいて再度お試しください。",
    billingCreditsCheckFail: "直後にクレジットを確認できませんでした。",
    billingCreditsRefreshError: "クレジットの更新中にエラーが発生しました。",
    billingCancelled: "決済をキャンセルしました。",
    free: "無料体験",
    basic: "Basic",
    premium: "Premium",
    perMonth: "/ 月",
    currentPlan: "現在のプラン",
    choosePlan: "プランを選択",
    popular: "人気",
    pricingFeatures: {
      free: ["月3回解析（文言は例示）", "環境により KataGo または mock", "多言語 UI", "参考図1つ"],
      basic: ["月30回解析（例示）", "multi-turn・BSI/ADI 数値（内部シグナル）", "多言語 UI", "参考図5つ", "勝率表示"],
      premium: ["上限・優先度（例示）", "同一エンジン ベータ", "多言語 UI", "複数参考図", "チャート（棋理裁定ではない）", "優先キュー（例示）"],
    },
    
    profilePlan: "保有クレジット",
    profileRemaining: "消費",
    profileUsed: "使用回数",
    
    footerPowered: "KataGo ベースの解析（ベータ）",
    footerDisclaimer: "MVP/ベータ UI です。一部は mock 例示です。有償化前に範囲を確認してください。",
  },
};

// ─────────────────────────────────────────────
// SGF Coordinate Utilities
// ─────────────────────────────────────────────
export function sgfToGrid(coord: string): [number, number] | null {
  if (!coord || coord.length < 2) return null;
  const colChar = coord[0].toUpperCase();
  const rowStr = coord.slice(1);
  const row = parseInt(rowStr, 10);
  if (isNaN(row) || row < 1 || row > 19) return null;

  const COLS = "ABCDEFGHJKLMNOPQRST"; // skip I
  const colIndex = COLS.indexOf(colChar);
  if (colIndex === -1) return null;

  return [colIndex, 19 - row];
}

export function getSeverity(drop: number): "critical" | "major" | "moderate" {
  if (drop >= 15) return "critical";
  if (drop >= 10) return "major";
  return "moderate";
}
