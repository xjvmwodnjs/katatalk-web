// =============================================================
// Design: "바둑판 위의 데이터 연구소" — SaaS Edition
// Full i18n Translation Object + Mock Data + Utilities
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
        ko: "우상귀에 두어진 이 수는 이번 대국에서 가장 뼈아픈 패착이었습니다. 승률이 21.5% 폭락했습니다. 지금은 우상귀의 실리를 탐할 때가 아니라, P16을 두어 중앙으로 두텁게 진출해야 할 타이밍이었습니다. 이 수를 놓침으로써 백의 우변 세력이 견고해졌고, 이후 중반전 내내 흑은 수습에 급급하게 되었습니다.",
        en: "This move in the upper-right corner was the most painful mistake of the game. The winrate plummeted by 21.5%. Instead of seeking profit in the corner, Black should have played P16 to solidly advance toward the center. By missing this timing, White's right-side influence became unshakeable, and Black struggled throughout the middle game.",
        zh: "右上角的这手棋是本局最令人痛心的败着。胜率暴跌21.5%。此时不应贪图右上角的实利，而应走P16向中腹厚实地发展。错过这个时机后，白方右边的势力变得坚不可摧，黑方在中盘一直疲于应对。",
        ja: "右上隅に打たれたこの手は、本局で最も痛恨の悪手でした。勝率が21.5%も急落しました。今は右上隅の実利を求める時ではなく、P16と打って中央に厚く進出すべきタイミングでした。この手を逃したことで白の右辺の勢力が堅固になり、その後の中盤戦で黒は終始収拾に追われました。",
      },
      pv: ["P16", "O15", "Q15", "R15", "P15"],
    },
    {
      turn: 78,
      player: "W",
      zone: { ko: "하변 중앙", en: "Lower center", zh: "下边中央", ja: "下辺中央" },
      winrate_drop_percent: 15.2,
      llm_explanation: {
        ko: "하변 중앙에서 백이 선택한 이 수는 흑의 세력권을 과소평가한 결과입니다. 승률이 15.2% 하락했습니다. K4를 두어 하변의 흑 세력을 미리 삭감하거나, 우하귀 방향으로 전환하는 것이 올바른 방향이었습니다. 이 패착으로 인해 흑은 하변 전체를 집으로 굳히는 데 성공하여 실리에서 크게 앞서게 되었습니다.",
        en: "White's choice in the lower center underestimated Black's sphere of influence. The winrate dropped by 15.2%. Playing K4 to reduce Black's lower-side influence, or switching to the lower-right corner, would have been the correct direction. This mistake allowed Black to solidify the entire lower side as territory, gaining a significant lead in points.",
        zh: "白方在下边中央的选择低估了黑方的势力范围。胜率下降了15.2%。应走K4提前削减黑方下边的势力，或转向右下角方向。这步败着使黑方成功将整个下边固化为实地，在实利上大幅领先。",
        ja: "下辺中央で白が選んだこの手は、黒の勢力圏を過小評価した結果です。勝率が15.2%低下しました。K4と打って下辺の黒の勢力を事前に削減するか、右下隅方向に転換するのが正しい方向でした。この悪手により黒は下辺全体を地として固めることに成功し、実利で大きくリードしました。",
      },
      pv: ["K4", "J5", "L4", "M4", "K5"],
    },
    {
      turn: 112,
      player: "B",
      zone: { ko: "좌변", en: "Left side", zh: "左边", ja: "左辺" },
      winrate_drop_percent: 11.8,
      llm_explanation: {
        ko: "좌변에서의 이 수는 흑이 이미 유리한 국면에서 불필요한 위험을 감수한 수입니다. 승률이 11.8% 하락했습니다. D10을 두어 좌변을 안정적으로 마무리하는 것이 정수였습니다. 욕심을 부려 백의 약점을 공격하려 했으나, 오히려 자신의 돌들이 엷어지는 결과를 초래했습니다.",
        en: "This move on the left side was an unnecessary risk taken from an already favorable position. The winrate dropped by 11.8%. Playing D10 to stably finish the left side was the correct move. Greedily attacking White's weakness instead made Black's own stones thin and vulnerable.",
        zh: "左边的这手棋是黑方在已经有利的局面下承担了不必要的风险。胜率下降了11.8%。走D10稳定地收束左边才是正着。贪心地攻击白方的弱点，反而导致自己的棋子变薄。",
        ja: "左辺でのこの手は、黒がすでに有利な局面で不必要なリスクを冒した手です。勝率が11.8%低下しました。D10と打って左辺を安定的にまとめるのが正着でした。欲張って白の弱点を攻めようとしましたが、かえって自分の石が薄くなる結果を招きました。",
      },
      pv: ["D10", "C10", "E10", "D9", "E9"],
    },
    {
      turn: 155,
      player: "W",
      zone: { ko: "중앙", en: "Center", zh: "中腹", ja: "中央" },
      winrate_drop_percent: 9.4,
      llm_explanation: {
        ko: "중앙에서 백이 선택한 이 수는 집 계산에서 큰 착오를 일으켰습니다. 승률이 9.4% 하락했습니다. J10을 두어 중앙의 흑 집을 파고드는 것이 최선이었으나, 백은 이미 확정된 집에만 집착하는 모습을 보였습니다. 이 시점에서 중앙 침투를 포기함으로써 흑의 중앙 집이 완전히 굳어졌고, 이후 역전의 기회를 잃게 되었습니다.",
        en: "White's choice in the center caused a major miscalculation in territory counting. The winrate dropped by 9.4%. Playing J10 to invade Black's central territory was the best option, but White clung to already-secured territory. By giving up the central invasion at this point, Black's center became completely solid, and White lost any chance of a comeback.",
        zh: "白方在中腹的选择在目数计算上犯了大错。胜率下降了9.4%。走J10打入黑方中腹的地盘才是最善，但白方执着于已经确定的地盘。在这个时点放弃中腹侵入，使黑方的中腹完全固化，此后白方失去了逆转的机会。",
        ja: "中央で白が選んだこの手は、地の計算で大きな錯誤を引き起こしました。勝率が9.4%低下しました。J10と打って中央の黒地に侵入するのが最善でしたが、白はすでに確定した地にこだわる姿を見せました。この時点で中央侵入を諦めたことで黒の中央の地が完全に固まり、以後逆転の機会を失いました。",
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
  
  // Severity
  severity: {
    critical: string;
    major: string;
    moderate: string;
  };
  
  // Pricing
  pricingTitle: string;
  pricingSubtitle: string;
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
    brandName: "바둑 AI 해설",
    login: "로그인",
    signup: "회원가입",
    subscribe: "구독하기",
    logout: "로그아웃",
    logoutSuccess: "로그아웃 되었습니다.",
    loginRequired: "로그인이 필요합니다.",
    myProfile: "내 프로필",
    
    heroTitle: "AI가 당신의 바둑을 해설합니다",
    heroSubtitle: "SGF 기보를 업로드하면, KataGo AI가 패착을 찾아내고 자연어로 알기 쉽게 설명해 드립니다.",
    uploadTitle: "기보 분석 시작",
    uploadDescription: "SGF 파일을 드래그하거나 클릭하여 업로드하세요",
    uploadButton: "SGF 파일 업로드",
    uploadDragDrop: "또는 파일을 여기에 끌어다 놓으세요",
    uploadFormats: "지원 형식: .sgf, .SGF",
    analyzing: "AI가 기보를 분석 중입니다...",
    
    title: "AI 기보 분석 리포트",
    subtitle: "KataGo 엔진 기반 심층 분석",
    gameInfo: "대국 정보",
    blackPlayer: "흑",
    whitePlayer: "백",
    date: "대국 일자",
    totalMoves: "총 수",
    result: "결과",
    komi: "덤",
    finalWinrate: "최종 흑 승률",
    topMistakes: "주요 패착 분석",
    mistakeCount: "개 패착 발견",
    turn: "수",
    black: "흑",
    white: "백",
    winrateDrop: "승률 하락",
    aiExplanation: "AI 해설",
    viewPV: "AI 추천 참고도 보기",
    hidePV: "참고도 접기",
    pvTitle: "AI 추천 참고도",
    pvDescription: "아래 수순이 이 국면에서 AI가 추천하는 최선의 진행입니다.",
    analysisBy: "분석 엔진: KataGo + GPT-4o",
    uploadNew: "새 기보 분석",
    moves: "수",
    backToUpload: "새 기보 분석하기",
    severity: { critical: "치명적 패착", major: "중요 실수", moderate: "경미한 실수" },
    
    pricingTitle: "요금제",
    pricingSubtitle: "나에게 맞는 플랜을 선택하세요",
    free: "무료 체험",
    basic: "Basic",
    premium: "Premium",
    perMonth: "/ 월",
    currentPlan: "현재 플랜",
    choosePlan: "선택하기",
    popular: "인기",
    pricingFeatures: {
      free: ["월 3회 기보 분석", "기본 패착 탐지", "한국어 해설만 지원", "참고도(PV) 1개"],
      basic: ["월 30회 기보 분석", "심층 패착 분석", "4개 언어 해설 지원", "참고도(PV) 5개", "승률 그래프"],
      premium: ["무제한 기보 분석", "프로 수준 심층 분석", "4개 언어 해설 지원", "전체 참고도(PV)", "승률 그래프 + 형세판단", "우선 처리 큐"],
    },
    
    profilePlan: "현재 플랜",
    profileRemaining: "이번 달 남은 분석 횟수",
    profileUsed: "사용한 횟수",
    
    footerPowered: "Powered by KataGo + GPT-4o",
    footerDisclaimer: "본 서비스는 MVP 데모입니다. 실제 분석 결과와 다를 수 있습니다.",
  },
  en: {
    brandName: "Baduk AI Review",
    login: "Log In",
    signup: "Sign Up",
    subscribe: "Subscribe",
    logout: "Log Out",
    logoutSuccess: "You have been logged out.",
    loginRequired: "Please log in to continue.",
    myProfile: "My Profile",
    
    heroTitle: "AI Reviews Your Go Games",
    heroSubtitle: "Upload an SGF file and KataGo AI will find your mistakes and explain them in natural language.",
    uploadTitle: "Start Analysis",
    uploadDescription: "Drag or click to upload your SGF file",
    uploadButton: "Upload SGF File",
    uploadDragDrop: "or drag and drop your file here",
    uploadFormats: "Supported formats: .sgf, .SGF",
    analyzing: "AI is analyzing your game...",
    
    title: "AI Game Review Report",
    subtitle: "Deep Analysis Powered by KataGo Engine",
    gameInfo: "Game Information",
    blackPlayer: "Black",
    whitePlayer: "White",
    date: "Date",
    totalMoves: "Total Moves",
    result: "Result",
    komi: "Komi",
    finalWinrate: "Final Black Winrate",
    topMistakes: "Key Mistake Analysis",
    mistakeCount: "mistakes found",
    turn: "Move",
    black: "Black",
    white: "White",
    winrateDrop: "Winrate Drop",
    aiExplanation: "AI Commentary",
    viewPV: "View AI Recommended Variation",
    hidePV: "Hide Variation",
    pvTitle: "AI Recommended Variation",
    pvDescription: "The following sequence is the best continuation recommended by AI at this position.",
    analysisBy: "Analysis Engine: KataGo + GPT-4o",
    uploadNew: "Analyze New Game",
    moves: "moves",
    backToUpload: "Analyze New Game",
    severity: { critical: "Critical Mistake", major: "Major Error", moderate: "Minor Error" },
    
    pricingTitle: "Pricing",
    pricingSubtitle: "Choose the plan that fits your needs",
    free: "Free Trial",
    basic: "Basic",
    premium: "Premium",
    perMonth: "/ month",
    currentPlan: "Current Plan",
    choosePlan: "Choose Plan",
    popular: "Popular",
    pricingFeatures: {
      free: ["3 reviews per month", "Basic mistake detection", "Korean commentary only", "1 PV variation"],
      basic: ["30 reviews per month", "Deep mistake analysis", "4 language commentary", "5 PV variations", "Winrate graph"],
      premium: ["Unlimited reviews", "Pro-level deep analysis", "4 language commentary", "All PV variations", "Winrate graph + Territory map", "Priority queue"],
    },
    
    profilePlan: "Current Plan",
    profileRemaining: "Reviews remaining this month",
    profileUsed: "Reviews used",
    
    footerPowered: "Powered by KataGo + GPT-4o",
    footerDisclaimer: "This is an MVP demo. Actual analysis results may differ.",
  },
  zh: {
    brandName: "围棋AI解说",
    login: "登录",
    signup: "注册",
    subscribe: "订阅",
    logout: "退出登录",
    logoutSuccess: "已成功退出登录。",
    loginRequired: "请先登录。",
    myProfile: "我的资料",
    
    heroTitle: "AI为您解说围棋",
    heroSubtitle: "上传SGF棋谱，KataGo AI将找出败着并用自然语言为您详细解说。",
    uploadTitle: "开始分析",
    uploadDescription: "拖拽或点击上传SGF文件",
    uploadButton: "上传SGF文件",
    uploadDragDrop: "或将文件拖放到此处",
    uploadFormats: "支持格式: .sgf, .SGF",
    analyzing: "AI正在分析棋谱...",
    
    title: "AI棋谱分析报告",
    subtitle: "基于KataGo引擎的深度分析",
    gameInfo: "对局信息",
    blackPlayer: "黑方",
    whitePlayer: "白方",
    date: "对局日期",
    totalMoves: "总手数",
    result: "结果",
    komi: "贴目",
    finalWinrate: "最终黑方胜率",
    topMistakes: "主要失误分析",
    mistakeCount: "个失误",
    turn: "手",
    black: "黑",
    white: "白",
    winrateDrop: "胜率下降",
    aiExplanation: "AI解说",
    viewPV: "查看AI推荐变化图",
    hidePV: "收起变化图",
    pvTitle: "AI推荐变化图",
    pvDescription: "以下手顺是AI在此局面推荐的最佳进行方式。",
    analysisBy: "分析引擎: KataGo + GPT-4o",
    uploadNew: "分析新棋谱",
    moves: "手",
    backToUpload: "分析新棋谱",
    severity: { critical: "致命失误", major: "重大错误", moderate: "轻微失误" },
    
    pricingTitle: "价格方案",
    pricingSubtitle: "选择适合您的方案",
    free: "免费体验",
    basic: "Basic",
    premium: "Premium",
    perMonth: "/ 月",
    currentPlan: "当前方案",
    choosePlan: "选择方案",
    popular: "热门",
    pricingFeatures: {
      free: ["每月3次棋谱分析", "基础败着检测", "仅支持韩语解说", "1个变化图"],
      basic: ["每月30次棋谱分析", "深度败着分析", "支持4种语言解说", "5个变化图", "胜率图表"],
      premium: ["无限棋谱分析", "专业级深度分析", "支持4种语言解说", "全部变化图", "胜率图表 + 形势判断", "优先处理队列"],
    },
    
    profilePlan: "当前方案",
    profileRemaining: "本月剩余分析次数",
    profileUsed: "已使用次数",
    
    footerPowered: "Powered by KataGo + GPT-4o",
    footerDisclaimer: "本服务为MVP演示版，实际分析结果可能有所不同。",
  },
  ja: {
    brandName: "囲碁AI解説",
    login: "ログイン",
    signup: "新規登録",
    subscribe: "サブスクリプション",
    logout: "ログアウト",
    logoutSuccess: "ログアウトしました。",
    loginRequired: "ログインが必要です。",
    myProfile: "マイプロフィール",
    
    heroTitle: "AIがあなたの囲碁を解説します",
    heroSubtitle: "SGF棋譜をアップロードすると、KataGo AIが悪手を見つけ、自然言語でわかりやすく説明します。",
    uploadTitle: "解析を開始",
    uploadDescription: "SGFファイルをドラッグまたはクリックしてアップロード",
    uploadButton: "SGFファイルをアップロード",
    uploadDragDrop: "またはファイルをここにドロップ",
    uploadFormats: "対応形式: .sgf, .SGF",
    analyzing: "AIが棋譜を解析中です...",
    
    title: "AI棋譜解析レポート",
    subtitle: "KataGoエンジンによる深層解析",
    gameInfo: "対局情報",
    blackPlayer: "黒",
    whitePlayer: "白",
    date: "対局日",
    totalMoves: "総手数",
    result: "結果",
    komi: "コミ",
    finalWinrate: "最終黒勝率",
    topMistakes: "主要な悪手分析",
    mistakeCount: "個の悪手",
    turn: "手目",
    black: "黒",
    white: "白",
    winrateDrop: "勝率低下",
    aiExplanation: "AI解説",
    viewPV: "AI推奨参考図を見る",
    hidePV: "参考図を閉じる",
    pvTitle: "AI推奨参考図",
    pvDescription: "以下の手順がこの局面でAIが推奨する最善の進行です。",
    analysisBy: "解析エンジン: KataGo + GPT-4o",
    uploadNew: "新しい棋譜を解析",
    moves: "手",
    backToUpload: "新しい棋譜を解析する",
    severity: { critical: "致命的な悪手", major: "重大なミス", moderate: "軽微なミス" },
    
    pricingTitle: "料金プラン",
    pricingSubtitle: "あなたに合ったプランをお選びください",
    free: "無料体験",
    basic: "Basic",
    premium: "Premium",
    perMonth: "/ 月",
    currentPlan: "現在のプラン",
    choosePlan: "プランを選択",
    popular: "人気",
    pricingFeatures: {
      free: ["月3回の棋譜解析", "基本悪手検出", "韓国語解説のみ", "参考図1つ"],
      basic: ["月30回の棋譜解析", "深層悪手分析", "4言語解説対応", "参考図5つ", "勝率グラフ"],
      premium: ["無制限の棋譜解析", "プロレベル深層分析", "4言語解説対応", "全参考図", "勝率グラフ + 形勢判断", "優先処理キュー"],
    },
    
    profilePlan: "現在のプラン",
    profileRemaining: "今月の残り解析回数",
    profileUsed: "使用回数",
    
    footerPowered: "Powered by KataGo + GPT-4o",
    footerDisclaimer: "本サービスはMVPデモです。実際の解析結果と異なる場合があります。",
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
