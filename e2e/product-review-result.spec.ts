import { expect, test, type Page } from "@playwright/test";
import {
  productReviewCompletedJobResponse,
  productReviewE2eJobId,
} from "./fixtures/product-review-completed-result";

const viewports = [
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "desktop-1440", width: 1440, height: 900 },
] as const;

async function installCompletedJobFixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("katatalk-ui-lang", "ko");
  });
  await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(productReviewCompletedJobResponse),
    });
  });
}

async function expectNoPageHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe("Product Review result smoke", () => {
  for (const viewport of viewports) {
    test(`renders and exercises result UI at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await installCompletedJobFixture(page);

      await page.goto(`/?jobId=${productReviewE2eJobId}`);

      const board = page.getByRole("img", { name: "바둑판 국면 스냅샷" });
      await expect(board).toBeVisible();
      await expect(page.getByRole("img", { name: "KataGo 기준 승률 (%)" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "핵심 검토 후보" })).toBeVisible();
      await expect(page.getByText(/결정 #10/)).toBeVisible();
      await expectNoPageHorizontalOverflow(page);

      await page.getByRole("button", { name: "수 10" }).click();

      await expect(page.getByRole("heading", { name: "AI 분석 메모" })).toBeVisible();
      await expect(page.getByText("패자 관점에서 수치 근거가 확인된 결정적 장면 후보입니다.")).toBeVisible();
      await expect(page.getByText("결정론적 메모")).toBeVisible();
      await expect(page.getByText("집 차이 변화")).toBeVisible();
      await expect(page.getByText(/8\.0% \(원본 ratio\)/)).toBeVisible();
      await expect(page.getByText("실전수와 추천 후보수의 차이")).toBeVisible();
      await expect(page.getByText("참고 수순")).toBeVisible();
      await expect(page.getByText("흐름 변화 참고")).toHaveCount(0);
      await expect(page.getByText("참고도 표시 중")).toHaveCount(0);

      await page.getByRole("button", { name: "수 18" }).click();
      await expect(page.getByText(/검토 #18/)).toBeVisible();
      await expect(page.getByText("PV 있음")).toBeVisible();
      await expect(page.getByText("보수적 개념 힌트")).toBeVisible();
      await expect(page.getByText("실전수와 추천 후보수의 차이")).toBeVisible();
      await expect(page.getByRole("button", { name: "참고도 보기" })).toBeEnabled();

      await page.getByRole("button", { name: "참고도 보기" }).click();
      await expect(page.getByText("참고도 표시 중")).toBeVisible();
      await expect(page.getByText(/선택한 참고도 수순/)).toBeVisible();
      await expect(page.getByRole("button", { name: "전체 수순으로 돌아가기" })).toBeVisible();

      await page.getByRole("button", { name: "전체 수순으로 돌아가기" }).click();
      await expect(page.getByText("참고도 표시 중")).toHaveCount(0);

      await page.getByRole("button", { name: "놓아보기" }).click();
      await expect(page.getByText("화면에서만 놓아보는 기능이며, KataGo 재분석은 수행하지 않습니다.")).toBeVisible();
      await expect(page.getByText(/반투명 마커/)).toHaveCount(0);

      const tryPlayPoints = page.locator("svg .cursor-crosshair");
      await expect(tryPlayPoints.first()).toBeVisible();
      await tryPlayPoints.first().click();
      await expect(page.getByText(/반투명 마커/)).toBeVisible();

      await page.getByRole("button", { name: "무르기" }).click();
      await expect(page.getByText(/반투명 마커/)).toHaveCount(0);

      await tryPlayPoints.nth(1).click();
      await expect(page.getByText(/반투명 마커/)).toBeVisible();
      await page.getByRole("button", { name: "초기화" }).click();
      await expect(page.getByText(/반투명 마커/)).toHaveCount(0);

      await expect(page.getByText(/패착|실수|악수|blunder|mistake|정답/i)).toHaveCount(0);
      await expectNoPageHorizontalOverflow(page);
    });
  }
});
