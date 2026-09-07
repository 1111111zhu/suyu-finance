# 研发成本测算操作台：独立服务器部署

本包包含完整源码、业务规则、Python 浏览器运行资源、Excel 模板、锁定依赖及已经验证的生产构建。网站在浏览器内完成测算，不需要数据库，也没有必须迁移的服务器环境变量。

## 方式一：Docker（推荐）

服务器安装 Docker 后，在解压目录执行：

```bash
docker build -t rd-cost-console .
docker run -d --name rd-cost-console --restart unless-stopped -p 3000:3000 rd-cost-console
```

然后访问 `http://服务器IP:3000`。如需域名和 HTTPS，可让 Nginx 或 Caddy 反向代理到 `127.0.0.1:3000`。

## 方式二：直接使用 Node.js

要求 Node.js 22.13 或更高版本。在解压目录执行：

```bash
npm ci
npm run build
npm run start -- --host 0.0.0.0 --port 3000
```

建议再使用 systemd、PM2 或其他进程管理器保持服务运行。

## Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 更新部署

替换为新版本文件后，重新执行 `npm ci && npm run build` 并重启进程；Docker 部署则重新构建镜像并替换容器。

## GitHub Actions 自动部署

仓库的 `CI and production deploy` 工作流会在面向 `main` 的 Pull Request 上执行 lint、JavaScript/Python 测试和生产构建。PR 合并产生 `main` 分支 push 后，工作流才会通过 SSH 将该提交部署到服务器，并在切换正式容器前运行临时容器健康检查；正式健康检查失败时会恢复旧镜像。

在 GitHub 的 `production` Environment 中配置：

- Secrets：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`、`SSH_KNOWN_HOSTS`
- Variables：`DEPLOY_PATH`（如 `/opt/suyu-finance`）、`SITE_URL`（如 `https://example.com`）、可选 `SERVER_PORT`（默认 `22`）

服务器需安装 Docker 和 curl；部署用户须能运行 Docker，并拥有 `DEPLOY_PATH` 的写权限。`SSH_KNOWN_HOSTS` 应保存经过人工核验的服务器主机公钥，不要关闭 SSH 主机校验。Nginx/Caddy 应将公网 HTTPS 地址反向代理至 `127.0.0.1:3000`，安全组无需开放 3000 端口。

## 政策申报雷达自动更新

政策页面地址为 `/policy`。第一次部署及以后手动更新政策时执行：

```bash
npm run sync:policies
```

要实现每天自动推送到政策页面，请把 `ops/policy-radar.cron` 中的部署目录改成服务器实际目录，再加入服务器的 `crontab`。默认每天早上 06:00 读取一次免费政府公开来源。政策数据写入 `public/policies.json`，不包含企业 Excel、人员或财务数据。

## 溯驭公司档案月度刷新

公司档案只写入有可追溯原文证据的公开信息，未知项目保持 `null`，不会根据演示数据、商业信息库或推测补全。首次部署和手动刷新执行：

```bash
npm run sync:company-profile
```

将 `ops/company-profile.cron` 中的部署目录改为实际目录后加入服务器 crontab，可在每月 1 日 06:15（Asia/Shanghai）刷新。数据写入 `public/company-profile.json`，其中每个字段附有来源 URL / 文件、抓取时间、证据片段和可信等级；`matcherProfile` 是规则引擎可读取的稳定入口。完整字段与来源约定见 `docs/company-profile.md`。

## 说明

- 本项目无需数据库。
- 当前托管站点没有配置生产环境变量或密钥。
- 用户上传的 Excel 在浏览器内处理，不会自动保存到服务器。
- `.openai/hosting.json` 仅用于保留原 Sites 项目标识；部署到其他服务器时不会被使用。
