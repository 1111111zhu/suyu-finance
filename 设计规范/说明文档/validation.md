# 检查与复现

本套页面包含交互状态机、焦点行为和布局断点，因此同时提供完整性检查与浏览器交互检查。

## 本地文件检查

```sh
npm run check
```

检查所有 JS / MJS 语法、本地 HTML/CSS/Markdown 链接、重复 HTML ID、JSON 与 CSS 变量同步，以及第三方素材的大小与 SHA-256。

## 浏览器测试

运行页面无需依赖。运行以下自动化测试才需要 Playwright 和 Chromium：

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm test
```

如环境已有 Playwright，可通过 `PLAYWRIGHT_MODULE` 指定其模块位置，通过 `CHROMIUM_EXECUTABLE` 指定浏览器路径。默认测试临时启动 `127.0.0.1:3092`，结束后关闭；`TEST_BASE_URL` 可指定已启动的预览。

测试覆盖：

- 本地资源、字体与页面初始化。
- 必填、邮箱格式与错误修正、搜索空态。
- 四步完成条件、前序回看、全部完成及重置。
- Tabs、菜单、命令菜单的键盘操作。
- Dialog / Drawer 的焦点约束与关闭返回。
- 小组件形态、主题、位置、搜索和消息文本处理。
- 深色模式与系统减少动态偏好。
- 一月跨年与默认上月；天数为空。
- 薪资示例逐位核对、参数变更失效、未解析文件不推进。
- 非本月工资页面不显示步骤栏。
- 320 / 390 / 640 / 768 / 972 / 1440px 无页面横向溢出。
- 页面运行时错误、缺失资源及第三方网络请求。

运行记录写入 `test-results/results.json`，该临时目录被 Git 忽略。稳定截图写入 `预览图/`，供设计核验与后续比较。

## 验收边界

人工查看桌面主页面、组件页、樱花预览、深色页面及手机布局。自动测试使用 Chromium，不代表所有浏览器或辅助技术均已人工验收；正式接入真实业务后仍需验证对应的解析、计算、发送与服务端错误路径。

本次实际通过的记录见 [交付检查](../研究资料/validation-summary.json)。
