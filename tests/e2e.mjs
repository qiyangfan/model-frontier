import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const base = process.env.FRONTIER_URL ?? "http://localhost:4317";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
page.on("pageerror", (e) => errors.push(e.message));
async function choose(label, text) {
  console.log("select", label, text);
  await page.evaluate(() => scrollTo(0, 0));
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await page.waitForTimeout(250);
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ has: page.getByText(text, { exact: true }) })
    .click();
}
try {
  await page.goto(base);
  await page.evaluate(() =>
    localStorage.setItem(
      "frontier:preferences",
      JSON.stringify({
        preset: "capability",
        weights: { arena: 10, aa: 35, vals: 30, livebench: 25 },
        minSources: 4,
        coverageSchemaVersion: 2,
        costSchemaVersion: 2,
      }),
    ),
  );
  await page.evaluate(() => history.replaceState(null, "", location.pathname));
  await page.reload();
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem("frontier:preferences"));
    return p && !("weights" in p) && !("preset" in p) && !("minSources" in p);
  });
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("frontier:legacy-preferences"),
    ),
    null,
    "不再为评分兼容创建偏好备份",
  );
  await page.getByRole("tab", { name: "前沿探索", exact: true }).click();
  await page.getByRole("heading", { name: "综合能力 / 成本前沿" }).waitFor();
  await page.locator("canvas").waitFor();
  const range = page.getByRole("radiogroup", { name: "模型范围" });
  assert.equal(await range.getByText("开放优先", { exact: true }).count(), 0);
  const openSort = page.getByRole("checkbox", { name: "开放优先排序" });
  assert.equal(await openSort.isChecked(), true);
  assert.equal(
    await page
      .locator(".chart-legend")
      .getByRole("button", { name: "开放权重前沿", exact: true })
      .count(),
    0,
  );
  await openSort.uncheck();
  assert.equal(
    await range
      .getByRole("radio", { name: "全部模型", exact: true })
      .isChecked(),
    true,
  );
  await range.getByText("仅开放权重", { exact: true }).click();
  assert.equal(await openSort.isDisabled(), true);
  assert.equal(
    await page
      .locator(".chart-legend")
      .getByRole("button", { name: "开放权重前沿", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .locator(".chart-legend")
      .getByRole("button", { name: "全球前沿", exact: true })
      .count(),
    0,
  );
  await range.getByText("全部模型", { exact: true }).click();
  assert.equal(await openSort.isEnabled(), true);
  await openSort.check();
  await page
    .getByText("综合相对成本（基准 1 倍）", { exact: true })
    .first()
    .waitFor();
  assert.equal(await page.getByLabel("覆盖度微调", { exact: true }).count(), 0);
  const data = await (await page.request.get(base + "/api/data")).json();
  assert.ok(data.models.length > 100);
  assert.deepEqual(Object.keys(data.sources).sort(), [
    "aa",
    "arena",
    "livebench",
    "vals",
  ]);
  // Arena 已回归第四评分来源：必须有真实数据进入模型族，且披露票数证据
  assert.ok(data.sources.arena.count > 100, "Arena overall 配置应超过 100 条");
  assert.ok(
    data.models.some(
      (m) =>
        Number.isFinite(m.representatives?.arena?.score) &&
        Number.isFinite(m.representatives.arena.voteCount),
    ),
    "至少一个模型族应带有 Arena 评分与票数",
  );
  assert.ok(Object.values(data.sources).every((s) => s.count > 5 && !s.stale));
  const checkOverflow = async () => {
    await page.waitForFunction(
      () => document.documentElement.scrollWidth <= innerWidth,
      null,
      { timeout: 4000 },
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  };
  await checkOverflow();
  // Mouse wheel must scroll the document, rather than trigger chart zoom.
  await page.locator("canvas").scrollIntoViewIfNeeded();
  const canvasBox = await page.locator("canvas").boundingBox();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.55,
    canvasBox.y + canvasBox.height * 0.45,
  );
  const previousScroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction((y) => scrollY > y, previousScroll, {
    timeout: 3000,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "重置图表", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "放大图表", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "重置图表", exact: true })
      .isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "重置图表", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "重置图表", exact: true })
      .isDisabled(),
    true,
  );
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载图表", exact: true }).click();
  const png = await pngPromise;
  assert.equal(png.suggestedFilename(), "model-frontier.png");
  await page.getByRole("button", { name: "切换图表全屏", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.getByRole("button", { name: "切换图表全屏", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  const legend = page
    .locator(".chart-legend")
    .getByRole("button", { name: "闭源 / 未确认", exact: true });
  // 点身颜色已让位给厂商身份色，图例标记是中性空心圆（形状编码开放/闭源）
  assert.equal(
    await legend
      .locator("span")
      .evaluate((e) => getComputedStyle(e).borderColor),
    "rgb(101, 123, 139)",
  );
  assert.equal(await legend.evaluate((e) => getComputedStyle(e).opacity), "1");
  await legend.click();
  assert.equal(await legend.getAttribute("aria-pressed"), "false");
  await legend.click();
  const chartStage = page.locator(".chart-stage");
  const plottedBefore = await chartStage.getAttribute("data-chart-points");
  await page.getByLabel("帕累托搜索", { exact: true }).fill("MiMo");
  await page.locator(".search-hint").waitFor();
  assert.match(
    await page.locator(".search-hint").innerText(),
    /命中 \d+ 个模型/,
  );
  assert.equal(
    await chartStage.getAttribute("data-chart-points"),
    plottedBefore,
    "搜索不应从图表移除点位",
  );
  await mkdir("test-artifacts", { recursive: true });
  await page.screenshot({
    path: "test-artifacts/search-highlight.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await checkOverflow();
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole("button", { name: /MiMo V2.6 Pro/ }).click();
  await page
    .getByText(
      "按模型族归并。这里保留各榜单具体配置；跨站分数不代表同一个推理档位。",
    )
    .waitFor();
  // 标题带「源数据」链接，可访问名以 Arena 开头
  assert.equal(
    await page
      .getByRole("dialog")
      .getByRole("heading", { name: /^Arena/ })
      .count(),
    1,
    "详情抽屉应有 Arena 单榜区",
  );
  await page
    .getByRole("dialog")
    .getByText("盲测投票数", { exact: false })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("帕累托搜索", { exact: true }).fill("");
  await page.locator(".search-hint").waitFor({ state: "hidden" });
  assert.equal(
    await chartStage.getAttribute("data-chart-points"),
    plottedBefore,
    "清空搜索后图表点位数保持不变",
  );
  await page
    .locator(".scoring-context")
    .getByText(/至少 2 榜/)
    .waitFor();
  assert.equal(
    await page.getByRole("combobox", { name: "权重预设", exact: true }).count(),
    0,
  );
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV", exact: true }).click();
  const download = await csvPromise;
  assert.equal(download.suggestedFilename(), "model-frontier.csv");
  const csv = await readFile(await download.path(), "utf8");
  assert.ok(csv.includes("MiMo"));
  assert.ok(csv.includes("开放权重前沿"));
  await choose("成本来源", "Vals 每次测试成本");
  assert.equal(
    await page.getByRole("tab", { name: "成本敏感性", exact: true }).count(),
    0,
  );
  await page.getByRole("tab", { name: "数据来源与刷新", exact: true }).click();
  assert.equal(await page.locator(".source-card").count(), 4);
  await page.getByText("703 条源站模型配置", { exact: false }).count();
  await page
    .locator(".source-card")
    .filter({ hasText: "Arena" })
    .getByText("Text Overall · 人类盲测偏好", { exact: true })
    .waitFor();
  const response = await page.request.put(base + "/api/settings", {
    data: { refreshHours: 7 },
  });
  assert.equal(response.status(), 400);
  const rejected = await page.request.post(base + "/api/refresh", {
    headers: { Origin: "https://external.invalid" },
  });
  assert.equal(rejected.status(), 403);
  await page.getByRole("button", { name: "计算方法", exact: true }).click();
  await page
    .getByRole("heading", { name: "如何确定每榜票数？", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("dialog")
      .getByText(/最低榜单覆盖/)
      .count(),
    0,
    "方法说明不应引用已删除控件",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "前沿探索", exact: true }).click();
  await choose("成本来源", "AA 每次任务成本");
  await page.evaluate(() => localStorage.removeItem("frontier:preferences"));
  await page.reload();
  await page.locator("canvas").waitFor();
  let idleDataRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/data") idleDataRequests += 1;
  });
  // 空闲轮询只打 /api/status；整包数据按 revision 拉取，不应重建画布或重置缩放。
  const before = await page.locator("canvas").evaluate((e) => {
    e.dataset.qaIdentity = "retained";
    return e.dataset.qaIdentity;
  });
  await page.waitForTimeout(5500);
  assert.equal(
    await page.locator("canvas").getAttribute("data-qa-identity"),
    before,
  );
  assert.equal(idleDataRequests, 0, "空闲轮询不应重复拉取整包数据");
  await mkdir("test-artifacts", { recursive: true });
  await page.screenshot({ path: "test-artifacts/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await checkOverflow();
  await page.screenshot({ path: "test-artifacts/mobile.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 812, height: 375 });
  await checkOverflow();
  // 刷新请求失败时按钮必须复位，不能永久停留在 loading。
  await page.route("**/api/refresh", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ status: 500, json: { error: "QA failure" } });
  });
  await page.getByRole("button", { name: "从源站刷新", exact: true }).click();
  await page.locator(".refresh-control .anticon-loading").waitFor();
  await page.getByText("刷新请求失败", { exact: true }).waitFor();
  await page
    .locator(".refresh-control .anticon-loading")
    .waitFor({ state: "hidden" });
  await page.unroute("**/api/refresh");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        sourceCounts: Object.fromEntries(
          Object.entries(data.sources).map(([k, v]) => [k, v.count]),
        ),
        modelFamilies: data.models.length,
        uiChecks: [
          "chart",
          "wheel page scroll",
          "zoom buttons",
          "PNG export",
          "fullscreen",
          "legend toggle",
          "detail",
          "fixed two-source scoring",
          "cost",
          "source coverage",
          "arena fourth source",
          "CSV",
          "source status",
          "settings validation",
          "local origin guard",
          "method",
          "search highlights chart",
          "search 375px",
          "passive polling",
          "failed refresh resets busy",
          "375px",
          "landscape",
          "reduced motion",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await mkdir("test-artifacts", { recursive: true });
  await page.screenshot({ path: "test-artifacts/failure.png", fullPage: true });
  throw e;
} finally {
  await browser.close();
}
