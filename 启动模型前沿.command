#!/bin/zsh
set -e
cd -- "${0:A:h}"
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/share/mise/installs/node/24/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
# 代理不再在这里写死：npm start 内置自动探测（环境变量 → 系统代理设置 → 常见端口），
# 见 scripts/with-proxy.mjs。这里只保留回环豁免，保证下方探活 curl 不被代理劫持。
export no_proxy="localhost,127.0.0.1"
export NO_PROXY="localhost,127.0.0.1"
if ! command -v node >/dev/null 2>&1; then
  print '需要 Node.js 22.12 或更高版本。安装后再双击此文件。'
  read '?按回车退出…'
  exit 1
fi
if curl --silent --fail http://127.0.0.1:4317/api/status >/dev/null; then
  open http://localhost:4317
  print '模型前沿已经运行，已打开网页。'
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi
if [[ ! -f dist/index.html ]]; then
  npm run build
fi
(sleep 2; open http://localhost:4317) &
print '关闭此终端或按 Ctrl+C 将停止服务及自动刷新。'
npm start
