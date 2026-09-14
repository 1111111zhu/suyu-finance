#!/bin/zsh
set -e
salary_project="$(cd -- "$(dirname -- "$0")" && pwd)"
salary_url="http://localhost:3090/salary/index.html"
if curl -fsS --max-time 2 "$salary_url" >/dev/null 2>&1; then
  open "$salary_url"
  exit 0
fi
cd "$salary_project"
salary_npm="$(command -v npm || true)"
if [[ -z "$salary_npm" && -x /opt/homebrew/bin/npm ]]; then
  salary_npm=/opt/homebrew/bin/npm
fi
if [[ -z "$salary_npm" ]]; then
  echo "未找到 Node.js / npm，请先安装后再启动。"
  exit 1
fi
(
  for salary_attempt in {1..100}; do
    if curl -fsS --max-time 1 "$salary_url" >/dev/null 2>&1; then
      open "$salary_url"
      exit 0
    fi
    sleep 0.3
  done
) &
exec /usr/bin/env PATH="/opt/homebrew/bin:$PATH" "$salary_npm" run dev -- --host 127.0.0.1 --port 3090
