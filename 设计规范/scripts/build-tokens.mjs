import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const tokens = JSON.parse(await readFile(new URL('tokens/tokens.json', root), 'utf8'));
const block = (selector, values) => `${selector} {\n${Object.entries(values).map(([k, v]) => `  --ui-${k}: ${v};`).join('\n')}\n}\n`;
const css = '/* Generated from tokens.json. Run npm run tokens after editing. */\n'
  + block(':root', { ...tokens.base, ...tokens.light, ...tokens.mint })
  + block('[data-theme="light"]', tokens.light)
  + block('[data-theme="dark"]', tokens.dark)
  + block('[data-accent="mint"]', tokens.mint)
  + block('[data-accent="blue"]', tokens.blue)
  + '[data-theme="dark"] { --ui-accent: color-mix(in srgb, var(--ui-accent-mark) 65%, white); color-scheme: dark; }\n'
  + '[data-theme="light"] { color-scheme: light; }\n';
await writeFile(new URL('tokens/tokens.css', root), css);
console.log('tokens.css updated');
