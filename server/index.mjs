import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname, resolve, sep } from "node:path";
import {
  loadState,
  view,
  refreshAll,
  refreshSources,
  retryFailed,
  progress,
  refreshDue,
  setRefreshHours,
  historyView,
  statusView,
} from "./store.mjs";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.env.PORT || 4317);
const dev = process.argv.includes("--dev");
const autoRefresh = process.env.FRONTIER_AUTO_REFRESH !== "0";
await loadState();
const vite = dev
  ? await (
      await import("vite")
    ).createServer({
      root: ROOT,
      server: { middlewareMode: true },
      appType: "spa",
    })
  : null;
const json = (res, code, data) => {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) {
      const error = new Error("请求过大");
      error.status = 413;
      throw error;
    }
  }
  const parsed = JSON.parse(body || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("请求格式不合法");
  return parsed;
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      // Local writes only, no remote browser origins or cross-site form requests.
      if (
        req.method !== "GET" &&
        req.headers.origin &&
        !["http://localhost:" + PORT, "http://127.0.0.1:" + PORT].includes(
          req.headers.origin,
        )
      )
        return json(res, 403, { error: "仅允许本地网页操作" });
      if (req.method === "GET" && url.pathname === "/api/data")
        return json(res, 200, view());
      if (req.method === "GET" && url.pathname === "/api/history")
        return json(
          res,
          200,
          historyView({
            recordId: url.searchParams.get("record") || undefined,
            modelId: url.searchParams.get("model") || undefined,
          }),
        );
      if (req.method === "GET" && url.pathname === "/api/status")
        return json(res, 200, statusView());
      if (req.method === "POST" && url.pathname === "/api/refresh") {
        const body = await readJson(req);
        const work =
          body.sources === undefined
            ? refreshAll()
            : refreshSources(body.sources);
        work.catch((e) => console.error(e.message));
        return json(res, 202, statusView());
      }
      if (req.method === "PUT" && url.pathname === "/api/settings") {
        const body = await readJson(req);
        return json(res, 200, await setRefreshHours(body.refreshHours));
      }
      return json(res, 404, { error: "接口不存在" });
    }
    if (vite)
      return vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    const dist = join(ROOT, "dist");
    let path = resolve(dist, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(dist + sep) && path !== dist) {
      res.statusCode = 403;
      return res.end();
    }
    if (!extname(path)) path = join(dist, "index.html");
    let data;
    try {
      await stat(path);
      data = await readFile(path);
    } catch {
      res.statusCode = 404;
      return res.end("请先运行 npm run build，再执行 npm start。");
    }
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "Content-Type": types[extname(path)] ?? "application/octet-stream",
      "Cache-Control": path.startsWith(join(dist, "assets") + sep)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    res.end(data);
  } catch (e) {
    json(res, e.status ?? 400, { error: e.message });
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Model Frontier → http://localhost:${PORT}`);
  if (!autoRefresh) {
    console.log("自动源站刷新已禁用（FRONTIER_AUTO_REFRESH=0）");
    return;
  }
  // 每次启动无条件全量刷新一次；个别源失败时 refreshSource 会保留缓存并按退避重试，
  // 60 秒定时器靠 progress.running 单飞守卫不会与本次刷新并发。
  console.log("正在执行启动刷新…");
  refreshAll().catch((e) => console.error(e.message));
});
const timer = autoRefresh
  ? setInterval(() => {
      if (progress.running) return;
      if (refreshDue())
        return refreshAll().catch((e) => console.error(e.message));
      retryFailed()?.catch((e) => console.error(e.message));
    }, 60000)
  : null;
timer?.unref();
async function close() {
  clearInterval(timer);
  server.close();
  await vite?.close();
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
