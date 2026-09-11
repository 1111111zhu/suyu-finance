# Fernand UI 研究

研究日期：2026-09-11。范围是公开网站、演示、帮助文档与登录页；不是已登录产品内部源码审计。

## 研究路径

查看了首页、Pricing、About、Updates、帮助中心、Custom Data 指南、公开登录页，并逐一读取官方 13 类 Custom Data 组件文档。桌面观察为 1440×1000，移动观察为 390×844；记录实时 DOM、computed styles、加载样式、截图和实际交互。

实际操作包括按钮悬停和聚焦、渠道横向展示、聊天预览的明暗主题、Popup/Modal/Drawer、左右位置、开合、演示视频弹窗和 Escape 关闭。另从首页 9.4 秒循环视频取得五个时间点的产品画面，用来核对应用的空间组织。

公开 `app.getfernand.com/features/custom-data` 入口此次未显示可用内容，未创建账户或登录；因此内部模式通过官方文档和公开演示交叉观察。官网营销主按钮的悬停没有出现明显位移，不能把通用「hover 上浮」当成原站事实。

## 关键结论

Fernand 的工作界面依靠窄导航、连续主体、上下文侧栏和非常淡的边界组织信息。大部分动作跟随文字出现；按钮用紧凑尺寸与短阴影提供触感。常规分栏没有独立卡片式外壳。浮出的成员选择、聊天窗和小实体卡片才有更清楚的投影。

其官网的营销区域可以包含卡片，但这不能替代产品演示中的连续画布。第一版将每块业务内容包在卡片里，偏离了用户指定的效果；当前实现采用已经通过的第二版布局。

