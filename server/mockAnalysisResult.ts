import type { AnalysisJobLanguage } from "./analysisJobStore.types";

const MOCK_ANALYSIS_RESULT = {
  game_info: {
    black_player: "Player (You)",
    white_player: "AI Opponent",
    date: "2024-03-15",
    total_moves: 234,
    result: {
      ko: "백 3.5집 승",
      en: "White wins by 3.5",
      zh: "白胜3.5目",
      ja: "白3.5目勝ち",
    },
    komi: 6.5,
    final_winrate_black: 42.3,
  },
  top_mistakes: [
    {
      turn: 45,
      player: "B",
      zone: { ko: "우상귀", en: "Upper-right corner", zh: "右上角", ja: "右上隅" },
      winrate_drop_percent: 21.5,
      llm_explanation: {
        ko: "우상귀에 두어진 이 수는 이번 대국에서 가장 뼈아픈 패착이었습니다. 승률이 21.5% 폭락했습니다. 지금은 우상귀의 실리를 탐할 때가 아니라, P16을 두어 중앙으로 두텁게 진출해야 할 타이밍이었습니다.",
        en: "This move in the upper-right corner was the most painful mistake of the game. Win rate plummeted by 21.5%. Instead of seeking profit in the upper-right, it was time to play P16 and build thickness toward the center.",
        zh: "右上角的这手棋是本局最痛苦的败着。胜率暴跌了21.5%。现在不是贪图右上角实地的时候，应该下P16向中央厚实地进出。",
        ja: "右上隅に打たれたこの手は、今回の対局で最も痛い敗着でした。勝率が21.5%も急落しました。今は右上隅の実利を貪る時ではなく、P16に打って中央へ厚く進出すべきタイミングでした。",
      },
      pv: ["P16", "O15", "Q15", "R15", "P15"],
    },
    {
      turn: 89,
      player: "B",
      zone: { ko: "중앙", en: "Center", zh: "中央", ja: "中央" },
      winrate_drop_percent: 14.2,
      llm_explanation: {
        ko: "중앙에서의 전투에서 방향을 잘못 잡았습니다. K10으로 가볍게 처리하면 흑이 여전히 우세했으나, 무리하게 단수를 쳐서 오히려 자충수가 되었습니다.",
        en: "The direction of play in the center battle was wrong. Playing lightly at K10 would have maintained Black's advantage, but the forced atari became self-damaging.",
        zh: "中央的战斗方向判断错误。如果在K10轻处理，黑棋仍然优势，但强行打吃反而成了自损。",
        ja: "中央での戦いで方向を間違えました。K10で軽く処理すれば黒がまだ優勢でしたが、無理にアタリを打って逆に自滅しました。",
      },
      pv: ["K10", "L10", "K11", "J10"],
    },
    {
      turn: 156,
      player: "B",
      zone: { ko: "좌하귀", en: "Lower-left corner", zh: "左下角", ja: "左下隅" },
      winrate_drop_percent: 8.7,
      llm_explanation: {
        ko: "끝내기 단계에서 좌하귀의 수순을 놓쳤습니다. C3에 먼저 들어가면 약 4집의 이득을 볼 수 있었으나, 다른 곳에 손을 빼면서 역전의 기회를 놓쳤습니다.",
        en: "In the endgame phase, the sequence in the lower-left corner was missed. Playing C3 first would have gained about 4 points, but tenuki elsewhere lost the chance for a comeback.",
        zh: "收官阶段错过了左下角的次序。先在C3进入可以获得约4目的利益，但脱先到别处失去了逆转的机会。",
        ja: "ヨセの段階で左下隅の手順を逃しました。C3に先に入れば約4目の得がありましたが、他に手を抜いて逆転のチャンスを逃しました。",
      },
      pv: ["C3", "D3", "C4", "B3", "C2"],
    },
  ],
};

export function buildMockAnalysisReport(input: {
  fileName: string;
  language: AnalysisJobLanguage;
}) {
  // TODO(KataGo): Build this from engine + LLM pipeline using validated SGF (DB/queue 경유).

  return {
    ...MOCK_ANALYSIS_RESULT,
    source: {
      fileName: input.fileName,
      language: input.language,
      mock: true,
    },
  };
}
