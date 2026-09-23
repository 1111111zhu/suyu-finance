# 财务系统：腾讯云部署与研发数据迁移

生产网站由 `suyu-finance.service` 运行。代码放在 `/opt/suyu-finance/releases/<commit-sha>`，`current` 指向当前版本。研发数据放在现有 PostgreSQL 17 服务里的独立逻辑库 `rd_finance`；PostgreSQL 的 Docker 持久卷不在网站发布目录内。发布网站只切换代码，不能删除数据库卷。

研发平台和项目的确定原始资料由私有 Excel 导入，费用数据以后由应用单独写入。UI 可以在数据结构和导入流程完成后继续设计。

## 其他运行方式

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

    gzip on;
    gzip_min_length 1024;
    gzip_types application/json text/css application/javascript;

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

仓库的 `CI and production deploy` 工作流在面向 `main` 的 Pull Request 上检查代码。合并到 `main` 后，GitHub Actions 只上传该提交的源码归档；私有 Excel 和数据库备份不进入 GitHub。服务器脚本依次构建候选版本、备份 `rd_finance`、执行向前兼容的迁移、刷新运行账号权限、检查候选网站和研发接口，再切换 `suyu-finance.service`。正式接口检查失败时恢复旧网站服务；已执行的数据库迁移保持原样，因此迁移必须兼容旧网站版本。

在 GitHub 的 `production` Environment 中配置：

- Secrets：`SERVER_HOST`、`SERVER_USER`、`SERVER_SSH_KEY`、`SSH_KNOWN_HOSTS`
- Variables：`DEPLOY_PATH`（如 `/opt/suyu-finance`）、`SITE_URL`（如 `https://example.com`）、可选 `SERVER_PORT`（默认 `22`）

服务器需安装 Node.js 22.13.0（当前脚本路径 `/opt/node-v22.13.0`）、curl 和 systemd。备份可以调用现有 PostgreSQL 17 容器中的 `pg_dump`，无需主机安装客户端；此时部署用户须能免密 sudo 调用 `docker exec`。部署用户还须能免密 sudo 管理该网站的 systemd 服务，并可写 `/opt/suyu-finance/releases` 和 `/opt/suyu-finance/backups/rd`。`SSH_KNOWN_HOSTS` 应保存核验过的服务器主机公钥。Nginx/Caddy 将公网 HTTPS 地址转发到 `127.0.0.1:3000`。

### 首次配置研发库

在现有 PostgreSQL 服务中创建独立数据库 `rd_finance`、迁移所有者和受限运行账号。网站运行账号仅连接 `rd_finance`，不连接工资库。首次部署的 GitHub Action 会通过 SSH 将初始化脚本送入服务器内存，且仅在两个研发配置文件缺失时执行一次；脚本先确认数据库和账号均不存在，再创建它们及随机密码，不会输出密码。若中途失败，应先核查实际数据库和账号，不要盲目重试。首次发布前，服务器上必须具备以下私有文件（root 拥有、0600 权限）：

```text
/etc/suyu-finance/rd-migrate.env   RD_DATABASE_MIGRATION_URL=postgresql://<owner>:<password>@127.0.0.1:5432/rd_finance
                                    RD_DB_RUNTIME_USER=<runtime-role>
/etc/suyu-finance/rd-migrate.env   RD_DB_CONTAINER=<existing-postgres-container-name-or-id>
/etc/suyu-finance/rd-runtime.env   RD_DATABASE_URL=postgresql://<runtime>:<password>@127.0.0.1:5432/rd_finance
                                    RD_API_TOKEN=<private-health-and-api-token>
```

密码中的特殊字符应先进行 URL 编码；文件内容按 Shell 赋值语法书写并由管理员核查。部署脚本通过 sudo 在内存中读取文件，不会复制到发布目录。首次创建数据库与角色后，执行迁移和运行账号权限配置，再单独导入已核准的 Excel。原件应放在 `/opt/suyu-finance/shared/rd-source/` 这类不随版本替换的私有目录。导入先预览，再由操作者核对差异后执行；后续导入不要求重新发布网站：

```bash
set -a
. <(sudo -n cat /etc/suyu-finance/rd-migrate.env)
set +a
node database/rd/import-master.mjs '/opt/suyu-finance/shared/rd-source/研发项目命名规则及研发项目平台.xlsx'
bash 运维脚本/rd-db-backup.sh /opt/suyu-finance/backups/rd
node database/rd/import-master.mjs '/opt/suyu-finance/shared/rd-source/研发项目命名规则及研发项目平台.xlsx' --apply
unset RD_DATABASE_MIGRATION_URL
```

