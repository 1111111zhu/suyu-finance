# 溯驭财务项目目录导航

这个仓库是溯驭财务的研发费用、工资表和项目申报前端项目。目录已按功能整理为中文命名；少数英文目录是框架、GitHub 或公开访问地址的固定入口，保留原名以保证构建和线上链接稳定。

## 中文目录

| 图示 | 目录 | 作用 |
| --- | --- | --- |
| <img src="目录图标/数据配置.svg" width="24" alt="数据配置"> | `数据配置/` | 政策链接修复表、企业档案来源、政策持续关注清单等配置数据。 |
| <img src="目录图标/自动化脚本.svg" width="24" alt="自动化脚本"> | `自动化脚本/` | 政策采集、政策匹配、文档识别、企业档案刷新和完整性检查脚本。 |
| <img src="目录图标/自动化测试.svg" width="24" alt="自动化测试"> | `自动化测试/` | JavaScript 与 Python 回归测试，覆盖政策、工资、文档识别和平台规则。 |
| <img src="目录图标/项目文档.svg" width="24" alt="项目文档"> | `项目文档/` | 部署、工资核算、项目申报雷达、公司档案和资金申报排查说明。 |
| <img src="目录图标/审计记录.svg" width="24" alt="审计记录"> | `项目文档/审计记录/` | 历史排查快照、候选索引和审计导出脚本。 |
| <img src="目录图标/运维脚本.svg" width="24" alt="运维脚本"> | `运维脚本/` | 服务器部署、Docker 部署、定时任务和 Nginx 配置示例。 |
| <img src="目录图标/界面设计稿.svg" width="24" alt="界面设计稿"> | `界面设计稿/` | 研发费用、工资表和项目申报页面的高保真设计稿。 |
| <img src="目录图标/品牌资产.svg" width="24" alt="品牌资产"> | `界面设计稿/品牌资产/` | SEEEx / 溯驭财务品牌标识、深浅色 Logo 和页面引用图。 |
| <img src="目录图标/设计规范.svg" width="24" alt="设计规范"> | `设计规范/` | 可独立打开的 UI 规范、组件示例、设计令牌、素材、预览图和检查脚本。 |
| <img src="目录图标/目录图标.svg" width="24" alt="目录图标"> | `目录图标/` | 本导航使用的小型功能图示，帮助在 GitHub 上快速识别目录用途。 |

## 保留英文目录

| 图示 | 目录 | 为什么保留 |
| --- | --- | --- |
| <img src="目录图标/应用页面.svg" width="24" alt="应用页面"> | `app/` | Vinext / Next 的页面入口目录，改名会影响路由和构建。 |
| <img src="目录图标/公开资源.svg" width="24" alt="公开资源"> | `public/` | 静态公开资源入口，里面的 `/salary`、`/py`、`/policy-sources` 是线上访问路径。 |
| <img src="目录图标/GitHub流程.svg" width="24" alt="GitHub流程"> | `.github/` | GitHub Actions 工作流固定读取的目录。 |
| <img src="目录图标/托管配置.svg" width="24" alt="托管配置"> | `.openai/` | OpenAI Sites 项目标识和托管配置目录。 |

## 常用命令

```bash
npm run test:policy
npm run test:company-profile
node --test 自动化测试/salary.test.mjs
python3 -m unittest 自动化测试/test_platform_regressions.py
npm run build
```

## 主要入口

- 本地研发费用页面：`app/page.tsx`
- 项目申报页面：`app/policy/page.tsx`
- 工资表静态工具：`public/salary/index.html`
- 部署说明：`DEPLOYMENT.md`
- 业务规则：`规则.md`
