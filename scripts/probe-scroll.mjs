// Measures where the chart actually scrolls to on load, per view mode.
// Run: node scripts/probe-scroll.mjs
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const URL = 'http://localhost:3000';
// Unique per-run profile so cleanup can target only this run's Chrome.
const PROFILE = `${process.env.TEMP}\\xg-cdp-scroll-${process.pid}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1600,2400',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false }
);

/** Kill only this run's browser; never touch other Chrome windows. */
async function cleanup() {
  try {
    ws?.close();
  } catch {}
  chrome.kill('SIGKILL');
  await sleep(300);
  const { rmSync } = await import('node:fs');
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {}
}

async function devtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('devtools never came up');
}
const version = await devtools();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
let ws;
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  return result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(4000);

// open Gantt section
await evaluate(`(() => {
  const stack = [document.body];
  const hits = [];
  while (stack.length) {
    const el = stack.pop();
    if (el.nodeType !== 1) continue;
    if ((el.textContent || '').trim() === 'Gantt Schedule') hits.push(el);
    for (const c of el.children) stack.push(c);
  }
  const el = hits.sort((a,b) => a.textContent.length - b.textContent.length)[0];
  let n = el;
  while (n && n.tagName !== 'BUTTON' && n.tagName !== 'A') n = n.parentElement;
  (n ?? el).click();
})()`);
await sleep(1500);

const MEASURE = `(() => {
  const c = document.querySelector('.xg-gantt .gantt-container');
  if (!c) return null;
  const bars = [...c.querySelectorAll('.bar-wrapper')];
  const cRect = c.getBoundingClientRect();
  const firstBar = bars[0]?.querySelector('.bar')?.getBoundingClientRect();
  const lastBar = bars[bars.length - 1]?.querySelector('.bar')?.getBoundingClientRect();
  return {
    scrollLeft: Math.round(c.scrollLeft),
    scrollWidth: Math.round(c.scrollWidth),
    clientWidth: Math.round(c.clientWidth),
    leftDeadSpace: firstBar ? Math.round(firstBar.x - cRect.x) : null,
    lastBarRight: lastBar ? Math.round(lastBar.right - cRect.x) : null,
    barsVisible: bars.filter((b) => {
      const r = b.querySelector('.bar')?.getBoundingClientRect();
      return r && r.x >= cRect.x - 2 && r.right <= cRect.right + 2;
    }).length,
    totalBars: bars.length,
  };
})()`;

const setMode = async (mode) => {
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(mode)});
    b?.click();
  })()`);
  await sleep(1500);
  return evaluate(MEASURE);
};

const out = { chrome: version.Browser };
out.dayOnLoad = await evaluate(MEASURE);
out.week = await setMode('Week');
out.month = await setMode('Month');
out.dayAgain = await setMode('Day');

// what does a manual scroll to the true start look like?
out.afterManualScrollToZero = await evaluate(`(() => {
  const c = document.querySelector('.xg-gantt .gantt-container');
  c.scrollLeft = 0;
  return { scrollLeft: Math.round(c.scrollLeft) };
})()`);
await sleep(400);

// what scrollLeft actually brings the first bar into view?
out.scrollToFirstBar = await evaluate(`(() => {
  const c = document.querySelector('.xg-gantt .gantt-container');
  const bar = c.querySelector('.bar-wrapper .bar');
  const target = bar.getBoundingClientRect().x - c.getBoundingClientRect().x + c.scrollLeft;
  c.scrollLeft = Math.max(0, target - 80);
  return { computedTarget: Math.round(target), applied: Math.round(c.scrollLeft) };
})()`);

console.log(JSON.stringify(out, null, 2));
await cleanup();
process.exit(0);
