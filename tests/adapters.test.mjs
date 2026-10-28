import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  SOURCE_INFO,
  FETCHERS,
  ARENA_FORMAT,
  aaManifest,
  decryptAAGzip,
  aaIndexVersion,
  parseAA,
  parseArena,
  parseVals,
  parseLivebench,
} from "../server/adapters.mjs";

// AA 的全量数据是 AES-256-GCM 加密后 gzip 的 JSON，IV 取 SHA-256(key) 前 12 字节。
const KEY = "aa".repeat(32);
const dataIv = (keyHex) =>
  createHash("sha256")
    .update(Buffer.from(keyHex, "hex"))
    .digest()
    .subarray(0, 12);
function seal(models, keyHex = KEY, { gzip = true } = {}) {
  const key = Buffer.from(keyHex, "hex");
  const cipher = createCipheriv("aes-256-gcm", key, dataIv(keyHex));
  const plain = gzip
    ? gzipSync(JSON.stringify(models))
    : Buffer.from(JSON.stringify(models));
  const body = Buffer.concat([
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  // Flight 分片是 JS 字符串字面量，引号在原始 HTML 里必须呈转义形态。
  const html =
    '<script>self.__next_f.push([1,"20:[\\"$\\",\\"div\\",null,{' +
    '\\"manifest\\":{\\"path\\":\\"/data/fixture.txt\\",\\"key\\":\\"' +
    keyHex +
    '\\"}}]"]))</script>';
  return { html, body };
}
function serveAA({ html, body }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url === SOURCE_INFO.aa.url) return new Response(html, { status: 200 });
    if (url.endsWith("/data/fixture.txt"))
      return new Response(body, { status: 200 });
    throw new Error("测试未预期的请求：" + url);
  };
  return () => {
    globalThis.fetch = original;
  };
}
const filler = (n) =>
  Array.from({ length: n }, (_, i) => ({
    slug: `model-${i}`,
    name: `Model ${i}`,
    shortName: `Model ${i}`,
    deprecated: false,
    isOpenWeights: i % 2 === 0,
    intelligenceIndex: 10 + i * 0.25,
    intelligenceIndexCostPerTask: i % 4 === 0 ? 0.01 * i : "$undefined",
    price1mInputTokens: 1 + i,
    price1mOutputTokens: 2 + i,
    medianOutputTokensPerSecond: 100 + i,
    medianTimeToFirstTokenSeconds: 0.5,
    modelCreatorName: "Creator",
  }));
