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

async function installCompletedJobFixture(page: Page, language = "ko") {
  await page.addInitScript(lang => {
    localStorage.setItem("katatalk-ui-lang", lang);
  }, language);
  await page.route(`**/api/analyze/${productReviewE2eJobId}`, async route => {
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
    test(`renders and exercises result UI at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await installCompletedJobFixture(page);

      await page.goto(`/?jobId=${productReviewE2eJobId}`, {
        waitUntil: "domcontentloaded",
      });

      const board = page.getByRole("img", { name: "바둑판 국면 스냅샷" });
      await expect(board).toBeVisible();
      await expect(
        page.getByRole("img", { name: "흑 승률 (%)" })
      ).toBeVisible();
      await page.getByRole("button", { name: "백", exact: true }).click();
      await expect(
        page.getByRole("img", { name: "백 승률 (%)" })
      ).toBeVisible();
      await page.getByRole("button", { name: "흑", exact: true }).click();
      await expect(
        page.getByRole("img", { name: "흑 승률 (%)" })
      ).toBeVisible();
      if (process.env.E2E_CAPTURE_SCREENSHOTS === "true") {
        await page.screenshot({
          path: `test-results/winrate-axis-${viewport.name}.png`,
          fullPage: true,
        });
      }
      await expect(
        page.getByRole("heading", { name: "핵심 검토 후보" })
      ).toBeVisible();
      await expect(page.getByText(/결정 #10/)).toBeVisible();
      await expectNoPageHorizontalOverflow(page);

      await page.getByRole("button", { name: "수 10" }).click();

      await expect(
        page.getByRole("heading", { name: "AI 분석 메모" })
      ).toBeVisible();
      await expect(
        page.getByText(
          "패자 관점에서 수치 근거가 확인된 결정적 장면 후보입니다."
        )
      ).toBeVisible();
      await expect(page.getByText("결정론적 메모")).toBeVisible();
      const memo = page.getByTestId("explanation-plan-v2-memo");
      await expect(memo.getByText("집 차이 변화").first()).toBeVisible();
      await expect(memo.getByText(/8\.0% \(원본 ratio\)/)).toBeVisible();
      await expect(
        memo.getByText("실전수와 추천 후보수의 차이").first()
      ).toBeVisible();
      await expect(memo.getByText("참고 수순").first()).toBeVisible();
      await expect(page.getByText("흐름 변화 참고")).toHaveCount(0);
      await expect(
        page.getByText(
          /scoreLoss=|winrateLoss=|comparisonType=|delta=|adjacency_heuristic_only|B\[pd\]/
        )
      ).toHaveCount(0);
      await expect(page.getByText("참고도 표시 중")).toHaveCount(0);

      await page.getByRole("button", { name: "수 18" }).click();
      await expect(page.getByText(/검토 #18/)).toBeVisible();
      await expect(page.getByText("PV 있음")).toBeVisible();
      await expect(
        page
          .getByTestId("explanation-plan-v2-memo")
          .getByText("보수적 개념 힌트")
          .first()
      ).toBeVisible();
      await expect(
        page
          .getByTestId("explanation-plan-v2-memo")
          .getByText("실전수와 추천 후보수의 차이")
          .first()
      ).toBeVisible();
      await expect(
        page.getByText(
          /concept=|scoreLoss=|winrateLoss=|comparisonType=|delta=|adjacency_heuristic_only|B\[pd\]/
        )
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "참고도 보기" })
      ).toBeEnabled();

      await page.getByRole("button", { name: "참고도 보기" }).click();
      await expect(page.getByText("참고도 표시 중")).toBeVisible();
      await expect(page.getByText(/선택한 참고도 수순/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "전체 수순으로 돌아가기" })
      ).toBeVisible();

      await page
        .getByRole("button", { name: "전체 수순으로 돌아가기" })
        .click();
      await expect(page.getByText("참고도 표시 중")).toHaveCount(0);

      await page.getByRole("button", { name: "놓아보기" }).click();
      await expect(
        page.getByText(
          "화면에서만 놓아보는 기능이며, KataGo 재분석은 수행하지 않습니다."
        )
      ).toBeVisible();
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

      await expect(
        page.getByText(/패착|실수|악수|blunder|mistake|정답/i)
      ).toHaveCount(0);
      await expectNoPageHorizontalOverflow(page);
    });
  }

  test("stops timeline polling after the endpoint reports disabled", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("katatalk-ui-lang", "ko");
    });

    let statusCalls = 0;
    let timelineCalls = 0;
    await page.route(
      `**/api/analyze/${productReviewE2eJobId}/timeline-progress`,
      async route => {
        timelineCalls += 1;
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            message: "Timeline progress is not enabled.",
          }),
        });
      }
    );
    await page.route(`**/api/analyze/${productReviewE2eJobId}`, async route => {
      statusCalls += 1;
      if (statusCalls === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            success: true,
            jobId: productReviewE2eJobId,
            status: "running",
            progress: 40,
            createdAt: "2026-07-14T00:00:00.000Z",
            updatedAt: "2026-07-14T00:00:01.000Z",
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(productReviewCompletedJobResponse),
      });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("img", { name: "바둑판 국면 스냅샷" })
    ).toBeVisible();
    expect(statusCalls).toBe(2);
    expect(timelineCalls).toBe(1);
  });

  test("deletes a completed result only after confirmation", async ({ page }) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await installCompletedJobFixture(page, "en");

    let deleteRequests = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}/data`, async route => {
      deleteRequests += 1;
      expect(route.request().method()).toBe("DELETE");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, purged: true }),
      });
    });
    page.once("dialog", async dialog => {
      expect(dialog.type()).toBe("confirm");
      await dialog.accept();
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`, {
      waitUntil: "domcontentloaded",
    });
    const deleteButton = page.getByRole("button", {
      name: "Delete analysis data",
    });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    await expect.poll(() => deleteRequests).toBe(1);
    await expect(page).toHaveURL("http://127.0.0.1:3200/");
    await expect(deleteButton).toHaveCount(0);
    await expect(page.getByText("Analysis data deleted.")).toBeVisible();
  });

  test("does not delete a completed result when confirmation is dismissed", async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await installCompletedJobFixture(page, "en");

    let deleteRequests = 0;
    await page.route(`**/api/analyze/${productReviewE2eJobId}/data`, async route => {
      deleteRequests += 1;
      await route.fulfill({ status: 500 });
    });
    page.once("dialog", async dialog => {
      expect(dialog.type()).toBe("confirm");
      await dialog.dismiss();
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`, {
      waitUntil: "domcontentloaded",
    });
    const deleteButton = page.getByRole("button", {
      name: "Delete analysis data",
    });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    await page.waitForTimeout(250);
    expect(deleteRequests).toBe(0);
    await expect(page).toHaveURL(new RegExp(`jobId=${productReviewE2eJobId}`));
    await expect(deleteButton).toBeVisible();
  });
});

test.describe("Timeline progress polling hardening", () => {
  test("stops progress polling after 404 while status polling completes", async ({ page }) => {
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
        } : productReviewCompletedJobResponse),
      });
    });
    await page.route(`**/api/analyze/${productReviewE2eJobId}/timeline-progress`, async (route) => {
      progressCalls += 1;
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ success: false }) });
    });

    await page.goto(`/?jobId=${productReviewE2eJobId}`);
    await expect(page.getByRole("img", { name: "바둑판 국면 스냅샷" })).toBeVisible();
    await page.waitForTimeout(1200);
    expect(progressCalls).toBe(1);
    expect(statusCalls).toBeGreaterThanOrEqual(2);
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
        body: JSON.stringify(statusCalls === 1 ? {
          success: true,
          jobId: productReviewE2eJobId,
          status: "running",
          progress: 40,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        } : productReviewCompletedJobResponse),
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
    expect(progressCalls).toBe(1);
    expect(statusCalls).toBeGreaterThanOrEqual(2);
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
});
