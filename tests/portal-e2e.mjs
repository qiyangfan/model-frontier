import { chromium } from "playwright";
import { shareHash } from "../src/share.mjs";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const base = process.env.FRONTIER_URL ?? "http://localhost:4317";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const tab = async (name) => {
  const target = page.getByRole("tab", { name, exact: true });
  const clipped = await target.evaluate((el) => {
    const wrap = el.closest(".ant-tabs-nav-wrap").getBoundingClientRect();
    const tab = el.getBoundingClientRect();
    return tab.left < wrap.left || tab.right > wrap.right;
  });
  if (clipped) {
    await page.locator(".portal-tabs .ant-tabs-nav-more").click();
    await page.getByRole("option", { name, exact: true }).click();
    return;
  }
  await target.click();
};
const source = async (name) => {
  await page
    .locator(".ranking-intro .ant-segmented-item")
    .filter({ hasText: name })
    .click();
};
const overflow = async () => {
  await page.waitForFunction(
    () => document.documentElement.scrollWidth <= innerWidth,
  );
};
try {
  await mkdir("test-artifacts", { recursive: true });
  await page.goto(base + "/#overview");
  await page.evaluate(() => {
    localStorage.removeItem("frontier:preferences");
    localStorage.removeItem("frontier:comparison");
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "综合能力领先", exact: true })
    .waitFor();
  await page.locator(".leader-row").first().waitFor();
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem("frontier:preferences"));
    return saved && !("preset" in saved) && !("scoringVersion" in saved);
  });
  await page.waitForFunction(() => !location.hash.includes("score="));
  assert.equal(await page.getByRole("tab").count(), 5);
  // 性价比首选卡片（ADR-0020）：完整榜单至少 1 行、名次徽章从 1 起、夹具存在未入池尾表；
  // 不写模型名与具体行数，不钉认证态（夹具重生成后认证与否可能翻转）
  const valueCard = page.locator(".value-pick-card");
  await valueCard
    .getByRole("heading", { name: "性价比首选", exact: true })
    .waitFor();
  assert.equal((await valueCard.locator(".leader-row").count()) >= 1, true);
  assert.equal(
    await valueCard.locator(".leader-row .rank-badge").first().textContent(),
    "1",
  );
  await valueCard.getByText("未入池", { exact: true }).waitFor();
  await page.goto(base + "/#stability?");
  await page
    .getByRole("heading", { name: "综合能力领先", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("tab", { name: "成本敏感性", exact: true }).count(),
    0,
  );
  await overflow();
  await page.screenshot({
    path: "test-artifacts/overview.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "对比开放权重领先模型", exact: true })
    .click();
  await page
    .getByRole("img", { name: "各榜排名分对比图", exact: true })
    .waitFor();
  assert.equal(await page.locator(".compare-facts").count(), 2);
  await page
    .getByRole("cell", { name: "Artificial Analysis · 排名分", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "Vals · 排名分", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "LiveBench · 排名分", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "Arena · 排名分", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "Arena · 投票数", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".compare-selector .ant-select-selection-item").count(),
    3,
  );
  await overflow();
  await page.screenshot({ path: "test-artifacts/compare.png", fullPage: true });
  await page.reload();
  await page
    .getByRole("img", { name: "各榜排名分对比图", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".compare-selector .ant-select-selection-item").count(),
    3,
  );
  await page.getByRole("button", { name: "清空对比", exact: true }).click();
  await page
    .getByText("从排行榜勾选模型，或在上方搜索添加", { exact: true })
    .waitFor();
  await tab("融合排行榜");
  assert.equal(
    await page
      .locator(".ranking-main-table")
      .getByRole("columnheader", { name: "数据提示", exact: true })
      .count(),
    0,
  );
  await page
    .locator(".ranking-main-table .ant-table-tbody tr[data-row-key]")
    .first()
    .waitFor();
  await overflow();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前榜单", exact: true }).click();
  const csv = await downloadPromise;
  assert.equal(csv.suggestedFilename(), "model-ranking.csv");
  const fusionCsv = await readFile(await csv.path(), "utf8");
  assert.ok(fusionCsv.includes("PK主积分"));
  assert.ok(fusionCsv.includes("评分口径"), "导出缺少评分口径列");
  assert.ok(fusionCsv.includes("数据时间"), "导出缺少数据时间列");
  const boxes = page.locator(
    ".ranking-main-table .ant-table-tbody tr[data-row-key] .ant-checkbox-input",
  );
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole("button", { name: "对比所选模型", exact: true }).click();
  await page
    .getByRole("img", { name: "各榜排名分对比图", exact: true })
    .waitFor();
  assert.equal(
    await page.locator(".compare-selector .ant-select-selection-item").count(),
    2,
  );
  await tab("融合排行榜");
  await source("Artificial Analysis");
  await page.getByText("包含历史配置", { exact: true }).waitFor();
  const nativeDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前榜单", exact: true }).click();
  const native = await nativeDownload;
  assert.equal(native.suggestedFilename(), "aa-ranking.csv");
  const nativeText = await readFile(await native.path(), "utf8");
  assert.ok(nativeText.includes("原始总分"));
  assert.ok(!nativeText.includes("综合分"));
  await page
    .getByRole("checkbox", { name: "包含历史配置", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "包含估算配置", exact: true })
    .check();
  await page
    .getByRole("textbox", { name: "排行榜搜索", exact: true })
    .fill("DeepSeek");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".ranking-table tr[data-row-key]")].every(
      (r) => r.textContent.toLowerCase().includes("deepseek"),
    ),
  );
  assert.ok(
    (await page.locator(".ranking-table tr[data-row-key]").count()) > 0,
  );
  await page.getByRole("textbox", { name: "排行榜搜索", exact: true }).fill("");
  await source("Vals");
  await page
    .getByText(
      "Vals 的原始总分与原生任务成本。不同任务协议和推理配置不能视为统一实验。",
      { exact: true },
    )
    .waitFor();
  await page
    .locator(".ranking-table")
    .getByRole("columnheader", {
      name: "输入 / 输出参考单价 USD 每百万 token",
      exact: true,
    })
    .waitFor();
  await source("LiveBench");
  await page
    .getByText(
      "LiveBench 分类分数的等权均分与原生任务成本；源站 Overall 可能采用不同权重。",
      { exact: true },
    )
    .waitFor();
  await page
    .locator(".ranking-table")
    .getByRole("columnheader", { name: "分类等权均分", exact: true })
    .waitFor();
  await source("Arena");
  await page
    .getByText(
      "Arena 文本总榜原始偏好评分；票数、区间与发布日期直接来自源站，不是融合置信度。该来源不提供任务成本。",
      { exact: true },
    )
    .waitFor();
  await page
    .locator(".ranking-table")
    .getByText("盲测投票数", { exact: false })
    .first()
    .waitFor();
  const arenaDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前榜单", exact: true }).click();
  const arenaCsvFile = await arenaDownload;
  assert.equal(arenaCsvFile.suggestedFilename(), "arena-ranking.csv");
  const arenaCsv = await readFile(await arenaCsvFile.path(), "utf8");
  assert.ok(arenaCsv.includes("原始总分"));
  assert.ok(arenaCsv.includes("投票数"), "Arena 导出缺少投票数列");
  assert.ok(arenaCsv.includes("发布日期"), "Arena 导出缺少发布日期列");
  await source("融合总榜");
  await page.screenshot({
    path: "test-artifacts/rankings.png",
    fullPage: true,
  });
  const coverageDiagnostic = page.locator(".coverage-cohort-diagnostic");
  const coverageSummary = coverageDiagnostic.locator("summary");
  await coverageSummary.click();
  await coverageDiagnostic
    .getByText(/只纳入所选榜单都有有效分的模型/)
    .waitFor();
  const coverageCount = Number(
    (await coverageSummary.innerText()).match(/· (\d+) 个模型/)?.[1],
  );
  const coverageSelect = coverageDiagnostic.getByRole("combobox", {
    name: "同一组榜单对照",
  });
  await coverageSelect.waitFor();
  let selectedCoverageMask = null;
  let selectedCoverageLabel = null;
  if (coverageCount >= 2) {
    const coverageTable = coverageDiagnostic.locator(".coverage-cohort-table");
    await coverageTable
      .getByRole("columnheader", { name: "对照 PK 积分", exact: true })
      .waitFor();
    await coverageDiagnostic
      .locator(".coverage-cohort-table")
      .getByRole("columnheader", { name: "主榜名次", exact: true })
      .waitFor();
    await coverageSelect.click();
    const coverageOptions = page.getByRole("option");
    const coverageOptionCount = await coverageOptions.count();
    assert.ok(coverageOptionCount >= 1, "榜单组合对照选项为空");
    if (coverageOptionCount > 1) {
      const initialCoverageMask = await page.evaluate(() =>
        new URLSearchParams(location.hash.split("?")[1] ?? "").get("cm"),
      );
      await coverageOptions.nth(1).click();
      await page.waitForFunction((previous) => {
        const current = new URLSearchParams(
          location.hash.split("?")[1] ?? "",
        ).get("cm");
        return current && current !== previous;
      }, initialCoverageMask);
      // 地址栏同步有 250ms 去抖（见 main.jsx 的 shareTarget effect）：上面检测到的
      // 变化可能仍是上一次待写入的旧值，此刻读 cm 会与选择器显示的口径不一致。
      // 等一个完整去抖窗口再读，保证 cm 与标签同源。
      await page.waitForTimeout(400);
      selectedCoverageMask = await page.evaluate(() =>
        new URLSearchParams(location.hash.split("?")[1] ?? "").get("cm"),
      );
      selectedCoverageLabel = await coverageSelect
        .locator("xpath=..")
        .innerText();
      assert.ok(selectedCoverageMask, "选择榜单组合后分享链接没有 cm 参数");
      await page.reload();
      await coverageSummary.click();
      await page.waitForFunction((expectedLabel) => {
        const select = document.querySelector("#coverage-mask-select");
        return select?.parentElement?.innerText.trim() === expectedLabel;
      }, selectedCoverageLabel);
      assert.equal(
        await page.evaluate(() =>
          new URLSearchParams(location.hash.split("?")[1] ?? "").get("cm"),
        ),
        selectedCoverageMask,
        "重开分享链接后榜单组合参数发生变化",
      );
      assert.equal(
        await coverageDiagnostic
          .getByRole("combobox", { name: "同一组榜单对照" })
          .locator("xpath=..")
          .innerText(),
        selectedCoverageLabel,
        "重开分享链接后没有恢复所选榜单组合",
      );
    }
  } else {
    await coverageDiagnostic
      .getByText(/没有至少两个模型拥有相同的两榜以上有效数据/)
      .waitFor();
  }
  await coverageSummary.click();
  // 厂商快捷筛选：chip 与厂商下拉同源，激活态写入分享链接，再次点击取消
  await page.locator(".creator-chip", { hasText: "DeepSeek" }).click();
  await page.waitForFunction(() => location.hash.includes("cr="));
  assert.ok(
    (await page.locator(".ranking-main-table tr[data-row-key]").count()) > 0,
  );
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(".ranking-main-table tr[data-row-key]"),
    ].every((r) => r.textContent.includes("DeepSeek")),
  );
  await page.locator('.creator-chip[aria-pressed="true"]').click();
  await page.waitForFunction(() => !location.hash.includes("cr="));
  // 探索页表格厂商过滤与帕累托搜索互相独立。
  await tab("前沿探索");
  await page
    .getByRole("combobox", { name: "表格厂商筛选", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "表格厂商筛选", exact: true })
    .fill("Kimi");
  await page.getByRole("option", { name: "Kimi", exact: true }).click();
  await page.waitForFunction(() => location.hash.includes("cr=Kimi"));
  assert.ok((await page.locator(".models-panel tr[data-row-key]").count()) > 0);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".models-panel tr[data-row-key]")].every(
      (r) => r.textContent.includes("Kimi"),
    ),
  );
  await page
    .locator(".pareto-vendor-search .creator-chip", { hasText: "DeepSeek" })
    .click();
  await page.waitForFunction(() => {
    const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
    return params.get("cr") === "Kimi" && params.get("pq") === "DeepSeek";
  });
  assert.equal(
    await page.getByRole("textbox", { name: "帕累托搜索" }).inputValue(),
    "DeepSeek",
  );
  assert.match(await page.locator(".search-hint").innerText(), /全部点位保留/);
  assert.ok(
    (await page.locator(".models-panel tr[data-row-key]").count()) > 0,
    "帕累托搜索不应清除表格厂商过滤",
  );
  await page
    .locator('.pareto-vendor-search .creator-chip[aria-pressed="true"]')
    .click();
  await page.waitForFunction(() => {
    const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
    return params.get("pq") === null && params.get("cr") === "Kimi";
  });
  await page
    .locator('.models-panel .creator-chip[aria-pressed="true"]')
    .click();
  await page.waitForFunction(() => !location.hash.includes("cr="));
  await tab("融合排行榜");
  // 能力维度、口径差异、预算筛选与分享链接
  await page
    .getByRole("checkbox", { name: "LiveBench 能力维度", exact: true })
    .check();
  await page
    .locator(".ranking-main-table")
    .getByRole("columnheader", { name: /编程/ })
    .waitFor();
  await page
    .getByRole("checkbox", { name: "LiveBench 能力维度", exact: true })
    .uncheck();
  assert.equal(
    await page
      .getByRole("group", { name: "覆盖口径差异", exact: true })
      .count(),
    0,
    "融合排行榜不再展示覆盖口径差异面板",
  );
  await page
    .getByRole("combobox", { name: "预算成本来源", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ has: page.getByText("Artificial Analysis", { exact: true }) })
    .click();
  await page
    .getByRole("spinbutton", { name: "预算上限，美元每次任务", exact: true })
    .fill("1");
  await page.locator(".budget-note").waitFor();
  assert.equal(
    await page.getByText("该来源当前被质量排除", { exact: false }).count(),
    0,
  );
  await overflow();
  await page
    .getByRole("spinbutton", { name: "预算上限，美元每次任务", exact: true })
    .fill("");
  await page
    .getByRole("combobox", { name: "预算成本来源", exact: true })
    .click();
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ has: page.getByText("不限制", { exact: true }) })
    .click();
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await page.getByRole("switch", { name: "排除历史配置", exact: true }).check();
  await page.getByRole("button", { name: "复制分享链接", exact: true }).click();
  await page.getByRole("button", { name: "已复制链接", exact: true }).waitFor();
  const shareLink = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(
    shareLink.includes("#rankings?") &&
      shareLink.includes("eh=1") &&
      shareLink.includes("sel="),
    "分享链接缺少口径参数：" + shareLink,
  );
  await page
    .getByRole("switch", { name: "排除历史配置", exact: true })
    .uncheck();
  await page.goto(base + "/#rankings?p=equal&ms=3");
  await page.reload();
  await page
    .locator(".scoring-context")
    .getByText(/四榜各一票/)
    .waitFor();
  await page
    .locator(".scoring-context")
    .getByText(/至少 2 榜/)
    .waitFor();
  // 同文档粘贴分享链接（仅 hash 变化、不重载）也必须恢复口径，而不是被状态同步覆盖。
  await page.evaluate(() => {
    location.hash = "#rankings?cs=vals&ms=1";
  });
  await page
    .locator(".scoring-context")
    .getByText(/至少 2 榜/)
    .waitFor();
  await page
    .locator(".ranking-main-table")
    .getByRole("columnheader", { name: "Vals 每次测试成本", exact: true })
    .waitFor();
  // 带参数链接缺省字段一律取默认值（与 reload 一致），不回落本地偏好：上一步已把 cs=vals 写入本地偏好。
  await page.goto(base + "/#rankings?p=equal&ms=1");
  await page.reload();
  await page
    .locator(".ranking-main-table")
    .getByRole("columnheader", {
      name: "综合相对成本（基准 1 倍）",
      exact: true,
    })
    .waitFor();
  // 当前成本与质量设置跨页面保留，评分规则始终相同。
  await tab("模型对比");
  await page
    .locator(".scoring-context")
    .getByText(/四榜各一票/)
    .waitFor();
  await page
    .locator(".scoring-context")
    .getByText(/至少 10 个有效对手/)
    .waitFor();
  assert.equal(
    await page.locator(".compare-selector .ant-select-selection-item").count(),
    2,
  );
  // 带过时参数的地址仍统一使用当前规则；正式积分与原始分差同时可查。
  // 不写死模型 ID：对比对沿用上面从排行榜勾选的前两行，随当前数据自愈，
  // 夹具与实时数据都能给出裁决（写死 ID 会在源站下架模型后超时）。
  await page.evaluate(() => {
    location.hash = "#compare?score=majority";
  });
  await page.locator(".majority-comparison").waitFor();
  await page
    .locator(".majority-comparison")
    .getByRole("columnheader", { name: "共同有效榜", exact: true })
    .waitFor();
  await page
    .locator(".majority-comparison")
    .getByText(/\d\/4 榜 · (计入 PK|不计 PK)/)
    .waitFor();
  // 第四票接入后，具体票数随真实数据变化，只锁定「有裁决」与 Arena 计票列存在
  await page
    .locator(".majority-comparison")
    .getByRole("columnheader", { name: "Arena", exact: true })
    .waitFor();
  await page
    .locator(".majority-comparison")
    .getByText(/∶\d+（\d+ 平票）· (左方获胜|右方获胜|对决平局)/)
    .waitFor();
  await page.reload();
  await page
    .locator(".majority-comparison")
    .getByText(/∶\d+（\d+ 平票）· (左方获胜|右方获胜|对决平局)/)
    .waitFor();
  await page.evaluate(() => {
    location.hash = "#compare?score=majority2";
  });
  await page
    .getByRole("cell", {
      name: "榜单位次均值（仅 PK 同分排序）",
      exact: true,
    })
    .waitFor();
  await page.reload();
  await page
    .getByRole("cell", {
      name: "榜单位次均值（仅 PK 同分排序）",
      exact: true,
    })
    .waitFor();
  await tab("融合排行榜");
  assert.equal(
    await page.getByRole("combobox", { name: "权重预设", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("combobox", { name: "最低榜单覆盖", exact: true })
      .count(),
    0,
  );
  await page
    .locator(".ranking-main-table")
    .getByRole("columnheader", { name: "PK 主积分", exact: true })
    .waitFor();
  const opponentCount = page
    .locator(".ranking-main-table")
    .getByText(/\d+ 个对手/)
    .first();
  await opponentCount.hover();
  await page.getByText(/双方共有 2 个有效评分榜/).waitFor();
  const majorityExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前榜单", exact: true }).click();
  const majorityCsv = await readFile(
    await (await majorityExport).path(),
    "utf8",
  );
  assert.ok(majorityCsv.includes("四榜多数对决"));
  assert.ok(
    majorityCsv.includes(
      "四榜多数对决 Bradley-Terry（主榜至少 10 个有效对手，位次均值仅同分排序）",
    ),
  );
  assert.ok(majorityCsv.includes("位次均值仅同分排序"));
  assert.ok(majorityCsv.includes("主榜至少 10 个有效对手"));
  assert.ok(majorityCsv.includes("BT强度θ"));
  assert.ok(majorityCsv.includes("现行综合分（Copeland）"));
  assert.ok(majorityCsv.includes("名次差"));
  assert.ok(majorityCsv.includes("双方共有2个有效评分榜的对局数"));
  await tab("模型对比");
  await page.locator(".method-comparison").waitFor();
  await page
    .locator(".method-comparison")
    .getByRole("columnheader", { name: "BT 名次", exact: true })
    .waitFor();
  await page
    .locator(".method-comparison")
    .getByRole("columnheader", {
      name: "现行 Copeland 胜率",
      exact: true,
    })
    .waitFor();
  // 全默认分享也必须覆盖接收方不同的本机偏好。
  const receiver = await browser.newPage();
  try {
    await receiver.addInitScript(() =>
      localStorage.setItem(
        "frontier:preferences",
        JSON.stringify({
          costSchemaVersion: 2,
          costSource: "aa",
          includeEstimated: true,
          excludeHistorical: true,
          excludeStale: true,
        }),
      ),
    );
    await receiver.goto(base + "/" + shareHash("rankings"));
    await receiver
      .locator(".ranking-main-table")
      .getByRole("columnheader", {
        name: "综合相对成本（基准 1 倍）",
        exact: true,
      })
      .waitFor();
    for (const name of [
      "允许 AA 估算分数",
      "排除历史配置",
      "排除过期或失败缓存",
    ]) {
      assert.equal(
        await receiver.getByRole("switch", { name, exact: true }).isChecked(),
        false,
        "默认分享不应继承接收方偏好：" + name,
      );
    }
  } finally {
    await receiver.close();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await overflow();
  await page.screenshot({
    path: "test-artifacts/compare-mobile.png",
    fullPage: true,
  });
  await tab("综合总览");
  await overflow();
  await page.screenshot({
    path: "test-artifacts/overview-mobile.png",
    fullPage: true,
  });
  await tab("融合排行榜");
  await overflow();
  await page.screenshot({
    path: "test-artifacts/rankings-mobile.png",
    fullPage: true,
  });
  await page.locator(".ranking-main-table .ant-table-content").evaluate((e) => {
    e.scrollLeft = 450;
  });
  assert.ok(
    (await page
      .locator(".ranking-main-table .ant-table-content")
      .evaluate((e) => e.scrollLeft)) > 0,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 812, height: 375 });
  await overflow();
  await tab("模型对比");
  await overflow();
  await page.goBack();
  await page
    .getByRole("tab", { name: "融合排行榜", exact: true })
    .getAttribute("aria-selected")
    .then((v) => assert.equal(v, "true"));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        pages: 5,
        checks: [
          "overview",
          "four-source rankings",
          "arena native board and evidence",
          "native full configurations",
          "native export",
          "fusion export metadata",
          "search",
          "row selection",
          "comparison persistence",
          "raw cost and suites",
          "livebench suite columns",
          "scope difference panel removed",
          "single scoring rule without formula parameters",
          "default share overrides recipient preferences",
          "majority ballots, raw differences and export",
          "budget filter",
          "share link copy and restore",
          "share defaults override local prefs",
          "shared current settings",
          "375px pages",
          "landscape",
          "reduced motion",
        ],
        errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await page.screenshot({
    path: "test-artifacts/portal-failure.png",
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
}