test("AA index version is recorded because v4.3.2 and v5.0 scores are not comparable", () => {
  assert.equal(
    aaIndexVersion('x"name":"Artificial Analysis Intelligence Index v5.0"y'),
    "Intelligence Index v5.0",
  );
  // 更新日志里的简称「Updated to Intelligence Index v5」不是版本标签
  assert.equal(
    aaIndexVersion('"description":"Updated to Intelligence Index v5"'),
    null,
  );
  assert.equal(aaIndexVersion("<h1>challenge</h1>"), null);
});
test("AA manifest ingestion retains full precision, cost, effort, history and openness", async () => {
  const restore = serveAA(
    seal([
      ...filler(119),
      {
        slug: "legacy-99",
        name: "Legacy 99 (max)",
        shortName: null,
        deprecated: true,
        isOpenWeights: true,
        intelligenceIndex: 12.345,
        intelligenceIndexCostPerTask: 0.002,
        intelligenceIndexIsEstimated: true,
        price1mInputTokens: "$undefined",
        price1mOutputTokens: "$undefined",
        medianOutputTokensPerSecond: 50,
        medianTimeToFirstTokenSeconds: 1.5,
        modelCreatorName: "Old",
      },
    ]),
  );
  try {
    const result = await FETCHERS.aa();
    assert.equal(result.rows.length, 120);
    const r = result.rows.find((x) => x.name === "Legacy 99 (max)");
    assert.equal(r.score, 12.345);
    assert.equal(r.costTask, 0.002);
    assert.equal(r.openWeights, true);
    assert.equal(r.deprecated, true);
    assert.equal(r.estimated, true);
    assert.equal(r.priceInput, null);
    assert.equal(r.priceOutput, null);
    assert.equal(r.speed, 50);
    assert.equal(r.latency, 1.5);
    assert.equal(r.creator, "Old");
    assert.equal(r.url, "https://artificialanalysis.ai/models/legacy-99");
    assert.equal(r.configuration, "Legacy 99 (max)");
    // shortName 缺失时回落到 name；isOpenWeights 逐行保留
    assert.equal(result.rows.filter((x) => x.openWeights === false).length, 59);
    assert.equal(result.sourceDate, null);
  } finally {
    restore();
  }
});
test("AA rejects truncated payloads and payloads missing openness metadata", () => {
  assert.throws(() => parseAA(filler(99)), /不完整/);
  const noFlags = filler(120).map((m, i) =>
    i < 30 ? { ...m, isOpenWeights: undefined } : m,
  );
  assert.throws(() => parseAA(noFlags), /开放权重/);
  assert.throws(() => parseAA("<h1>challenge</h1>"), /模型列表不是数组/);
  // 载荷里混进非对象条目时跳过该行，而不是让 typeof 解引抛 TypeError
  const mixed = [null, undefined, "x", 42, ...filler(120)];
  assert.equal(parseAA(mixed).rows.length, 120);
});
test("AA manifest and payload failures fail clearly instead of returning invented data", async () => {
  assert.throws(() => aaManifest("<h1>challenge</h1>"), /结构变化/);
  const models = filler(120);
  // 密钥不对：AES-GCM 认证失败
  const wrong = seal(models, "bb".repeat(32));
  await assert.rejects(() => decryptAAGzip(wrong.body, KEY), /解密失败/);
  // 密钥不是 32 字节时明确失败，而不是让 WebCrypto 抛难懂的错误
  await assert.rejects(() => decryptAAGzip(wrong.body, "abcd"), /密钥长度异常/);
  // 密文对但明文不是 gzip
  const ungzipped = seal(models, KEY, { gzip: false });
  await assert.rejects(
    () => decryptAAGzip(ungzipped.body, KEY),
    /解压或解析失败/,
  );
  // 页面拿不到 manifest 时，整条链路在第一步就明确失败
  const restore = serveAA({
    html: "<h1>challenge</h1>",
    body: Buffer.alloc(0),
  });
  try {
    await assert.rejects(() => FETCHERS.aa(), /结构变化/);
  } finally {
    restore();
  }
});
test("Vals model row uses th rather than td and keeps cost separate from token pricing", () => {
  const r = parseVals(
    '<p>Updated 10/13/2026</p><table><thead><tr><th>Rank</th><th>Model</th><th>Accuracy</th><th>Cost / Test</th><th>Input / Output Cost</th><th>Input / Output Tokens</th><th>Duration</th></tr></thead><tbody><tr><td>1</td><th scope="row">New 99</th><td>61.15%</td><td>$3.24</td><td>$2 / $10</td><td>4B / 2M</td><td>12m</td></tr></tbody></table>',
  );
  assert.equal(r.rows[0].name, "New 99");
  assert.equal(r.rows[0].score, 61.15);
  assert.equal(r.rows[0].costTask, 3.24);
  assert.equal(r.rows[0].priceOutput, 10);
  assert.equal(r.rows[0].duration, "12m");
});
test("Vals parses the current six-column table without inventing token prices", () => {
  const r = parseVals(
    '<p>Updated 10/24/2026</p><table><thead><tr><th>Rank</th><th>Model</th><th>Accuracy</th><th>Cost / Test</th><th>Tokens / Test</th><th>Duration / Test</th></tr></thead><tbody><tr><td>1</td><th scope="row">Model A</th><td>70.85%</td><td>$18.70</td><td>78.59m</td><td>1h26m</td></tr><tr><td>2</td><th scope="row">Model B</th><td>0%</td><td>-</td><td>5.95m</td><td>7m27s</td></tr></tbody></table>',
  );
  assert.equal(r.sourceDate, "10/24/2026");
  assert.deepEqual(
    r.rows.map(
      ({ name, score, costTask, priceInput, priceOutput, duration }) => ({
        name,
        score,
        costTask,
        priceInput,
        priceOutput,
        duration,
      }),
    ),
    [
      {
        name: "Model A",
        score: 70.85,
        costTask: 18.7,
        priceInput: null,
        priceOutput: null,
        duration: "1h26m",
      },
      {
        name: "Model B",
        score: 0,
        costTask: null,
        priceInput: null,
        priceOutput: null,
        duration: "7m27s",
      },
    ],
  );
});
test("Vals uses column headers and rejects missing required headers", () => {
  const html =
    '<table><thead><tr><th>Cost / Test</th><th>Duration / Test</th><th>Accuracy</th><th>Model</th></tr></thead><tbody><tr><td>$3.24</td><td>12m</td><td>61.15%</td><th scope="row">New 99</th></tr></tbody></table>';
  const row = parseVals(html).rows[0];
  assert.equal(row.name, "New 99");
  assert.equal(row.score, 61.15);
  assert.equal(row.costTask, 3.24);
  assert.equal(row.duration, "12m");
  assert.throws(() => parseVals(html.replace("Accuracy", "Other")), /结构变化/);
});
const valsHtml = (slugs) =>
  `<table><thead><tr><th>Rank</th><th>Model</th><th>Accuracy</th><th>Cost / Test</th><th>Tokens / Test</th><th>Duration / Test</th></tr></thead><tbody>${slugs.map((slug, i) => `<tr><td>${i + 1}</td><th><a href="/models/${slug}">Model ${i}</a></th><td>50%</td><td>$1</td><td>2m</td><td>3m</td></tr>`).join("")}</tbody></table>`;
