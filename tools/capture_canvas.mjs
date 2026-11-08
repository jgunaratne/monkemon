#!/usr/bin/env node
// Deterministic headless capture of the Monkemon WebGL canvas via the Chrome DevTools Protocol.
// Boots the game in headless Chrome (SwiftShader), waits until GLB/texture loading is idle plus N
// rendered frames, then reads the finished drawing buffer with `canvas.toDataURL()`
// (`preserveDrawingBuffer` is on). Unlike `--screenshot`, this never races the compositor on slow
// software-GL frames, so it is what `tools/smoke_test.py` uses. Console errors are echoed as
// `console: ...` lines. Add `&gfx=high` to the query to exercise the full post-processing tier.
// usage: node tools/capture_canvas.mjs "<query>" <out.png> [frames=4] [WxH=1280x800] [timeoutSec=240]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [query, out, framesArg = '4', sizeArg = '1280x800', timeoutArg = '240'] = process.argv.slice(2);
const frames = Number(framesArg);
const [W, H] = sizeArg.split('x').map(Number);
const profile = mkdtempSync(join(tmpdir(), 'mk-cdp-'));
const url = `http://127.0.0.1:${process.env.PORT || 8731}/?touch=0&${query}`;

const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-extensions', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`, `--window-size=${W},${H}`,
  '--remote-debugging-port=0', '--enable-logging=stderr', '--v=0',
  "--proxy-server=direct://", "--proxy-bypass-list=*", 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const consoleLines = [];
let wsUrl = null;
const wsReady = new Promise((resolve) => {
  chrome.stderr.on('data', (d) => {
    const s = d.toString();
    for (const line of s.split('\n')) {
      const m = line.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { wsUrl = m[1]; resolve(wsUrl); }
      if (/CONSOLE/.test(line) && !/policy|gcm|mcs_client/.test(line)) consoleLines.push(line.replace(/.*CONSOLE:\d+\] /, '').slice(0, 220));
    }
  });
});

const killAll = () => { try { chrome.kill('SIGKILL'); } catch (_) {} try { rmSync(profile, { recursive: true, force: true }); } catch (_) {} };
const timer = setTimeout(() => { console.error('TIMEOUT'); killAll(); process.exit(2); }, Number(timeoutArg) * 1000);

await wsReady;
const port = new URL(wsUrl).port;
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

// Wait until the game booted, GLB/texture loading went idle, and N further frames were rendered
const waitExpr = `(async () => {
  const start = performance.now();
  const limit = ${Number(timeoutArg) * 1000 - 25000};
  const THREE = await import('three');
  const mgr = THREE.DefaultLoadingManager;
  let lastActivity = performance.now();
  let inflight = 0;
  const prevStart = mgr.itemStart.bind(mgr), prevEnd = mgr.itemEnd.bind(mgr);
  mgr.itemStart = (u) => { inflight++; lastActivity = performance.now(); return prevStart(u); };
  mgr.itemEnd = (u) => { inflight = Math.max(0, inflight - 1); lastActivity = performance.now(); return prevEnd(u); };
  mgr.itemError = (u) => { inflight = Math.max(0, inflight - 1); lastActivity = performance.now(); };
  const booted = () => window.__MONKEMON__ && window.__MONKEMON__.renderer && window.__MONKEMON__.renderer._loggedFirstFrame;
  while (!booted() && performance.now() - start < limit) await new Promise(r => setTimeout(r, 100));
  const g = window.__MONKEMON__;
  try {
    const promises = [
      ...(g?.world?.diorama?.loadPromises || []),
      ...(g?.world?.interiorDiorama?.loadPromises || []),
      g?.world?.heroActor?.readyPromise,
      g?.world?.partnerActor?.readyPromise,
    ].filter(Boolean);
    if (promises.length > 0) await Promise.race([Promise.all(promises), new Promise(r => setTimeout(r, 75000))]);
  } catch (e) {}
  // loading idle: nothing in flight for 1.5s (textures decode after itemEnd, so also require >= 3s since boot)
  while ((inflight > 0 || performance.now() - lastActivity < 1500) && performance.now() - start < limit) await new Promise(r => setTimeout(r, 100));
  let frames = 0;
  await new Promise((resolve) => { const tick = () => { frames++; if (frames >= ${frames}) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  return { frames, ms: Math.round(performance.now() - start), inflight };
})()`;
const waited = await send('Runtime.evaluate', { expression: waitExpr, awaitPromise: true, returnByValue: true });
const dataRes = await send('Runtime.evaluate', {
  expression: `(() => { const c = document.getElementById('game-canvas'); const gl = window.__MONKEMON__?.renderer?.renderer?.getContext(); if (gl) gl.finish(); return c.toDataURL('image/png'); })()`,
  returnByValue: true,
});
const dataUrl = dataRes.result?.result?.value || '';
if (!dataUrl.startsWith('data:image/png')) { console.error('no canvas data', JSON.stringify(dataRes).slice(0, 300)); killAll(); process.exit(1); }
writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
clearTimeout(timer);
console.log(`== ${out} wait=${JSON.stringify(waited.result?.result?.value)} bytes=${Buffer.from(dataUrl.split(',')[1], 'base64').length}`);
const uniq = [...new Set(consoleLines)].filter((l) => !/Graphics tier|first frame/.test(l));
for (const l of uniq.slice(0, 12)) console.log('  console:', l);
killAll();
process.exit(0);
