import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  DEFAULT_PROBE_PORTS,
  applyProxyEnv,
  parseScutilOutput,
  probePort,
  resolveProxyEnv,
  systemProxy,
} from "../server/proxyEnv.mjs";

const SCUTIL_FULL = `<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
  }
  HTTPEnable : 1
  HTTPPort : 15732
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 15732
  HTTPSProxy : 127.0.0.1
  ProxyAutoConfigEnable : 0
  SOCKSEnable : 0
}`;

test("parseScutilOutput：HTTPS 启用时取 HTTPS 通道", () => {
  assert.deepEqual(parseScutilOutput(SCUTIL_FULL), {
    host: "127.0.0.1",
    port: 15732,
  });
});

test("parseScutilOutput：仅 HTTP 启用时取 HTTP 通道", () => {
  const text = `HTTPEnable : 1
HTTPPort : 6152
HTTPProxy : 192.168.1.2
HTTPSEnable : 0
HTTPSPort : 6152
HTTPSProxy : 192.168.1.2`;
  assert.deepEqual(parseScutilOutput(text), {
    host: "192.168.1.2",
    port: 6152,
  });
});

test("parseScutilOutput：未启用、畸形输出、端口越界一律 null", () => {
  assert.equal(parseScutilOutput("HTTPEnable : 0\nHTTPSEnable : 0"), null);
  assert.equal(parseScutilOutput(""), null);
  assert.equal(
    parseScutilOutput("HTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : abc"),
    null,
  );
  assert.equal(
    parseScutilOutput(
      "HTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : 70000",
    ),
    null,
  );
});

test("probePort：真监听返回 true，没人听返回 false", async () => {
  const listener = createServer();
  await new Promise((ok) => listener.listen(0, "127.0.0.1", ok));
  const port = listener.address().port;
  assert.equal(await probePort("127.0.0.1", port, 300), true);
  await new Promise((done) => listener.close(done));
  assert.equal(await probePort("127.0.0.1", port, 300), false);
});

test("resolveProxyEnv：环境变量已有就直说，不探测、不问系统", async () => {
  const boom = () => {
    throw new Error("不应触发");
  };
  assert.deepEqual(
    await resolveProxyEnv(
      { https_proxy: "http://10.0.0.1:8080" },
      { probePort: boom, systemProxy: boom },
    ),
    { url: "http://10.0.0.1:8080", source: "环境变量" },
  );
});

test("resolveProxyEnv：系统代理设置活着就采用，探测的是系统登记的地址", async () => {
  const probed = [];
  const sys = await resolveProxyEnv(
    {},
    {
      systemProxy: async () => ({ host: "127.0.0.1", port: 15732 }),
      probePort: async (host, port) => {
        probed.push(`${host}:${port}`);
        return host === "127.0.0.1" && port === 15732;
      },
    },
  );
  assert.deepEqual(sys, {
    url: "http://127.0.0.1:15732",
    source: "系统代理设置",
  });
  assert.deepEqual(probed, ["127.0.0.1:15732"]);
});

test("resolveProxyEnv：系统设置失效就落回端口探测，FRONTIER_PROXY_PORTS 插队最前", async () => {
  const sys = await resolveProxyEnv(
    { FRONTIER_PROXY_PORTS: "19999, 0, abc" },
    {
      systemProxy: async () => ({ host: "127.0.0.1", port: 15732 }),
      probePort: async (_host, port) => port === 19999 || port === 7890,
    },
  );
  assert.deepEqual(sys, { url: "http://127.0.0.1:19999", source: "端口探测" });
});

test("resolveProxyEnv：自定义端口全哑则按默认列表顺序取第一个活的", async () => {
  const sys = await resolveProxyEnv(
    {},
    {
      systemProxy: async () => null,
      probePort: async (_host, port) => port === 7897,
    },
  );
  assert.deepEqual(sys, { url: `http://127.0.0.1:7897`, source: "端口探测" });
});

test("resolveProxyEnv：哪儿都找不到代理就返回 null（直连）", async () => {
  const sys = await resolveProxyEnv(
    {},
    { systemProxy: async () => null, probePort: async () => false },
  );
  assert.equal(sys, null);
});

test("systemProxy：非 macOS 直接 null；真环境里输出形状合法", async () => {
  assert.equal(await systemProxy("linux"), null);
  const sys = await systemProxy("darwin");
  assert.ok(
    sys === null ||
      (typeof sys.host === "string" && Number.isInteger(sys.port)),
    "darwin 实机返回应是 null 或 {host, port}",
  );
});

test("applyProxyEnv：大小写变量都写上，回环豁免补齐", () => {
  const env = {};
  applyProxyEnv(env, "http://127.0.0.1:15732");
  assert.equal(env.http_proxy, "http://127.0.0.1:15732");
  assert.equal(env.https_proxy, "http://127.0.0.1:15732");
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:15732");
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:15732");
  assert.equal(env.no_proxy, "localhost,127.0.0.1,::1");
  assert.equal(env.NO_PROXY, "localhost,127.0.0.1,::1");
});

test("applyProxyEnv：已有 no_proxy 只追加缺失的回环豁免，已有豁免不动", () => {
  const env = { no_proxy: "internal.corp" };
  applyProxyEnv(env, "http://127.0.0.1:15732");
  assert.equal(env.no_proxy, "internal.corp,localhost,127.0.0.1,::1");
  const untouched = { NO_PROXY: "localhost,127.0.0.1" };
  applyProxyEnv(untouched, "http://127.0.0.1:15732");
  assert.equal(untouched.NO_PROXY, "localhost,127.0.0.1");
});

test("默认探测端口表稳定且全部为合法端口", () => {
  assert.ok(DEFAULT_PROBE_PORTS.length >= 5);
  for (const p of DEFAULT_PROBE_PORTS)
    assert.ok(Number.isInteger(p) && p >= 1 && p <= 65535);
});
