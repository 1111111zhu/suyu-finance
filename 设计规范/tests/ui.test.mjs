import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const port = Number(process.env.TEST_PORT || 3092);
const base = process.env.TEST_BASE_URL || `http://127.0.0.1:${port}`;
let server;
if (!process.env.TEST_BASE_URL) server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
for (let i = 0; i < 30; i++) {
  try { if ((await fetch(base)).ok) break; } catch {}
  await new Promise(resolve => setTimeout(resolve, 100));
}
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [], missing = [], external = [], results = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', response => { if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`); });
page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url()); });
const test = async (name, run) => { await run(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); };
const previews = path.join(root, 'previews');
await mkdir(previews, { recursive: true });
const gallery = () => page.goto(base + '/', { waitUntil: 'networkidle' });
const payroll = () => page.goto(base + '/examples/payroll.html', { waitUntil: 'networkidle' });
const completeCount = selector => page.locator(`${selector} [data-complete="true"]`).count();
try {
  await test('静态资源、标题与本地字体正常加载', async () => {
    await gallery(); assert.match(await page.title(), /规范设计/);
    assert.equal(await page.evaluate(() => document.fonts.check('14px Inter')), true);
    assert.equal(await page.locator('#icon-library button').count() > 30, true);
    await page.screenshot({ path: path.join(previews, 'gallery-desktop.png') });
  });
  await test('表单错误提示与修正、搜索空结果', async () => {
    await page.locator('#sample-form button').click();
    assert.equal(await page.locator('[name="name"]').getAttribute('aria-invalid'), 'true');
    await page.locator('[name="name"]').fill('林晓');
    await page.locator('[name="email"]').fill('invalid');
    await page.locator('#sample-form button').click();
    assert.equal(await page.locator('#email-error').isVisible(), true);
    await page.locator('[name="email"]').fill('lin@example.com');
    await page.locator('#sample-form button').click();
    assert.equal(await page.locator('#email-error').isVisible(), false);
    await page.locator('#component-search').fill('不存在');
    assert.equal(await page.locator('#member-search-empty').isVisible(), true);
    await page.locator('#component-search').fill('林晓');
    assert.equal(await page.locator('#member-search-list li:visible').count(), 1);
  });
  await test('步骤必须满足条件，回看不造假，重置清除状态', async () => {
    assert.equal(await completeCount('#flow-demo'), 0);
    assert.equal(await page.locator('#flow-demo [data-index="1"]').isDisabled(), true);
    assert.equal(await page.locator('#flow-complete').isDisabled(), true);
    await page.locator('#flow-condition').check(); await page.locator('#flow-complete').click();
    assert.equal(await completeCount('#flow-demo'), 1);
    await page.locator('#flow-demo [data-index="0"]').click();
    assert.equal(await completeCount('#flow-demo'), 1);
    await page.locator('#flow-demo [data-index="1"]').click();
    assert.equal(await page.locator('#flow-complete').isDisabled(), true);
    for (let i = 1; i < 4; i++) { await page.locator('#flow-condition').check(); await page.locator('#flow-complete').click(); }
    assert.equal(await completeCount('#flow-demo'), 4);
    await page.locator('#flow-reset').click(); assert.equal(await completeCount('#flow-demo'), 0);
  });
  await test('页签支持方向键，菜单支持 Escape 与焦点返回', async () => {
    await page.locator('#tab-records').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#panel-empty').isVisible(), true);
    assert.equal(await page.locator('#tab-empty').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('ArrowLeft');
    const trigger = page.locator('[aria-controls="action-menu"]');
    await trigger.click(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#action-menu').isVisible(), true);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#action-menu').isVisible(), false);
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  });
  await test('对话框和抽屉约束焦点、Escape 返回入口', async () => {
    const trigger = page.locator('[data-open-dialog="sample-dialog"]'); await trigger.click();
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.closest('dialog')?.id), 'sample-dialog'); }
    await page.keyboard.press('Escape'); assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    await page.locator('#motion [data-open-dialog="detail-drawer"]').last().click();
    assert.equal(await page.locator('#detail-drawer').evaluate(el => el.open), true);
    await page.keyboard.press('Escape');
  });
  await test('命令菜单支持快捷键、搜索空态和关闭', async () => {
    await page.keyboard.press('Control+k');
    assert.equal(await page.locator('#command-dialog').evaluate(el => el.open), true);
    await page.locator('#command-dialog input').fill('不存在的命令');
    assert.equal(await page.locator('[data-command-empty]').isVisible(), true);
    await page.keyboard.press('Escape');
  });
  await test('小组件三种形式、明暗、左右、关闭、搜索与安全文本', async () => {
    const root = page.locator('#widget-playground');
    await root.locator('[data-widget-setting="mode"] [data-value="modal"]').click();
    assert.equal(await root.getAttribute('data-mode'), 'modal');
    await root.locator('[data-widget-setting="mode"] [data-value="drawer"]').click();
    await root.locator('[data-widget-setting="position"] [data-value="left"]').click();
    await root.locator('[data-widget-setting="theme"] [data-value="dark"]').click();
    assert.equal(await page.locator('#help-widget').getAttribute('data-theme'), 'dark');
    await page.locator('#widget-close').click(); assert.equal(await page.locator('#help-widget').isVisible(), false);
    await page.locator('#widget-launcher').click();
    await page.locator('#widget-search').fill('不存在'); assert.equal(await page.locator('.widget-no-results').isVisible(), true);
    await page.locator('#widget-search').fill('');
    await page.locator('.widget-tabs [data-widget-view="chat"]').click();
    await page.locator('#widget-message').fill('<img src=x onerror=alert(1)>');
    await page.locator('#widget-chat-form button').click();
    assert.equal(await page.locator('.widget-messages img').count(), 0);
    assert.match(await page.locator('.widget-messages').textContent(), /<img/);
    await page.locator('.widget-tabs [data-widget-view="home"]').click();
    await root.locator('[data-widget-setting="mode"] [data-value="popup"]').click();
    await root.locator('[data-widget-setting="theme"] [data-value="light"]').click();
    await root.locator('[data-widget-setting="position"] [data-value="right"]').click();
    await root.screenshot({ path: path.join(previews, 'cherry-widget.png') });
  });
  await test('深色主题与减少动态偏好', async () => {
    await page.locator('[data-theme-toggle]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.waitForFunction(() => !document.documentElement.classList.contains('ui-theme-changing'));
    await page.evaluate(() => scrollTo({ top: document.getElementById('actions').offsetTop - 24, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('.kit-nav a[href="#actions"]')?.getAttribute('aria-current') === 'page');
    await page.screenshot({ path: path.join(previews, 'components-dark.png') });
    await page.locator('[data-theme-toggle]').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.kit-motion-dot').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration)) < .01, true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  await test('上个月默认值含一月跨年，天数不预填', async () => {
    await payroll(); assert.match(await page.title(), /SEEEX/);
    assert.equal(await page.locator('[name="days"]').inputValue(), '');
    const result = await page.evaluate(async () => {
      const { setupDateFields } = await import('/components/date-fields.js');
      const form = document.createElement('form'); form.innerHTML = '<select name="year"></select><select name="month"></select>';
      setupDateFields(form, new Date(2027, 0, 11));
      return [form.elements.year.value, form.elements.month.value];
    });
    assert.deepEqual(result, ['2026', '12']);
    assert.equal(await completeCount('#payroll-flow'), 0);
    await page.screenshot({ path: path.join(previews, 'payroll-desktop.png') });
  });
  await test('薪资完整四步，逐位核对前不能继续，参数修改使完成失效', async () => {
    assert.equal(await page.locator('#context-next').isDisabled(), true);
    await page.locator('#load-demo').click(); assert.equal(await page.locator('#context-next').isDisabled(), true);
    await page.locator('[name="days"]').fill('22'); await page.locator('#payroll-params button').click();
    assert.equal(await page.locator('#context-next').isDisabled(), false);
    await page.locator('#context-next').click(); assert.equal(await completeCount('#payroll-flow'), 1);
    assert.equal(await page.locator('#context-next').isDisabled(), true);
    for (let i = 0; i < 3; i++) { await page.locator(`[data-review="${i}"]`).click(); await page.locator('#review-confirm').click(); }
    await page.locator('#context-next').click(); assert.equal(await completeCount('#payroll-flow'), 2);
    await page.locator('#load-demo').click(); await page.locator('#context-next').click();
    assert.equal(await completeCount('#payroll-flow'), 3);
    for (let i = 0; i < 3; i++) { await page.locator(`[data-review="${i}"]`).click(); await page.locator('#review-confirm').click(); }
    await page.locator('#context-next').click(); assert.equal(await completeCount('#payroll-flow'), 4);
    await page.locator('#payroll-flow [data-index="0"]').click(); assert.equal(await completeCount('#payroll-flow'), 4);
    await page.locator('[name="days"]').fill('21'); assert.equal(await completeCount('#payroll-flow'), 0);
    assert.equal(await page.locator('#context-next').isDisabled(), true);
    await page.locator('#payroll-params button').click();
    assert.equal(await page.locator('#context-next').isDisabled(), false);
    await page.locator('#reset-demo').click();
    assert.equal(await page.locator('[name="days"]').inputValue(), '');
  });
  await test('未解析 Excel 不标为已完成；历史和邮件没有步骤栏', async () => {
    await page.locator('#files').setInputFiles({ name: '工资.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('not a real workbook') });
    assert.equal(await completeCount('#payroll-flow'), 0);
    assert.equal(await page.locator('#context-next').isDisabled(), true);
    assert.match(await page.locator('.payroll-materials').textContent(), /待解析/);
    for (const section of ['history','email','settings']) { await page.locator(`.payroll-nav [data-section="${section}"]`).click(); assert.equal(await page.locator('.payroll-steps').isVisible(), false); }
    await page.locator('.payroll-nav [data-section="salary"]').click(); await page.locator('#reset-demo').click();
  });
  await test('320–1440px 页面无横向溢出，手机目录可开关', async () => {
    for (const width of [320,390,640,768,972,1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const url of ['/', '/examples/payroll.html']) {
        await page.goto(base + url, { waitUntil: 'networkidle' });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `${url} overflow at ${width}`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(previews, 'payroll-mobile.png'), fullPage: true });
    await gallery();
    await page.locator('#mobile-nav').click(); assert.equal(await page.locator('#kit-sidebar').evaluate(el => el.inert), false);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#kit-sidebar').evaluate(el => el.inert), true);
    await page.screenshot({ path: path.join(previews, 'gallery-mobile.png') });
  });
  await test('无运行错误、无缺失请求、无第三方网络调用', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(missing, []); assert.deepEqual(external, []);
  });
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await writeFile(path.join(root, 'test-results/results.json'), JSON.stringify({ date: new Date().toISOString(), browser: await browser.version(), tests: results, errors, missing, external }, null, 2));
  console.log(`${results.length} checks passed.`);
} finally { await browser.close(); server?.kill(); }