const valsComparison = (models) => {
  const props = {
    initialModels: [
      1,
      models.map(({ slug, key, input, output, visible = true }) => [
        0,
        {
          slug: [0, slug],
          full_key: [0, key],
          metadata: [0, { show_cost: [0, visible] }],
          costs_per_million_token: [
            0,
            { input: [0, input], output: [0, output] },
          ],
        },
      ]),
    ],
  };
  const escaped = JSON.stringify(props).replaceAll('"', "&quot;");
  return `<astro-island component-url="/_astro/ModelComparison.test.js" props="${escaped}"></astro-island>`;
};
test("Vals reference prices use precise official values and match model identity", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    if (url.pathname === "/benchmarks/vals_index")
      return new Response(valsHtml(["lab_a", "lab_b", "lab_c"]));
    if (url.pathname === "/models/lab_c")
      return new Response(
        '<a href="/comparison?modelA=lab%2Finternal-c">Compare Models</a>',
      );
    if (url.pathname === "/comparison") {
      const keys = url.searchParams.get("m");
      if (keys === "lab/internal-c")
        return new Response(
          valsComparison([
            {
              slug: "lab_c",
              key: "lab/internal-c",
              input: 0.075,
              output: 0.25,
            },
          ]),
        );
      return new Response(
        valsComparison([
          {
            slug: "lab_b",
            key: "lab/b",
            input: 99,
            output: 99,
            visible: false,
          },
          { slug: "lab_a", key: "lab/a", input: 0.435, output: 0.87 },
        ]),
      );
    }
    throw new Error("测试未预期的请求：" + url);
  };
  try {
    const result = await FETCHERS.vals();
    assert.equal(result.rows[0].priceInput, 0.435);
    assert.equal(result.rows[0].priceOutput, 0.87);
    assert.match(
      result.rows[0].priceUrl,
      /^https:\/\/www\.vals\.ai\/comparison\?/,
    );
    assert.equal(result.rows[1].priceInput, null);
    assert.equal(result.rows[1].priceOutput, null);
    assert.equal(result.rows[2].priceInput, 0.075);
    assert.equal(result.rows[2].priceOutput, 0.25);
    assert.equal(result.rows[0].costTask, 1);
    assert.ok(requests.some((url) => url.pathname === "/models/lab_c"));
    assert.ok(result.notes.some((note) => note.includes("参考单价")));
  } finally {
    globalThis.fetch = original;
  }
});
test("Vals rejects refresh when the reference price lookup fails", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    return url.pathname === "/benchmarks/vals_index"
      ? new Response(valsHtml(["lab_a"]))
      : new Response("unavailable", { status: 503 });
  };
  try {
    await assert.rejects(() => FETCHERS.vals(), /参考单价.*未能获取/);
  } finally {
    globalThis.fetch = original;
  }
});
test("Vals reports changed price metadata instead of treating it as undisclosed", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/benchmarks/vals_index")
      return new Response(valsHtml(["lab_a"]));
    if (url.pathname === "/comparison")
      return new Response(
        valsComparison([
          { slug: "lab_a", key: "lab/a", input: 1, output: 2 },
        ]).replaceAll("costs_per_million_token", "changed_cost_field"),
      );
    return new Response("<p>missing comparison link</p>");
  };
  try {
    await assert.rejects(() => FETCHERS.vals(), /参考单价.*未能获取/);
  } finally {
    globalThis.fetch = original;
  }
});
test("Vals reference lookups respect the seven-model comparison limit", async () => {
  const original = globalThis.fetch;
  const slugs = Array.from({ length: 8 }, (_, i) => `lab_model-${i}`);
  const batches = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/benchmarks/vals_index")
      return new Response(valsHtml(slugs));
    if (url.pathname === "/comparison") {
      const batch = url.searchParams.get("m").split(",");
      batches.push(batch);
      return new Response(
        valsComparison(
          batch.map((slug) => ({
            slug,
            key: slug.replace("_", "/"),
            input: 0.435,
            output: 0.87,
          })),
        ),
      );
    }
    throw new Error("测试未预期的请求：" + url);
  };
  try {
    const result = await FETCHERS.vals();
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [7, 1],
    );
    assert.equal(result.rows.length, 8);
    assert.ok(result.rows.every((row) => row.priceInput === 0.435));
  } finally {
    globalThis.fetch = original;
  }
});
test("LiveBench correctly distinguishes cost per task from successful-task cost", () => {
  const js =
    'const meta={"new-99":{url:"https://example.com",organization:"New",displayName:"New 99",effort:"max",openweight:!0}}';
  const r = parseLivebench(
    "model,coding,reasoning\nnew-99,50,100\n",
    "model,coding,nq_coding,reasoning,nq_reasoning,input_price_per_million,output_price_per_million\nnew-99,20,10,10,20,1,2\n",
    js,
  ).rows[0];
  assert.equal(r.score, 75);
  assert.equal(r.costTask, 1);
  assert.equal(r.costSuccess, 1 / 0.75);
  assert.equal(r.openWeights, true);
  assert.equal(r.name, "New 99");
});
// LiveBench 摄取编排：v1 发布文件在 /v1/table_<日期>.csv，v2 在
// /data/<紧凑日期>/table.csv；站点对未命中路径可能返回 SPA 壳（HTTP 200 + HTML），
// 表头校验是唯一拦网。布局与双形态 id 的来历见 docs/adr/0008。
const LB_HOME =
  '<html><head><script src="/static/js/main.test.js"></script></head></html>';
