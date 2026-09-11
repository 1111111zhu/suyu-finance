# 组件清单与交互约定

全部基础组件使用 `ui-` 前缀，页面布局分别使用 `kit-` 与 `payroll-`。基础样式与业务页面没有绑定。

| 组件 | 样式 / 行为入口 | 已提供状态与操作 |
|---|---|---|
| Button | `.ui-button` | 主要、次要、强调、ghost、警告、危险；三种尺寸；图标；胶囊 |
| Button 状态 | `:hover / :active / :focus-visible / :disabled` | 点击反馈、聚焦环、禁用、加载 |
| Text action | `.ui-text-action` | 行内编辑、上传、详情 |
| Tooltip | `.ui-tooltip [role=tooltip]` | 悬停及键盘聚焦显示；仅承载补充说明 |
| Keycap | `.ui-key` | 命令快捷键与提示 |
| Spinner | `.ui-spinner` | 按钮内加载；搭配 `aria-busy` |
| Input | `.ui-input` | 默认、聚焦、禁用、格式错误 |
| Search | `.ui-input-wrap` | 图标、提示、实时过滤与无结果反馈 |
| Select | `.ui-select` / 原生 select | 保留浏览器键盘和日期选择行为 |
| Textarea | `.ui-textarea` | 多行输入；可调整高度 |
| Inline form | `.ui-inline-form` | 紧凑年月、窄天数、应用；可折叠 |
| Checkbox / Radio | `.ui-check` | 原生可访问输入；选择状态 |
| Switch | `.ui-switch` | `role=switch`，`aria-checked`，Space 切换 |
| Segmented | `.ui-segmented` + `data-segmented` | 点击、左右键、Home、End，`aria-pressed` |
| Tabs | `.ui-tabs` + `data-tabs` | 内容面板联动、左右键、Home、End、单一 tab stop |
| Badge | `.ui-badge` | 分类、计数、成功、警告、错误 |
| Pill | `.ui-pill` | 状态圆点和文字，无大色块 |
| Avatar / Group | `.ui-avatar / .ui-avatars` | 字母头像、叠放头像组 |
| Tag | `.ui-tag` | 可删除标签与还原示例 |
| Key/value | `.ui-keyvalue` | 标签、值、状态、行内操作 |
| List | `.ui-list` | 图标、主要内容、辅助说明、状态、操作 |
| Card | `.ui-card` | 独立上下文实体；单层短阴影 |
| Table | `.ui-table` | 明细、金额右对齐、行操作、容器内滚动 |
| Empty | `.ui-empty` | 空结果说明及下一步入口 |
| Skeleton | `.ui-skeleton` | 非真实数据占位、减少动态适配 |
| Progress | `.ui-progress` + `setProgress` | 有名称和值的 ARIA progressbar、过渡 |
| Stepper | `createStepper` | 验证后完成、前序回看、失效重置 |
| Collapsible | `details.ui-disclosure` | 原生展开折叠，方向箭头联动 |
| Divider | `.ui-divider` / `hr` | 极淡分隔线 |
| Menu | `[data-menu]` | 外部关闭、方向键、Home/End、Escape、焦点返回 |
| Dialog | `dialog.ui-dialog` | 原生模态、焦点约束、Escape、背景点击、触发器返回 |
| Drawer | `dialog.ui-drawer` | 侧边进入，沿用 Dialog 语义 |
| Toast | `toast()` | 礼貌播报、自动关闭、手动关闭、悬停延长 |
| Command palette | `dialog[data-command]` | ⌘K / Ctrl K、输入搜索、方向键、Enter、无结果 |
| Widget preview | `initWidget()` | Popup/Modal/Drawer、左右、明暗、三色、开合、搜索、文章、消息输入 |
| Canvas | `.ui-canvas--*` | 纯净、连续樱花、原图樱花、点阵、CSS 雾色 |
| Icon | `icon()` / `renderIcons()` | 可复制 SVG，默认装饰性图标不重复播报 |

## 文档对应关系

Fernand 公开 Custom Data 文档的 13 类模式：Text、Key/value、List、Button、Spacer、Badge、Pill、Card、Tabs、Collapsible、Divider、Table、Form，均有对应样式或组合示例。

更多组件来自其官网公开产品演示与聊天演示的观察。上传、计薪参数和四步核对流程属于此次业务适配。代码为本项目独立实现；组件名称对应关系不表示 Fernand 内部源码已被取得。

## 焦点与键盘

- 所有图标按钮必须有 `aria-label`。纯装饰 SVG 标为 `aria-hidden`。
- 页面初始不抢占焦点；打开模态时焦点进入，关闭后返回入口。
- 菜单与命令列表用方向键移动；Tab 仍可正常离开非模态菜单。
- 聊天画布是组件形态预览，不冒充真实模态；实际焦点锁定由单独的原生 Dialog / Drawer 组件承担。
- 操作反馈通过 Toast 的 `aria-live="polite"` 提供，不重复朗读整个页面。
- 关闭的移动目录设为 `inert`，不会在看不到的地方留下可聚焦链接。

## 输入与安全边界

示例消息、输入内容与文件名使用 `textContent` 或 HTML 转义。组件示例不调用任何发送、支付或上传接口。实际文件仅做扩展名、非空与大小的前端检查，不会把「已选择」当成「已解析」。

原生 `required`、数值范围、步长验证用于短参数表单；需要多字段错误反馈时，显式设置 `aria-invalid` 和关联错误说明。错误信息不能只用红框表达。

## 目前不是生产业务功能的部分

薪资计算、Excel 解析、邮件发送、业务持久化和历史归档都没有接入；示例数据专门用于验证 UI 流程。页面刷新会重置业务状态。深浅主题偏好保存在本地浏览器，其他内容不持久化。

可复用的是组件、状态约定、布局和交互控制器；将它们接入真实业务后，再连接业务完成条件和服务端错误反馈。
