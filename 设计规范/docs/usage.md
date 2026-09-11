# 接入与复用

## 最小页面

运行时不依赖框架和 npm 包。复制 `tokens`、`styles`、`components`、`assets` 目录，保持相对路径。

```html
<html lang="zh-CN" data-theme="light" data-accent="mint">
<head>
  <link rel="stylesheet" href="styles/foundations.css">
  <link rel="stylesheet" href="styles/components.css">
  <link rel="stylesheet" href="styles/canvases.css">
  <link rel="stylesheet" href="styles/motion.css">
</head>
<body class="ui-canvas ui-canvas--floral">
  <button class="ui-button ui-button--pill" data-toast="已选择">
    <span data-icon="upload"></span>选择文件
  </button>
  <script type="module">
    import { initUI } from './components/ui.js';
    initUI();
  </script>
</body>
</html>
```

`foundations.css` 会加载生成后的 tokens CSS 和本地字体。页面需通过 HTTP 静态服务加载 ES modules。

## 变量

只编辑 `tokens/tokens.json`，再运行：

```sh
npm run tokens
```

JSON 分为 `base / light / dark / mint / blue`。变量统一以 `--ui-` 开头。页面级尺寸放在对应布局 CSS，避免让业务选择污染组件默认值。

```css
.your-content {
  color: var(--ui-text);
  border-bottom: 1px solid var(--ui-line);
  padding: var(--ui-space-6) 0;
}
```

局部明暗主题可以直接标在容器上。切换页面主题使用 `setTheme()`，会同步主题按钮与本地偏好。

```js
import { setTheme } from './components/ui.js';
setTheme('dark');
document.documentElement.dataset.accent = 'blue';
```

嵌入已有应用时先检查基础 reset 的影响；可以把 `foundations.css` 的通用选择器约束在应用根容器，或者只提取字体与变量。`ui-` 控件名与页面 `kit- / payroll-` 名保持分离。

## 交互 API

```js
import { initUI, toast, openDialog, createStepper, setProgress } from './components/ui.js';
initUI();                     // 每个静态页面初始化一次
toast('保存成功');
openDialog('details-dialog'); // 原生 dialog 的 id
setProgress(progressNode, 50, '核对完成进度');
```

`initUI()` 绑定当前 DOM 中声明式标记。动态新增组件应单独绑定该组件行为，避免对已初始化节点重复调用；当前静态页面已按此方式实现。

### 步骤

```js
const flow = createStepper(nav, {
  labels: ['准备资料', '核对应发', '补充扣款', '核对实发'],
  validate(index) {
    // 使用当前真实业务状态。这里返回同步布尔值。
    return requirements[index].every(condition => condition.passed);
  },
  onChange({ current, completed, available, percent }) {
    renderCurrentStep(current);
    setProgress(progressNode, percent);
  }
});

flow.complete();     // 验证当前步骤；成功时推进
flow.go(0);          // 回看；不会增加或清除完成状态
flow.invalidate(0); // 基础资料改变后，清除此步及后续状态
flow.reset();        // 全部清空，回到第一步
const state = flow.state; // 返回快照，不能靠修改快照改变内部状态
```

异步校验应由业务层先等待服务器或解析器成功，再更新布尔完成条件并调用 `complete()`；不要直接把 Promise 当成 `validate()` 的返回值。重复完成已完成步骤不推进；超出可用步骤的跳转会返回 `false`。

### 日期与轻量参数

```js
import { setupDateFields } from './components/date-fields.js';
setupDateFields(form); // year、month 两个原生 select
```

默认上一个自然月。2026 年 9 月为 2026 年 8 月；2027 年 1 月为 2026 年 12 月。天数由用户输入，每次示例重置为空。表单修改后需重新应用，业务实现应同步使旧结果失效。

### 分段选择与开关

```js
group.addEventListener('ui:change', event => {
  console.log(event.detail.value);   // data-segmented
  console.log(event.detail.checked); // role=switch
});
```

## 画布组合

工作台不要包上大卡片。使用 grid 或 flex 在页面上直接分栏：

```html
<div class="ui-canvas ui-canvas--floral workspace">
  <nav class="workspace-nav">...</nav>
  <main class="workspace-content">...</main>
  <aside class="workspace-context">...</aside>
</div>
```

参考 `styles/payroll.css`。展示图像可以使用完整樱花；工作区使用 CSS 渐隐层，保证正文所在区域稳定。背景资源与组件无耦合，可单独换图。

## 静态部署与 GitHub

1. 在仓库中保留本目录结构、字体 OFL、素材来源说明。
2. 用 `npm run check` 检查本地引用和资源完整性。
3. 如需 GitHub Pages，可选择仓库根目录作为发布源；所有页面资源均为相对路径，可挂在仓库子路径。
4. 页面本身不需要 API key、环境变量或服务器业务接口。
5. `scripts/serve.mjs` 仅为本地预览服务器，默认绑定 `127.0.0.1:3091`；生产环境使用静态托管服务。

此目录没有自动发布脚本，不会在执行检查时上传或发送任何数据。
