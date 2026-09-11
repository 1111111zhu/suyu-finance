# 素材与来源

## 樱花背景

- 文件：`设计资产/背景图/fernand-cherry-blossom.png`
- 来源：[Fernand 樱花原图](https://getfernand.com/images/flowers/fernand-cherry-blossom.png)
- 使用位置：官网首页 Support widget 演示区；用户在本次截图中明确指定。
- 处理方式：原始字节直接保存；通过 CSS background-size、定位和渐隐层适配，无重新生成、无像素裁改。
- 许可状态：来源站未在本次可见资源中声明开放许可。保留 Fernand 第三方素材来源，不将该图标记为本项目原创或 MIT 资源。

工作页中的透明渐隐、背景定位和点阵画布是本项目 CSS 实现。后续换图只需替换素材 URL；不影响控件或布局。

## 字体

- Inter 3.19，Regular / Medium / SemiBold / Italic 四份 WOFF2 本地资源。
- 原站使用同名本地字体；本包使用页面实际引用的字体资源，并保留 Inter 官方 [SIL Open Font License 1.1](https://raw.githubusercontent.com/rsms/inter/v3.19/LICENSE.txt)。
- 许可原文：`设计资产/字体/OFL.txt`。
- 中文使用设备已有的字体，不打包或重新分发 PingFang SC / Microsoft YaHei 等系统字体。

## 图标

`组件/icons.js` 中为本项目编写的 SVG 线性图标，24×24 网格。图库可复制 SVG；图标默认只作装饰，按钮的可访问名称由外层提供。

## 参考图与截图

- `研究资料/approved-layout-v2.png`：用户通过的 AI 设计稿，记录布局方向；其中旧花卉只作评审证据，不作为此次背景素材。
- `研究资料/参考证据/`：公开页面与产品演示的研究截图，仅用于追溯设计观察。
- `预览图/`：本目录 HTML/CSS 在浏览器中的实际渲染截图。

## 清单与校验

`设计资产/manifest.json` 记录第三方资源路径、URL、许可说明、下载日期、字节数与 SHA-256。`npm run check` 会验证资源未损坏。

代码许可与第三方资产范围分别说明，见根目录 `LICENSE.md`。没有宣称 Fernand 的品牌、背景与内部设计归本项目所有。