const LB_JS = [
  'const _e=["20261014"];',
  'const Me=e=>e.slice(0,4)+"-"+e.slice(4,6)+"-"+e.slice(6,8);',
  'const Oe=[...["2024-06-24","2026-06-25"].map((e=>({id:e,label:e,gen:"v1"}))),..._e.map((e=>({id:e,label:Me(e),gen:"v2"})))];',
  'const meta={"new-99":{url:"https://example.com",organization:"New",displayName:"New 99",effort:"max",openweight:!0}};',
  'const legacy={"new-99":{url:"https://example.com",organization:"Old",displayName:"Old 99",effort:"low",openweight:!0}};',
  "//# sourceMappingURL=main.test.js.map",
].join("\n");
const LB_MAP = JSON.stringify({
  sources: ["Table/modelLinks.data.js", "v1/Table/modelLinks.js"],
  sourcesContent: [
    `export const modelLinks = ${JSON.stringify({
      "new-99": {
        url: "https://example.com",
        organization: "New",
        displayName: "New 99",
        effort: "max",
        openweight: true,
      },
    })};`,
    'export const modelLinks = {"new-99": {url: "https://example.com", organization: "Old", displayName: "Old 99", effort: "low", openweight: true}, "base": {organization: "Old", variants: [{rawName: "new-99-variant", displayName: "Variant 99"}]}};',
  ],
});
const LB_TABLE = "model,coding,reasoning\nnew-99,50,100\n";
const LB_COST =
  "model,coding,nq_coding,reasoning,nq_reasoning,input_price_per_million,output_price_per_million\nnew-99,20,10,10,20,1,2\n";