这两条命令需要 `RD_DATABASE_MIGRATION_URL`，从服务器私有配置加载。导入程序将 XLSX 原件及哈希保存在数据库内，以便后续追溯和迁库。

### 备份、迁出与恢复

每次发布迁移前运行 `运维脚本/rd-db-backup.sh`，备份位于 `/opt/suyu-finance/backups/rd/rd-<时间>-<随机值>/`，包括 PostgreSQL custom dump、SHA-256 清单和状态文件。脚本不会自动清理旧备份。日常 Excel 导入前也应执行同一个备份脚本。备份和原始 Excel 应按私有资料保存；若导入工具把原始 Excel 内容存入数据库，逻辑备份会包含该副本。

迁到新服务器时，先建立新的受限角色，然后将整个备份目录安全转移过去，在目标服务器安装 PostgreSQL 17 客户端并配置 `PGHOST`、`PGUSER`、`PGPASSFILE`，执行：

```bash
bash 运维脚本/rd-db-restore.sh /private/backups/rd-YYYYMMDDTHHMMSSZ-XXXXXXXX rd_finance_new rd_owner
```

恢复脚本验证清单与 SHA-256，只创建新数据库；目标数据库已存在时拒绝覆盖。验证项目数、平台归属与网站接口后，将 `RD_DATABASE_URL` 和 `RD_DATABASE_MIGRATION_URL` 改成新连接，再重启网站。不要复制 Docker 卷内部的 PostgreSQL 数据文件作为迁移包。

## 政策申报雷达自动更新

政策页面地址为 `/policy`。第一次部署及以后手动更新政策时执行：

```bash
npm run sync:policies
```

要实现每天自动推送到政策页面，请把 `运维脚本/policy-radar.cron` 中的部署目录改成腾讯云服务器实际目录，再加入服务器的 `crontab`。默认每天早上 06:00（Asia/Shanghai）读取一次免费政府公开来源，并用文件锁避免两次同步重叠。

直接 Node.js 部署时，同步程序会原子替换 `public/policies.json`，并在已构建的项目中同步更新 `dist/client/policies.json`，因此无需每天重新 build。Docker 部署若需长期更新，可由宿主机 cron 执行 `docker exec rd-cost-console npm run sync:policies`；重建容器前应先执行一次同步，避免回到镜像内的旧数据。政策数据不包含企业 Excel、人员或财务数据。

长期官方来源、判定顺序、PDF/Word 解析、可调参数及防归零保护见 [`项目文档/policy-radar.md`](项目文档/policy-radar.md)。

### 扫描版 PDF 的 OCR（推荐）

政策雷达会先读取 PDF 的文字层；对无文字层或异常字体的扫描版 PDF，会自动使用 `pdftoppm` 和 `tesseract` 识别中文正文。腾讯云 Ubuntu/Debian 服务器可在首次部署时安装：

```bash
sudo apt-get update
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-chi-sim
```

若服务器暂不安装这些工具，其他网页、文字型 PDF 和 Word 仍可正常同步；扫描 PDF 会保留为待查，而不会被误判为可申报。可设置 `POLICY_DOCUMENT_OCR=0` 显式关闭 OCR。

## 溯驭公司档案月度刷新

公司档案只写入有可追溯原文证据的公开信息，未知项目保持 `null`，不会根据演示数据、商业信息库或推测补全。首次部署和手动刷新执行：

```bash
npm run sync:company-profile
```

将 `运维脚本/company-profile.cron` 中的部署目录改为实际目录后加入服务器 crontab，可在每月 1 日 06:15（Asia/Shanghai）刷新。数据写入 `public/company-profile.json`，其中每个字段附有来源 URL / 文件、抓取时间、证据片段和可信等级；`matcherProfile` 是规则引擎可读取的稳定入口。完整字段与来源约定见 `项目文档/company-profile.md`。

## 说明

- 研发项目目录与费用数据需要 `rd_finance`；旧版浏览器内测算仍可运行，但云端同步依赖研发数据库。
- 用户上传文件的正式落库与权限控制应按业务功能单独实现；发布脚本不上传用户文件。
- `.openai/hosting.json` 仅用于保留原 Sites 项目标识；腾讯云服务器部署不会使用。
