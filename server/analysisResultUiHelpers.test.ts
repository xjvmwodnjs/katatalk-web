import { describe, expect, it } from "vitest";
import {
  isFinalPositionTurnFromRaw,
  mapReasonPhraseForUi,
  uiTextContainsForbiddenLabel,
} from "@shared/analysisResultUiHelpers";

describe("analysisResultUiHelpers", () => {
  it("maps known reason phrases neutrally", () => {
    expect(mapReasonPhraseForUi("높은 ADI", "ko")).toBe("추가 검토 필요도 높음");
    expect(mapReasonPhraseForUi("BSI 신호", "ko")).toBe("수치 차이 감지");
    expect(mapReasonPhraseForUi("high_adi", "ko")).toBe("추가 검토 필요도 높음");
    expect(mapReasonPhraseForUi("meaningful_bsi", "ko")).toBe("수치 차이 감지");
    expect(mapReasonPhraseForUi("qualified", "ko")).toBe("검토 조건 충족");
  });

  it("maps unknown snake_case reason codes to internal signal", () => {
    expect(mapReasonPhraseForUi("interval_sample", "ko")).toBe("내부 참고 신호");
    expect(mapReasonPhraseForUi("some_future_flag", "en")).toBe("Internal signal");
  });

  it("filters forbidden fragments in unknown reasons", () => {
    expect(uiTextContainsForbiddenLabel("패착 확정")).toBe(true);
    expect(mapReasonPhraseForUi("이 수는 패착입니다", "ko")).toBe("내부 참고 신호");
  });

  it("detects final_position from raw analysisPlan", () => {
    const raw = {
      analysisPlan: {
        candidateTurns: [
          { turnIndex: 10, reason: "interval_sample" },
          { turnIndex: 99, reason: "final_position" },
        ],
      },
    };
    expect(isFinalPositionTurnFromRaw(raw, 99)).toBe(true);
    expect(isFinalPositionTurnFromRaw(raw, 10)).toBe(false);
  });
});