const LB_SPA = "<!doctype html><title>livebench.ai</title>";
// routes 登记 pathname → 响应体；未登记的路径一律 404（源站对缺失文件的行为）。
// getText 只接受 2xx，404 即抛错被摄取层捕获后继续探测下一个布局。
function serveLivebench(routes) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(
      typeof input === "string" ? input : String(input?.url ?? input),
    );
    seen.push(url.pathname);
    const hit =
      routes[url.pathname] ??
      (url.pathname === "/static/js/main.test.js.map" ? LB_MAP : undefined);
    return hit === undefined
      ? new Response("", { status: 404 })
      : new Response(hit, { status: 200 });
  };
  return { seen, restore: () => (globalThis.fetch = original) };
}
test("LiveBench ingestion picks the newest release across v1/v2 id forms and layouts", async () => {
  const { seen, restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/data/20261014/table.csv": LB_TABLE,
    "/data/20261014/cost.csv": LB_COST,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].name, "New 99");
    assert.equal(r.rows[0].configuration, "max");
    assert.equal(r.sourceDate, "2026-10-14");
    assert.equal(r.releaseKey, "20261014");
    assert.equal(seen[0], "/");
    assert.ok(seen.includes("/static/js/main.test.js"));
    // 最新发布首发命中：不再继续探测旧布局
    assert.equal(seen.filter((p) => p.includes("table")).length, 1);
  } finally {
    restore();
  }
});
test("LiveBench ingestion falls back from v2 layout to v1 layout for older releases", async () => {
  const { seen, restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/v1/table_2026_06_25.csv": LB_TABLE,
    "/v1/cost_2026_06_25.csv": LB_COST,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.sourceDate, "2026-06-25");
    assert.equal(r.releaseKey, "2026-06-25");
    assert.equal(r.rows[0].name, "Old 99");
    assert.equal(r.rows[0].configuration, "low");
    assert.ok(
      seen.indexOf("/data/20261014/table.csv") <
        seen.indexOf("/v1/table_2026_06_25.csv"),
    );
  } finally {
    restore();
  }
});
test("LiveBench v1 leaves unsupported nested variant metadata unknown", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/v1/table_2026_06_25.csv":
      "model,coding,reasoning\nnew-99-variant,50,100\n",
  });
  try {
    const row = (await FETCHERS.livebench()).rows[0];
    assert.equal(row.name, "new-99-variant");
    assert.equal(row.configuration, "未确认");
    assert.equal(row.openWeights, null);
  } finally {
    restore();
  }
});
test("LiveBench refuses ambiguous metadata if the matching source map is invalid", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/static/js/main.test.js.map": "not a source map",
    "/data/20261014/table.csv": LB_TABLE,
  });
  try {
    await assert.rejects(() => FETCHERS.livebench(), /LiveBench.*元数据/);
  } finally {
    restore();
  }
});
test("LiveBench rejects a nonempty registry whose model metadata disappeared", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/static/js/main.test.js.map": JSON.stringify({
      sources: ["Table/modelLinks.data.js"],
      sourcesContent: ['export const modelLinks = {"new-99": null};'],
    }),
    "/data/20261014/table.csv": LB_TABLE,
  });
  try {
    await assert.rejects(() => FETCHERS.livebench(), /LiveBench.*元数据/);
  } finally {
    restore();
  }
});
test("LiveBench ingestion still accepts the pre-migration root layout", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/table_2026_06_25.csv": LB_TABLE,
    "/cost_2026_06_25.csv": LB_COST,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.sourceDate, "2026-06-25");
    assert.equal(r.rows.length, 1);
  } finally {
    restore();
  }
});
test("LiveBench ingestion rejects SPA shell responses instead of parsing them as data", async () => {
  const { seen, restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    // v2 布局返回 200 但内容是 SPA 壳：必须跳过并落到 v1 真实数据
    "/data/20261014/table.csv": LB_SPA,
    "/v1/table_2026_06_25.csv": LB_TABLE,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.sourceDate, "2026-06-25");
    assert.equal(r.rows[0].score, 75);
    assert.ok(seen.includes("/data/20261014/table.csv"));
  } finally {
    restore();
  }
});
test("LiveBench ingestion treats an HTML-shell cost file as missing, not as costs", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
    "/data/20261014/table.csv": LB_TABLE,
    "/data/20261014/cost.csv": LB_SPA,
  });
  try {
    const r = await FETCHERS.livebench();
    assert.equal(r.rows[0].costTask, null);
    assert.equal(r.rows[0].priceInput, null);
    assert.equal(r.rows[0].priceOutput, null);
    assert.equal(r.rows[0].score, 75);
  } finally {
    restore();
  }
});
test("LiveBench ingestion failures name the broken contract instead of inventing data", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": LB_JS,
  });
  try {
    await assert.rejects(() => FETCHERS.livebench(), /发布文件未找到/);
  } finally {
    restore();
  }
  const noList = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js": "console.log('no releases here')",
  });
  try {
    await assert.rejects(() => FETCHERS.livebench(), /发布列表未找到/);
  } finally {
    noList.restore();
  }
  const noScript = serveLivebench({ "/": "<html><p>改版了</p></html>" });
  try {
    await assert.rejects(() => FETCHERS.livebench(), /入口脚本位置变化/);
  } finally {
    noScript.restore();
  }
});
test("parser structure drift fails clearly instead of returning invented data", () => {
  assert.throws(() => parseVals("<h1>new</h1>"), /结构变化/);
});
test("AA missing-value sentinels become null instead of invalid prices", () => {
  const r = parseAA([
    ...filler(119),
    {
      name: "Missing costs",
      isOpenWeights: true,
      intelligenceIndex: 10,
      intelligenceIndexCostPerTask: "$undefined",
      price1mInputTokens: "$undefined",
      price1mOutputTokens: "$undefined",
    },
  ]).rows.at(-1);
  assert.equal(r.costTask, null);
  assert.equal(r.priceInput, null);
  assert.equal(r.priceOutput, null);
});

