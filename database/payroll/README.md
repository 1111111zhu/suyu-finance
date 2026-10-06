# 工资 PostgreSQL 基础

本目录保存 PostgreSQL 17 的工资数据结构、迁移工具和服务端数据访问层。已提供公司/员工/任职、导入、结果版本、调整、复核、归档、邮件草稿及审计的数据基础。工资页面已接入管理员登录、服务器草稿及真实批次确认；人员归集与企业微信接入说明见[人员归集与工资确认接入](../../项目文档/人员归集与工资确认接入.md)。

业务说明、全部表字典、ER Mermaid、修订流程、权限、命令与后续接口对照见 [工资数据库设计与部署](../../项目文档/工资数据库设计与部署.md)。工资字段详情见 [工资数据库字段映射](../../项目文档/工资数据库字段映射.md)。

## 1. 文件与导出接口

| 文件 | 职责 / 接口 |
| --- | --- |
| [pool.mjs](pool.mjs) | `createPool(options={})`、`withTransaction(pool, callback)`；UTC；DATE/DATE[] 池级字符串解析；不修改全局 pg types |
| [migrate.mjs](migrate.mjs) | `migrate(pool,{directory?})` 返回 `{applied,skipped}`；`migrationStatus(pool,{directory?})` 返回版本/哈希/应用时间/状态数组 |
| [001_payroll.sql](migrations/001_payroll.sql) | 20 张 payroll 表、身份/导入/结果的约束、审计及邮件草稿状态视图 |
| [002_salary_fields.sql](migrations/002_salary_fields.sql) | items 的 71 个工资列、公司/部门汇总视图、确认金额完整性检查 |
| [003_integrity.sql](migrations/003_integrity.sql) | 文件位置与内容标识保护、复核、调整、批次/版本依据、事务完整提交等约束 |
| [004_api_auth.sql](migrations/004_api_auth.sql) / [005_workspaces.sql](migrations/005_workspaces.sql) | 登录会话、限流、服务器草稿与不可变草稿版本 |
| [006_personnel.sql](migrations/006_personnel.sql) / [007_workspace_confirmation.sql](migrations/007_workspace_confirmation.sql) | 企微只读快照、人员异动、辅助花名册、身份关联与正式工资确认来源 |
| [fields.mjs](fields.mjs) | `payrollFields`、`normalizePayrollValues`、`fromLegacyPayrollRow`；显式字段契约，不算工资 |
| [repository.mjs](repository.mjs) | `createPayrollRepository(pool)`、`bootstrapAdmin`、`hashPassword`、`verifyPassword`、`newRequestKey` |
| [admin.mjs](admin.mjs) | `provisionRuntimeRole(pool,{role,password})`；CLI `bootstrap/runtime-role` |
| [demo.mjs](demo.mjs) | `seedDemo(pool,{password,prefix?})`；仅用于独立虚拟演示环境 |
| [config.env.example](config.env.example) | 只有占位配置，没有真实密钥；Node 工具不自动加载 `.env` |
| [compose.payroll-db.yaml](../../compose.payroll-db.yaml) | 仅数据库、环回绑定、持久卷、健康检查、重启及日志轮转 |
| [备份脚本](../../运维脚本/payroll-db-backup.sh) / [恢复脚本](../../运维脚本/payroll-db-restore.sh) | 同快照 custom dump + 文件元数据、产物哈希；只恢复新库 |

迁移 001–007 覆盖工资、登录、草稿、人员归集与正式确认。迁移 version 为 SQL 文件名去掉 `.sql`；目录默认 `database/payroll/migrations/`。全程使用同一 client 的 advisory lock，每份 SQL 独立事务；已应用文件的 SHA256 改变或文件缺失时拒绝运行。不要在迁移 SQL 外层自行加 BEGIN/COMMIT，也不要改写已应用的迁移。

## 2. 数据契约

