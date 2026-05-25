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
      const memo = page.getByTestId("explanation-plan-v2-memo");
      await expect(memo.getByText("집 차이 변화").first()).toBeVisible();
      await expect(memo.getByText(/8\.0% \(원본 ratio\)/)).toBeVisible();
      await expect(memo.getByText("실전수와 추천 후보수의 차이").first()).toBeVisible();
      await expect(memo.getByText("참고 수순").first()).toBeVisible();
      await expect(page.getByText("흐름 변화 참고")).toHaveCount(0);
      await expect(page.getByText(/scoreLoss=|winrateLoss=|comparisonType=|delta=|adjacency_heuristic_only|B\[pd\]/)).toHaveCount(0);
      await expect(page.getByText("참고도 표시 중")).toHaveCount(0);

      await page.getByRole("button", { name: "수 18" }).click();
      await expect(page.getByText(/검토 #18/)).toBeVisible();
      await expect(page.getByText("PV 있음")).toBeVisible();
      await expect(page.getByTestId("explanation-plan-v2-memo").getByText("보수적 개념 힌트").first()).toBeVisible();
      await expect(page.getByTestId("explanation-plan-v2-memo").getByText("실전수와 추천 후보수의 차이").first()).toBeVisible();
      await expect(page.getByText(/concept=|scoreLoss=|winrateLoss=|comparisonType=|delta=|adjacency_heuristic_only|B\[pd\]/)).toHaveCount(0);
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

test.describe("Timeline progress polling hardening", () => {
  function runningJob(jobId: string, progress = 40) {
    return {
      success: true,
      jobId,
      status: "running",
      progress,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  test("stops progress polling after one 404 while status polling keeps running", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    let statusCalls = 0;
    let progressCalls = 0;
    let status429Calls = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
      statusCalls += 1;
      if (progressCalls > 1) {
        status429Calls += 1;
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ success: false, code: "RATE_LIMITED" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(statusCalls < 5 ? runningJob(productReviewE2eJobId) : productReviewCompletedJobResponse),
      });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect(page.getByRole("img", { name: "바둑판 국면 스냅샷" })).toBeVisible();
    await page.waitForTimeout(2200);
    expect(progressCalls).toBe(1);
    expect(statusCalls).toBeGreaterThanOrEqual(5);
    expect(status429Calls).toBe(0);
  });

  test("stops progress polling after 204", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    let statusCalls = 0;
    let progressCalls = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
      statusCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(statusCalls < 4 ? runningJob(productReviewE2eJobId) : productReviewCompletedJobResponse),
      });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({ status: 204 });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect(page.getByRole("img", { name: "바둑판 국면 스냅샷" })).toBeVisible();
    await page.waitForTimeout(1200);
    expect(progressCalls).toBe(1);
    expect(statusCalls).toBeGreaterThanOrEqual(4);
  });

  test("stops progress polling after enabled false", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    let statusCalls = 0;
    let progressCalls = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
      statusCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(statusCalls < 4 ? runningJob(productReviewE2eJobId) : productReviewCompletedJobResponse),
      });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, jobId: productReviewE2eJobId, enabled: false, events: [], points: [] }),
      });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect(page.getByRole("img", { name: "바둑판 국면 스냅샷" })).toBeVisible();
    await page.waitForTimeout(1200);
    expect(progressCalls).toBe(1);
    expect(statusCalls).toBeGreaterThanOrEqual(4);
  });

  test("backs off progress polling after 429 without blocking status polling", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    let statusCalls = 0;
    let progressCalls = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
      statusCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(statusCalls < 4 ? runningJob(productReviewE2eJobId) : productReviewCompletedJobResponse),
      });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ success: false, code: "RATE_LIMITED" }),
      });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect(page.getByRole("img", { name: "바둑판 국면 스냅샷" })).toBeVisible();
    await page.waitForTimeout(1200);
    expect(progressCalls).toBeLessThan(statusCalls);
    expect(statusCalls).toBeGreaterThanOrEqual(4);
  });

  test("does not restart disabled progress polling after same-job effect rerun", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    let statusCalls = 0;
    let progressCalls = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
      statusCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(runningJob(productReviewE2eJobId, Math.min(90, statusCalls * 10))),
      });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect.poll(() => progressCalls).toBe(1);
    await page.evaluate(() => {
      localStorage.setItem("katatalk-ui-lang", "en");
      window.dispatchEvent(new Event("katatalk-ui-lang-change"));
    });
    await page.waitForTimeout(2200);
    expect(progressCalls).toBe(1);
    expect(statusCalls).toBeGreaterThanOrEqual(3);
  });

  test("cleans up previous job progress polling when a new job id starts", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    const firstJobId = "timeline-job-first";
    const secondJobId = "timeline-job-second";
    let firstProgressCalls = 0;
    let secondProgressCalls = 0;
    await page.route(`**/api/analyze/${firstJobId}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runningJob(firstJobId)) });
    });
    await page.route(`**/api/analyze/${secondJobId}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(runningJob(secondJobId)) });
    });
    await page.route(`**/api/analyze/${firstJobId}/timeline-progress`, async (route) => {
      firstProgressCalls += 1;
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    });
    await page.route(`**/api/analyze/${secondJobId}/timeline-progress`, async (route) => {
      secondProgressCalls += 1;
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    });

    await page.goto(`/?jobId=${firstJobId}`);
    await expect.poll(() => firstProgressCalls).toBe(1);
    await page.evaluate((nextJobId) => {
      window.history.pushState({}, "", `/?jobId=${nextJobId}`);
      localStorage.setItem("katatalk-ui-lang", "en");
      window.dispatchEvent(new Event("katatalk-ui-lang-change"));
    }, secondJobId);
    await expect.poll(() => secondProgressCalls).toBe(1);
    await page.waitForTimeout(1600);
    expect(firstProgressCalls).toBe(1);
    expect(secondProgressCalls).toBe(1);
  });

  test("does not poll progress after immediate completed status", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    let progressCalls = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(productReviewCompletedJobResponse) });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, enabled: true, points: [] }) });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect(page.getByRole("img", { name: "바둑판 국면 스냅샷" })).toBeVisible();
    await page.waitForTimeout(800);
    expect(progressCalls).toBe(0);
  });

  test("stops progress polling after failed status", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    let statusCalls = 0;
    let progressCalls = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
      statusCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(statusCalls === 1 ? {
          success: true,
          jobId: productReviewE2eJobId,
          status: "running",
          progress: 40,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        } : {
          success: true,
          jobId: productReviewE2eJobId,
          status: "failed",
          progress: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
          error: { message: "Analysis job failed." },
        }),
      });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect.poll(() => statusCalls).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1200);
    expect(progressCalls).toBe(1);
  });

  test("stops progress polling after canceled status", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });
    let statusCalls = 0;
    let progressCalls = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async (route) => {
      statusCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(statusCalls === 1 ? runningJob(productReviewE2eJobId) : {
          success: true,
          jobId: productReviewE2eJobId,
          status: "canceled",
          progress: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        }),
      });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect.poll(() => statusCalls).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1200);
    expect(progressCalls).toBe(1);
  });
});