test("LiveBench retains a source release label distinct from the file key", async () => {
  const { restore } = serveLivebench({
    "/": LB_HOME,
    "/static/js/main.test.js":
      LB_JS + '\nconst labels={"2026-06-25":"2026-06-26"};',
    "/v1/table_2026_06_25.csv": LB_TABLE,
  });
  try {
    const result = await FETCHERS.livebench();
    assert.equal(result.releaseKey, "2026-06-25");
    assert.equal(result.sourceDate, "2026-06-26");
  } finally {
    restore();
  }
});

// Arena 单文件 Parquet 的记录形状（2026-10-15 实测）：
// model_name / organization / license / rating / rating_lower / rating_upper /
// vote_count / category / leaderboard_publish_date。
const arenaRow = (over = {}) => ({
  model_name: "Gemini 4 Argon (High)",
  organization: "google",
  license: "proprietary",
  rating: 1532.3375436695164,
  rating_lower: 1500,
  rating_upper: 1560,
  vote_count: 4904,
  category: "overall",
  leaderboard_publish_date: "2026-10-15",
  ...over,
});
test("Arena ingestion keeps the overall split with raw rating, votes, interval and date", () => {
  const r = parseArena([
    arenaRow(),
    arenaRow({
      model_name: "Llama 4 Maverick",
      organization: "meta",
      license: "Llama 4 Community License",
      rating: 0,
      rating_lower: -5,
      rating_upper: 5,
      vote_count: 0,
    }),
    arenaRow({ model_name: "Coder 1", category: "webdev" }),
  ]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.ingestFormat, ARENA_FORMAT);
  assert.equal(r.sourceDate, "2026-10-15");
  const g = r.rows[0];
  assert.equal(g.rawId, "Gemini 4 Argon (High)");
  assert.equal(g.name, "Gemini 4 Argon (High)");
  assert.equal(g.configuration, "Gemini 4 Argon (High)");
  assert.equal(g.creator, "Google");
  assert.equal(g.score, 1532.3375436695164);
  assert.equal(g.voteCount, 4904);
  assert.equal(g.scoreLower, 1500);
  assert.equal(g.scoreUpper, 1560);
  assert.equal(g.publishedAt, "2026-10-15");
  assert.equal(g.openWeights, false);
  assert.equal(g.costTask, null);
  assert.equal(g.url, SOURCE_INFO.arena.url);
  // 零分与零票按有限数接纳；区间允许跨零；已知开源许可证识别为开放权重
  const l = r.rows[1];
  assert.equal(l.score, 0);
  assert.equal(l.voteCount, 0);
  assert.equal(l.scoreLower, -5);
  assert.equal(l.openWeights, true);
  assert.equal(l.creator, "Meta");
});
test("Arena accepts negative ratings and unknown licenses without inventing openness", () => {
  const r = parseArena([
    arenaRow({
      model_name: "Old Model",
      organization: "mystery-lab",
      license: null,
      rating: -3.5,
      rating_lower: -10,
      rating_upper: 3,
      vote_count: 120,
    }),
    // 真实快照存在 50 条 organization 为空串的记录，不能让空串穿透为空 creator
    arenaRow({ model_name: "Blank Org", organization: "" }),
  ]);
  assert.equal(r.rows[0].score, -3.5);
  assert.equal(r.rows[0].creator, "mystery-lab");
  assert.equal(r.rows[1].creator, "未披露");
  assert.equal(r.rows[0].openWeights, null);
});
test("Arena rejects missing overall split, duplicates and mixed publish dates", () => {
  assert.throws(() => parseArena("nope"), /模型列表不是数组/);
  assert.throws(
    () => parseArena([arenaRow({ category: "webdev" })]),
    /缺少文本 overall 总榜/,
  );
  assert.throws(() => parseArena([arenaRow(), arenaRow()]), /重复配置/);
  assert.throws(
    () =>
      parseArena([
        arenaRow(),
        arenaRow({
          model_name: "Other",
          leaderboard_publish_date: "2026-10-08",
        }),
      ]),
    /发布日期不一致/,
  );
});
test("Arena rejects invalid names, ratings, intervals, votes and dates instead of clipping them", () => {
  const bad = (over) => () => parseArena([arenaRow(over)]);
  const invalid = /无效的模型、评分、票数、区间或发布日期/;
  assert.throws(bad({ model_name: "  " }), invalid);
  assert.throws(bad({ model_name: null }), invalid);
  assert.throws(bad({ rating: Number.NaN }), invalid);
  assert.throws(bad({ rating: undefined }), invalid);
  assert.throws(bad({ rating_lower: 1600 }), invalid);
  assert.throws(bad({ rating_upper: 1500 }), invalid);
  assert.throws(bad({ rating_lower: "1500" }), invalid);
  assert.throws(bad({ vote_count: -1 }), invalid);
  assert.throws(bad({ vote_count: Number.NaN }), invalid);
  assert.throws(bad({ leaderboard_publish_date: "2026/10/15" }), invalid);
  assert.throws(bad({ leaderboard_publish_date: "2026-02-30" }), invalid);
  assert.throws(bad({ leaderboard_publish_date: "Oct 15, 2026" }), invalid);
});
test("Arena download failures and corrupted files fail clearly instead of inventing rows", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 404 });
  try {
    await assert.rejects(() => FETCHERS.arena(), /HTTP 404/);
  } finally {
    globalThis.fetch = original;
  }
  // 非 Parquet 字节（HTML 错误页伪装 200）必须在解码层失败，不能产出部分数据
  globalThis.fetch = async () =>
    new Response("<!doctype html><title>Unexpected</title>", { status: 200 });
  try {
    await assert.rejects(() => FETCHERS.arena());
  } finally {
    globalThis.fetch = original;
  }
});