- 员工 UUID 表示人，任职 UUID 表示一次任职；工号/姓名仅用于人工匹配参考。工号、银行卡为文本，保留前导零。
- `hireEmployee` 新建任职；`transferEmployment` 原子结束旧任职并为同员工新建目标公司任职，写入任职变更和审计；失败全部回滚。已离职复聘使用新的任职记录。
- 导入封存后、结果生成后不再修改原始行和工资明细。改资料、改人员映射或改工资时创建新导入/调整/结果版本。
- `reviseBatch` 重开确认/归档批次，旧 run 保持原状；新 run 通过 `previousRunId` 关联同范围旧版，复核后再确认/归档。
- `gross/net_generated/net_uploaded` 分别表示应发、基于已生成应发的实发、基于上传应发的实发。资料和调整显式绑定版本，不自动跨阶段复用。
- 写操作需可信服务端提供 `actorId/requestKey`；批次相关操作按方法要求携带 `expectedRevision`。同键同输入重试返回原结果，冲突不覆盖。
- DATE（OID 1082）与 DATE[]（OID 1182）读作日期字符串/数组；记录时刻用 UTC timestamptz。金额用 `numeric(18,2)` 十进制字符串，天数/系数用 `numeric(10,4)`；其他 pg 类型及自定义解析配置保持原行为。
- `items` 保存上层已计算结果和不可变人员快照。JSONB 保存资料、映射、上下文、计算细节和审计；数据库只汇总已保存数值，不执行工资算法。
- `input_snapshot` 的 month/workdays/makeupDates/settings/basisRevision 来自批次；用户 context 不能覆盖这些依据。过期计算不能确认或生成新邮件草稿。

### 原子跨公司调动

`transferEmployment(input)` 接收旧 `employmentId`、新 `companyId`、旧结束日 `leftOn`、新开始日 `joinedOn`、原因 `reason`，以及同 hire 的参考工号、部门、人员类型、转正日期；同时传入 actorId/requestKey。员工 UUID 取自旧任职，返回 `{previousEmploymentId, employment}`。开始日不能早于结束日，允许同日衔接；既有工资快照保留。

## 3. 初始化顺序与 npm 命令

依赖 Node.js ≥ 22.13，先从仓库根目录运行 `npm ci` 安装依赖；运维演练另需 PostgreSQL 17 客户端。以下初始化命令也从仓库根目录执行。

先在独立本地/测试环境准备空库及 migration owner，具体 Compose、psql 角色命令见 [设计与部署文档第 8 节](../../项目文档/工资数据库设计与部署.md)。不要手工预建 payroll schema；001 会创建。角色与凭据应分开：

| 配置 | 用途 |
| --- | --- |
| `DATABASE_MIGRATION_URL` | 迁移 owner 的连接；迁移/管理 CLI 优先读取 |
| `DATABASE_URL` | 应用 runtime 连接；createPool 默认读取 |
| `PAYROLL_ADMIN_USERNAME/NAME/PASSWORD` | 业务管理员 bootstrap；密码 12–1024 字符 |
| `PAYROLL_RUNTIME_ROLE/PASSWORD` | 新建 runtime PostgreSQL 角色；密码至少 20 字符 |
| `PAYROLL_INSTANCE_ADMIN_URL` | 仅手册用于私有注入实例管理员连接的临时变量，供 runtime-role 切换；程序不直接读取 |

格式示例只含占位符，不要将真实密码写入命令行或仓库：

```dotenv
DATABASE_MIGRATION_URL=postgresql://payroll_owner:REPLACE_WITH_OWNER_SECRET@127.0.0.1:5432/payroll
DATABASE_URL=postgresql://payroll_runtime:REPLACE_WITH_RUNTIME_SECRET@127.0.0.1:5432/payroll
PAYROLL_ADMIN_PASSWORD=REPLACE_WITH_ADMIN_PASSWORD
PAYROLL_RUNTIME_PASSWORD=REPLACE_WITH_RUNTIME_PASSWORD
```

实际凭据通过私有环境/凭据管理器注入；不打印 env、URL 或 pool 配置对象。Node 命令不会自动读取 `.env`。迁移 owner 需要目标库 CREATE、公有 schema 中创建迁移台账的权限，应用 runtime 不使用该身份。

```bash
npm run db:migrate
npm run db:status
npm run db:bootstrap
```

bootstrap 仅初始化首个业务管理员；同 username 重试不修改原密码，不提供公开注册或重置密码。创建 runtime 角色需要实例管理员的 CREATEROLE 及对象授权能力，普通 migration owner 无需这些实例权限：

```bash
(
  : "${PAYROLL_INSTANCE_ADMIN_URL:?请先通过私有环境配置实例管理员连接}"
  export DATABASE_MIGRATION_URL="$PAYROLL_INSTANCE_ADMIN_URL"
  npm run db:runtime-role
)
```

新建角色命令会拒绝已有同名 runtime，权限升级使用 `npm run db:api-grants`。新角色读取现有 payroll 表/视图、向指定表追加记录，仅可更新允许的少数列；无账号写入、工资历史 DELETE 或 payroll schema CREATE 授权；过期会话与登录限流可清理。未配置 RLS 或未来表自动授权；HTTP 登录和草稿归属控制见网站接入说明。应用进程仅保留 runtime 的 DATABASE_URL。

### 虚拟 seed 独立路径

