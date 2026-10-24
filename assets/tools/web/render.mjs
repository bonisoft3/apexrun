// node render.mjs <jobs.json> : renders each job ({out, ...renderJob args}) to a PNG with WebGPU in headless Chromium.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const port = 8770 + Math.floor(Math.random() * 100);
const srv = await serve(port);
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', e => { console.error('pageerror', e.message); process.exit(1); });
await page.goto(`http://localhost:${port}/web/render.html`);
const results = [];
for (const job of jobs) {
  const t = Date.now();
  await page.setViewportSize({ width: job.width || 1024, height: job.height || 768 });
  const r = await page.evaluate(j => window.renderJob(j), job);
  await page.waitForTimeout(300);
  await page.locator('#c').screenshot({ path: job.out });
  await page.evaluate(() => window.disposeJob());
  results.push({ out: job.out, ...r, seconds: (Date.now() - t) / 1000 });
  console.log(job.out, JSON.stringify(r));
}
const bad = errors.filter(e => !/wasm streaming|falling back to ArrayBuffer/.test(e));
if (bad.length) { console.error('page errors:\n' + bad.join('\n')); process.exit(1); }
fs.writeFileSync(process.argv[2].replace(/\.json$/, '.results.json'), JSON.stringify(results, null, 1));
await browser.close(); srv.close();
