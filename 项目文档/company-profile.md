# 溯驭公司档案：可信来源与月度刷新

`public/company-profile.json` 是项目申报规则可直接读取的稳定档案文件。其 `matcherProfile` 为消费入口，所有叶子字段均为同一结构：

```json
{
  "value": "字段值或 null",
  "status": "verified 或 unknown",
  "source": {
    "url": "来源 URL 或 null",
    "file": null,
    "sourceType": "government_official / company_official",
    "trustLevel": "A / B / unknown",
    "fetchedAt": "ISO-8601 时间"
  },
  "evidence": "原文证据片段或 null",
  "confidence": "high / medium / unknown",
  "verifiedAt": "ISO-8601 时间或 null"
}
```

## 采集边界

只采集 `数据配置/company-profile-sources.mjs` 白名单中的公开原文：吴江区科技局（A）与溯驭自有域名（B）。搜索摘要、商业信息库、媒体文章、前端演示数据都不能写入档案。

字段只有在本轮抓取到原文中的精确证据时才是 `verified`。未抓到、来源失败、或资料没有明确说明的字段一律为 `null` / `unknown`；不会根据地址推定注册地，也不会从成立年份推算精确企业年限。每个来源失败时，旧值不保留为事实。

当前可验证的范围包括：主体名称、成立年份、官网公开地址及所属省/市/区、氢能电控方向，以及政府原文明确列出的高企、专精特新、潜在独角兽和低空经济领航资质。法人、统一社会信用代码、注册资本、营收、纳税、研发投入、员工数、专利数等没有可追溯原文时保持未知。

## 手动刷新与校验

```bash
npm run sync:company-profile
npm run test:company-profile
node -e 'JSON.parse(require("node:fs").readFileSync("public/company-profile.json", "utf8")); console.log("valid JSON")'
```

同步以临时文件写入后原子替换 `public/company-profile.json`，不会编辑政策数据、界面或匹配器。

## 月度自动刷新

`运维脚本/company-profile.cron` 使用与现有政策雷达相同的系统 cron 方式：每月 1 日 06:15（Asia/Shanghai）执行。将其中的 `/opt/rd-workbench` 改为实际部署目录后安装：

```bash
crontab 运维脚本/company-profile.cron
```

服务器时区若不是 `Asia/Shanghai`，请将 cron 时间换算或在 crontab 中设置 `CRON_TZ=Asia/Shanghai`。
