#!/usr/bin/env node
// 代理自动探测启动器：给真正干活的入口（server/index.mjs / server/refresh-cli.mjs）
// 在启动前找好代理并注入环境。Node 内置 fetch 只认启动那一刻已有的代理环境变量，
// 所以必须在进程外先定好——这层包装存在的唯一理由就是「启动之前」。
// 用法：node scripts/with-proxy.mjs <入口文件> [参数…]
import { spawnSync } from "node:child_process";
import { applyProxyEnv, resolveProxyEnv } from "../server/proxyEnv.mjs";

const entry = process.argv[2];
if (!entry) {
  console.error("用法：node scripts/with-proxy.mjs <入口文件> [参数…]");
  process.exit(2);
}
const proxy = await resolveProxyEnv(process.env);
if (proxy) {
  applyProxyEnv(process.env, proxy.url);
  console.log(`已启用代理（来源：${proxy.source}）：${proxy.url}`);
} else {
  console.log("未发现可用代理，直连抓取（Arena 源可能失败，其余三站不受影响）");
}
process.env.NODE_USE_ENV_PROXY = "1";
const child = spawnSync(process.execPath, [entry, ...process.argv.slice(3)], {
  stdio: "inherit",
});
process.exit(child.status ?? 1);