只在新建、名称匹配 `payroll_demo_*` 的专用演示库完成迁移后运行。**不要先 bootstrap 其他账号**：seed 内部创建 `demo_admin`。入口函数也要求 `allowDemo: true`，测试库须匹配 `payroll_test_*`；普通库名（如 `payroll`）和 `NODE_ENV=production` 会被代码拒绝。真实 `PAYROLL_DEMO_PASSWORD` 通过私有环境提供，占位格式为 `REPLACE_WITH_DEMO_PASSWORD`。

```bash
(
  export PAYROLL_ALLOW_DEMO=yes
  npm run db:seed:demo
)
```

样例创建三家虚拟公司、同名同工号候选及实习生、预填的实发结果、逐项复核和确认。文件状态是 missing，存储配置 demo-unconfigured，没有真实文件上传。数据库名称、显式开关、生产环境拒绝一起执行；正式启动和迁移均不调用 seed。

## 4. 备份恢复与文件边界

Compose 默认 `postgres:17-bookworm`，仅 `127.0.0.1:可配置端口:5432`；卷键 `payroll-db-data` 映射容器 `/var/lib/postgresql/data`。实际卷名依赖 Compose project；不得通过删除卷刷新配置。外部对象在另一台机器，当前只有 `storage_profile/object_key` 元数据，适配器、签名链接和内容校验待接。

设置 PGHOST/PGPORT/PGDATABASE/PGUSER 和私有 0600 PGPASSFILE 后：

```bash
bash 运维脚本/payroll-db-backup.sh --output-dir /absolute/private/payroll-backups --retention-days 30
```

产物为 `payroll.dump`、`files.metadata.jsonl`、`manifest.json`、`retention-candidates.json`、`diagnostics.log`；独立目录 0700，文件 0600。pg_dump custom 和文件清单共用导出的数据库快照；manifest 保存两个产物的 SHA256 和字节数。保留策略只报告候选，不删除。备份整个 PGDATABASE 专用库，但不备份实例全局角色。

恢复时 PGUSER 使用有 CREATEDB 且可 SET ROLE 到 owner 的实例管理员，先创建归档 ACL 需要的角色；目标必须是新名称：

```bash
bash 运维脚本/payroll-db-restore.sh \
  --backup-dir /absolute/private/payroll-backups/payroll-REPLACE_WITH_BACKUP_ID \
  --target-db payroll_restore_20260915 \
  --owner payroll_owner \
  --maintenance-db postgres
```

恢复先核验产物哈希，再创建新库，使用 `--exit-on-error --single-transaction`；同名库及并发创建冲突都会拒绝，不 DROP、不覆盖。失败保留新库及私有诊断。恢复后需核验表、汇总、约束、runtime CONNECT/对象权限，不能自动切换生产应用。

**产物校验不等于外部原文件校验。** 本脚本不下载或恢复对象字节，也不验证另一台机器上对象的实际 SHA256。完整演练需用 `files.metadata.jsonl` 对照对象备份，检查 object_key、大小和内容哈希，保留 missing 清单；数据库快照本身不保证外部存储同一时点。

## 5. 验证与后续接入

```bash
npm run test:db
npm run test:db:integration
```

第一条运行字段/工具单测。第二条会写入专用测试库：有 `PAYROLL_TEST_DATABASE_URL` 时只接受 `payroll_test_*` 名称；未配置时按 `PG_BIN` 启动并清理临时 PostgreSQL 实例。该库应只保存虚拟测试数据。

本次 **38 项字段/工具测试 + 27 项真实 PostgreSQL 集成测试全部通过**，包括备份恢复。详见[验收记录](../../项目文档/工资数据库验收记录.md)。本机没有 Docker，未启动 Compose 容器；CI 中包含 Compose 配置检查，尚未推送执行。原有工资相关 82 项测试中的 2 项实习生规则失败也在原分支复现；网站构建通过。

恢复未完成批次可组合 `getBatch/listImports/getImport/listRuns/getRun/listAdjustments/listReviews/listFiles/listEmailDrafts`；`getEmployee` 可读回员工及完整任职变更。`listImports/listAdjustments` 接受 `(batchId,{scope}={})`，资料与调整按阶段筛选。业务页面后续接入这些服务端方法。

独立 HTTP 服务、页面草稿与真实导入批次的正式确认流程已经接线，详见[网站接入与交接](../../项目文档/工资网站接入与交接.md)和[人员归集与工资确认接入](../../项目文档/人员归集与工资确认接入.md)。企业微信实际同步仍须配置现有只读应用凭据；工资引擎服务端独立执行和另机文件适配不在本次范围。
