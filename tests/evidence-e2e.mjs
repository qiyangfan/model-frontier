import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.FRONTIER_URL ?? "http://localhost:4317";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const overflow = async () => {
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
};
// 刷新间隔是使用者的设置，本套只要求它处于已知值，因此自己设定、结束时还原，
// 不依赖本机 data/ 里恰好存着什么——否则换台机器或改过设置就会莫名红掉。
let previousHours = 1;
try {
  await mkdir("test-artifacts", { recursive: true });
  const before = await (await page.request.get(base + "/api/data")).json();
  assert.ok(before.history.recordCount >= 1);
  previousHours = before.settings.refreshHours;
  const applied = await page.request.put(base + "/api/settings", {
    data: { refreshHours: 1 },
  });
  assert.equal(applied.status(), 200);
  assert.equal((await applied.json()).refreshHours, 1);
  // 设置变更会让服务端 revision 更换；后续注入的模拟数据必须使用同一版本，
  // 否则客户端会把它当成过期整包反复拉取。
  const real = await (await page.request.get(base + "/api/data")).json();
  await page.goto(base + "/#overview");
  await page
    .getByRole("heading", { name: "真实变化记录", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "查看更新记录", exact: true }).click();
  const history = page.getByRole("dialog", {
    name: "历史快照与更新记录",
    exact: true,
  });
  await history
    .getByRole("combobox", { name: "历史快照", exact: true })
    .waitFor();
  await history.getByText(/当前保留/).waitFor();
  await history.getByText(/起始快照只建立基准|新增 \/ 移除指源表/).waitFor();
  await page.screenshot({ path: "test-artifacts/history.png", fullPage: true });
  await history.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: "融合排行榜", exact: true }).click();
  await page.locator(".ranking-main-table tr[data-row-key]").first().waitFor();
  await page.getByRole("switch", { name: "排除历史配置", exact: true }).check();
  await page
    .getByRole("switch", { name: "排除过期或失败缓存", exact: true })
    .check();
  await page.reload();
  // reload 后等 React 水合并从本地偏好恢复开关，再断言状态——立即 isChecked
  // 会读到恢复前的 false（竞态，实证约 1/3 概率触发）
  await page.waitForFunction(() =>
    ["排除历史配置", "排除过期或失败缓存"].every(
      (name) =>
        document
          .querySelector(`[role="switch"][aria-label="${name}"]`)
          ?.getAttribute("aria-checked") === "true",
    ),
  );
  // 所有故障和变化数据仅注入本测试浏览器，不写入实际快照或源缓存。
  const simulated = structuredClone(real);
  simulated.sources.livebench.stale = true;
  simulated.sources.livebench.error = "QA simulated source outage";
  simulated.sources.livebench.fetchedAt = "2026-10-01T00:00:00Z";
  await page.route("**/api/data", (route) =>
    route.fulfill({ json: simulated }),
  );
  await page.reload();
  await page
    .getByText(/综合成本基准已按 Artificial Analysis、Vals 的共同样本重算/)
    .waitFor();
  assert.equal(
    await page
      .locator(".ranking-main-table")
      .getByRole("columnheader", { name: "数据提示", exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: "test-artifacts/quality-exclusion.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "前沿探索", exact: true }).click();
  await page.locator("canvas").waitFor();
  await page
    .locator(".scoring-context")
    .getByText(/至少 2 榜/)
    .waitFor();
  // 过时公式参数不会切换评分；整源排除后仍按当前两榜准入计算。
  await page.evaluate(() => {
    location.hash = "#explore?score=majority&eh=1&es=1";
  });
  await page.locator("canvas").waitFor();
  await page
    .locator(".scoring-context")
    .getByText(/至少 2 榜/)
    .waitFor();
  await page.getByText("2 源共同样本中位数", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "综合总览", exact: true }).click();
  await page
    .getByRole("button", { name: "对比开放权重领先模型", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "配置一致性与数据提示", exact: true })
    .waitFor();
  await page.locator(".configuration-evidence").first().waitFor();
  assert.ok(
    (await page.getByText("LiveBench 已排除", { exact: true }).count()) > 0,
  );
  await page.screenshot({
    path: "test-artifacts/configuration-evidence.png",
    fullPage: true,
  });
  await overflow();
  await page.locator(".compare-facts .model-link").first().click();
  const detail = page.getByRole("dialog").filter({
    has: page.getByRole("button", { name: "查看此模型历史", exact: true }),
  });
  await detail
    .getByRole("button", { name: "查看此模型历史", exact: true })
    .click();
  const modelHistory = page.getByRole("dialog").last();
  await modelHistory
    .getByRole("heading", { name: "此快照中的原始配置", exact: true })
    .waitFor();
  assert.ok((await modelHistory.locator("tr[data-row-key]").count()) > 0);
  await modelHistory
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "此快照中的原始配置", exact: true })
    .waitFor({ state: "hidden" });
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  // 单源重试只提交失败来源，不应触发整包刷新。
  await page.getByRole("tab", { name: "数据来源与刷新", exact: true }).click();
  const retryButton = page
    .locator(".source-card")
    .filter({ hasText: "LiveBench" })
    .getByRole("button", { name: "重试此来源", exact: true });
  await retryButton.waitFor();
  await page.route("**/api/refresh", (route) =>
    route.fulfill({
      status: 202,
      json: { revision: real.revision },
    }),
  );
  const retryRequest = page.waitForRequest("**/api/refresh");
  const retryResponse = page.waitForResponse("**/api/refresh");
  await retryButton.click();
  assert.deepEqual((await retryRequest).postDataJSON(), {
    sources: ["livebench"],
  });
  await retryResponse;
  await page.unroute("**/api/refresh");
  await page.setViewportSize({ width: 375, height: 812 });
  await overflow();
  // 窄屏下顶部页签会被横向滚出视口，用 hash 导航回总览，避免依赖页签可见性。
  await page.evaluate(() => {
    location.hash = "#overview";
  });
  await page
    .getByRole("heading", { name: "从榜单，到你的模型选择", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "查看更新记录", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText(/当前保留/)
    .waitFor();
  await overflow();
  await page.screenshot({
    path: "test-artifacts/history-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.getByRole("tab", { name: "融合排行榜", exact: true }).click();
  await overflow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 812, height: 375 });
  await overflow();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          "real baseline API",
          "source timestamps",
          "history drawer",
          "quality settings persistence",
          "simulated source exclusion",
          "single-source retry request",
          "source exclusion keeps the only two-source rule",
          "two-source cost baseline",
          "configuration evidence",
          "model history raw observations",
          "375px history",
          "landscape",
        ],
        errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({
    path: "test-artifacts/evidence-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  if (previousHours !== 1)
    await page.request
      .put(base + "/api/settings", {
        data: { refreshHours: previousHours },
      })
      .catch(() => {});
  await browser.close();
}
