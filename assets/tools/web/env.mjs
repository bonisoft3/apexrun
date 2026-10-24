// node env.mjs <size> : every stage HDRI -> work/env/<stage>.env via Babylon's EnvironmentTextureTools (WebGPU).
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
const size = Number(process.argv[2] || 256);
const sel = JSON.parse(fs.readFileSync('../work/sky/sky_ldr.json', 'utf8'));
const srv = await serve(8766);
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const page = await browser.newPage();
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => { console.error('pageerror', e.message); process.exit(1); });
await page.goto('http://localhost:8766/web/env.html');
fs.mkdirSync('../work/env', { recursive: true });
const log = {};
for (const [stage, { polyhaven }] of Object.entries(sel)) {
  const t = Date.now();
  const { b64, info } = await page.evaluate(([u, s]) => window.makeEnv(u, s), [`/work/hdr/${stage}.hdr`, size]);
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(`../work/env/${stage}.env`, buf);
  log[stage] = { polyhaven, ...info, bytes: buf.length, seconds: (Date.now() - t) / 1000 };
  console.log(stage, JSON.stringify(log[stage]));
}
fs.writeFileSync('../work/env/env.json', JSON.stringify(log, null, 1));
await browser.close(); srv.close();
