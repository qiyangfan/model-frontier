import net from "node:net";
import { spawnSync } from "node:child_process";

// Arena 源（Hugging Face）直连不通时需要走本地代理，而 Node 内置 fetch 只认
// 「进程启动那一刻」就已存在的代理环境变量——启动后再设无效。所以找代理这件事
// 必须发生在服务进程起来之前，由 scripts/with-proxy.mjs 调用本模块完成后注入
// 子进程环境。发现顺序：环境变量 → 系统代理设置（macOS）→ 本机常见端口探测，
// 全部落空则返回 null（直连，Arena 单源失败不影响其余三站）。

// 常见本地代理 HTTP 端口：Clash 系 7890 / Clash Verge 7897 / Shadowsocks 系 1087 /
// v2rayN 系 10809 / Surge 6152。顺序即优先级，可用 FRONTIER_PROXY_PORTS 在前面插队。
export const DEFAULT_PROBE_PORTS = [7890, 7897, 1087, 10809, 6152];
const PROBE_TIMEOUT_MS = 400;

// 探测 host:port 是否有服务在监听。只验「TCP 能连上」：本机回环上开着随机监听
// 端口而又恰好排在候选序列前面的概率可以忽略，不值得为它多做一次真实 HTTP 验证。
export function probePort(host, port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

// 解析 macOS `scutil --proxy` 输出，取系统已配置且启用的代理地址；未启用或字段
// 畸形返回 null。只认启用中的通道（HTTPS 优先）：未启用通道里的残留字段不可信。
// PAC（ProxyAutoConfigEnable）无法在 Node 里求值，直接忽略。
export function parseScutilOutput(text) {
  const pick = (key) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)$`, "m"));
    return m ? m[1] : null;
  };
  const httpsOn = pick("HTTPSEnable") === "1";
  const httpOn = pick("HTTPEnable") === "1";
  const host = httpsOn ? pick("HTTPSProxy") : pick("HTTPProxy");
  const port = Number(httpsOn ? pick("HTTPSPort") : pick("HTTPPort"));
  if (
    !(httpsOn || httpOn) ||
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    return null;
  return { host, port };
}

// 问操作系统要系统代理设置。目前只接 macOS（scutil），其他系统需要时再补。
export function systemProxy(platform = process.platform) {
  if (platform !== "darwin") return null;
  const r = spawnSync("scutil", ["--proxy"], {
    timeout: 1500,
    encoding: "utf8",
  });
  if (r.error || !r.stdout) return null;
  return parseScutilOutput(r.stdout);
}

const parsePortList = (text) =>
  (text ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535);

// 按发现顺序解析可用代理，返回 { url, source }；一个都找不到返回 null。
// deps 供测试注入假的探测与系统设置。注意用 || 而非 ??：shell 里空串变量不算数。
export async function resolveProxyEnv(env = process.env, deps = {}) {
  const probe = deps.probePort ?? probePort;
  const sysProxy = deps.systemProxy ?? systemProxy;
  const fromEnv =
    env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY;
  if (fromEnv) return { url: fromEnv, source: "环境变量" };
  const sys = await sysProxy();
  if (sys && (await probe(sys.host, sys.port)))
    return { url: `http://${sys.host}:${sys.port}`, source: "系统代理设置" };
  // FRONTIER_PROXY_PORTS 是本机逃生口：代理端口不在常见列表、系统设置又没登记时，
  // 在环境变量里逗号分隔列一下即可，不用改代码。
  const ports = [
    ...parsePortList(env.FRONTIER_PROXY_PORTS),
    ...DEFAULT_PROBE_PORTS,
  ];
  for (const port of ports)
    if (await probe("127.0.0.1", port))
      return { url: `http://127.0.0.1:${port}`, source: "端口探测" };
  return null;
}

// 把代理地址写进 env（大小写都写，覆盖最稳），并保证回环地址豁免——探活请求与
// 服务自身的本地访问绝不能被代理劫持。已有的 no_proxy 不动，只补缺。
export function applyProxyEnv(env, url) {
  env.http_proxy = url;
  env.https_proxy = url;
  env.HTTP_PROXY = url;
  env.HTTPS_PROXY = url;
  const existing = env.no_proxy || env.NO_PROXY || "";
  if (!existing.includes("127.0.0.1")) {
    const merged = existing
      ? `${existing},localhost,127.0.0.1,::1`
      : "localhost,127.0.0.1,::1";
    env.no_proxy = merged;
    env.NO_PROXY = merged;
  }
}