来源：[官网与公开产品演示](https://getfernand.com/)。

## 背景如何构成

官网首页产品演示区使用 `marguerites-bg.png`、白色渐隐和 `marguerites-cutout.png` 前景叠层；花卉横跨展示背景，令白色工作区融入氛围。

本次用户最后指定的是另一张图：Support widget 区域的 **`fernand-cherry-blossom.png`**。其 CSS 是 `background-position: 50%`、`background-size: cover`；原图区整体容器圆角 14px，边界 `#e8eaf0`。因此，这套规范保留樱花原图用于展示，再用独立 CSS 渐隐层适配工作画布。

来源：[樱花素材](https://getfernand.com/images/flowers/fernand-cherry-blossom.png)、[官网](https://getfernand.com/)。

## 字体与排版实测

| 位置 | 原站观察值 |
|---|---|
| 主字体 | Inter，本地资源版本标记 v3.19 |
| 桌面 H1 | 38px / 48px，400 |
| H2 | 30px / 38px，400 |
| H3 | 18px / 30px，400 |
| 首屏说明 | 17px / 28.05px |
| 顶部导航 | 14px，500 |
| 功能说明 | 14px / 22px |
| 手机 H1 | 26px / 33px |
| 官网主容器 | 最大 1330px；左右内边距 20px |
| 内容容器 | 1120 / 800 / 640px |
| 营销模块间距 | 120px，部分 160px |
| 小组件间距 | 4 / 8 / 12 / 16 / 24 / 32 / 48px |
| 官网断点 | 900 / 640 / 420px |

当前实现将大间距用于规范介绍段，工作台则保持紧凑。中文字体配对与工作台断点属于适配，已另列于 `design-rules.md`。

## 颜色实测

原站基色：白 `#ffffff`；浅底 `#f4f5f7`；标题常用 `#1a2035`；深色 `#131e40`；正文 `#717583`；辅助 `#9fa3b5`；蓝色 `#00a0ff`；浅蓝 `#e8f5ff`；绿 `#33c27f`；橙 `#fb8c3b`；红 `#dc2626`；线 `#eaecf8` / `#e4e6eb`。

当前实现增加薄荷品牌主题，并加深小文字的语义颜色。不是把原站每个低对比装饰色原封不动用于必要信息。

## 按钮、输入和表面

| 原站元素 | 观察值 |
|---|---|
| 导航 CTA | 高约 30px，圆角 6px，padding 8px 12px |
| 首屏主 CTA | 高约 47px，圆角 8px，padding 13px 20px，深蓝底 |
| 次要按钮 | 白底、淡轮廓、多层短阴影 |
| 数据预览按钮 | 高 32px、圆角 4px、左右 padding 10px、字 14px |
| 登录输入 | 圆角 4px、边线 #d1d5e6、左右 padding 14px |
| 普通营销卡片 | 圆角 8px、padding 24px |
| 渠道卡片 | 宽 300px、圆角 10px、padding 24px |
| 官方 Custom Data 卡片 | 文档定义 padding 20px |
| 定价卡片 | 圆角 10px、padding 64px，仅限营销展示 |

短阴影结构是 `0 2px 4px #12376914, 0 1px 1px #1237690a, 0 0 0 1px #12376914`。聊天浮层用 `0 8px 32px #12376929, 0 0 0 1px #12376914`。

来源：[首页样式](https://getfernand.com/_nuxt/virtual_public.B1w-RRnc.css)、[首页](https://getfernand.com/)、[公开登录页](https://app.getfernand.com/auth/login)、[Card 文档](https://help.getfernand.com/features/custom-data/card)。

## 小组件与动效

- 聊天演示 Popup / Modal / Drawer 的观察宽度分别为 252 / 380 / 220px。这是网页中缩小的预览，不代表真实产品通用宽度。
- 深色聊天窗基底 `#1e2235`，正文 `#e8eaf0`；线条与搜索底同时变成低透明白色。
- 分段器以极浅灰轨道承托一块小白色选中面；没有醒目的整块颜色。
- 普通链接样式定义 750ms 缓出；局部直接控制多为 150–250ms。
- 浮层透明度 220ms，变换 300ms，曲线 `cubic-bezier(.34,1.56,.64,1)`；关闭 160ms，缩放 .88 与向下 10px。
- 聊天启动按钮悬停缩放 1.08，按下缩放 .94。
- 原站有 `prefers-reduced-motion` 分支。

当前代码保留同类节奏和减少动态适配。Dialog 使用原生模态行为，关闭交给浏览器即时处理；并未将原站的每个持续营销动画复制进业务界面。

## 官方组件目录

官方公开文档逐项提供了如下 13 类模式。下列是研究入口，本文不复制其全文。

| 模式 | 文档 |
|---|---|
| Text | [文字](https://help.getfernand.com/features/custom-data/text) |
| Key/value | [键值](https://help.getfernand.com/features/custom-data/key-value-pair) |
| List | [列表](https://help.getfernand.com/features/custom-data/list) |
| Button | [按钮](https://help.getfernand.com/features/custom-data/button) |
| Spacer | [留白](https://help.getfernand.com/features/custom-data/spacer) |
| Badge | [角标](https://help.getfernand.com/features/custom-data/badge) |
| Pill | [状态](https://help.getfernand.com/features/custom-data/pill) |
| Card | [卡片](https://help.getfernand.com/features/custom-data/card) |
| Tabs | [页签](https://help.getfernand.com/features/custom-data/tabs) |
| Collapsible | [展开](https://help.getfernand.com/features/custom-data/collapsible) |
| Divider | [分隔](https://help.getfernand.com/features/custom-data/divider) |
| Table | [表格](https://help.getfernand.com/features/custom-data/table) |
| Form | [表单](https://help.getfernand.com/features/custom-data/form) |

其他观察页：[Pricing](https://getfernand.com/pricing/)、[About](https://getfernand.com/about-us/)、[Updates](https://getfernand.com/updates/)、[Help](https://help.getfernand.com/)、[组件概览](https://help.getfernand.com/features/custom-data/getting-started-with-custom-data)。

## 原站与此次实现的边界

| 维度 | 原站依据 | 此次适配 |
|---|---|---|
| 字体 | Inter，常规字重为主 | 中文系统字族回退 |
| 颜色 | 深蓝灰、蓝色交互 | 薄荷绿默认主题、更深的必要信息文字 |
| 空间 | 连续工作区与细分栏 | 左侧薪资导航、无卡片上传与摘要 |
| 背景 | 樱花原图 | 原图不改，CSS 画布渐隐 |
| 小组件 | 官网交互、官方文档 | 独立 HTML/CSS/JS 实现 |
| 步骤 | 官网进度反馈与用户参考 | 真实完成条件、前序可回看、结果失效规则 |
| 业务 | 客服产品 | 仅本地薪资示例，不含实际核算或发送 |

可追溯数据保存在 `research/reference-measurements.json`、`reference-interactions.json` 与证据截图中。它们用于说明观察事实，不作为运行时依赖。
