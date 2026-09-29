// Runtime verification for the rebuilt Gantt section.
// Drives a real Chrome over CDP: navigates to the app, opens the Gantt section,
// exercises the toolbar controls, and asserts the frappe-gantt DOM responds.
// Not part of the app build:  node scripts/verify-gantt.mjs
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const URL = process.env.APP_URL ?? 'http://localhost:3002';
// Unique per-run profile so concurrent runs never share a lock, and so cleanup
// can target only the Chrome processes this script started.
const PROFILE = `${process.env.TEMP}\\xg-cdp-${process.pid}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- launch Chrome -----------------------------------------------------
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1600,2400',
    'about:blank',
  ],
  { stdio: 'ignore', detached: false }
);

/** Kill only the browser tree this script launched (never other Chrome windows). */
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

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint never came up');
}

const version = await waitForDevtools();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

let ws;
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const pageExceptions = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '?').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageExceptions.push(
      msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text
    );
  }
});

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      'page eval failed: ' +
        (res.exceptionDetails.exception?.description ?? res.exceptionDetails.text)
    );
  }
  return res.result.value;
}

/** Click the first element whose accessible name matches `name`, searching the
 *  live DOM so it can be called repeatedly as the UI re-renders. */
async function clickByLabel(name) {
  // Resolve the node itself (returnByValue:false) so we get an objectId back.
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: `(() => {
      const stack = [document.body];
      const seen = [];
      while (stack.length) {
        const el = stack.pop();
        if (!el || el.nodeType !== 1) continue;
        const aria = el.getAttribute('aria-label');
        const text = (el.textContent || '').trim();
        if (aria === ${JSON.stringify(name)} || text === ${JSON.stringify(name)}) seen.push(el);
        for (const c of el.children) stack.push(c);
      }
      if (!seen.length) return null;
      // Innermost match is the control itself.
      return seen.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    })()`,
    returnByValue: false,
  });
  if (exceptionDetails) {
    throw new Error('clickByLabel eval failed: ' + JSON.stringify(exceptionDetails));
  }
  if (!result || result.subtype === 'null' || !result.objectId) return false;
  await send('Runtime.callFunctionOn', {
    objectId: result.objectId,
    functionDeclaration: `function () {
      let el = this;
      while (el && el.tagName !== 'BUTTON' && el.tagName !== 'A') el = el.parentElement;
      (el ?? this).click?.();
      return true;
    }`,
    returnByValue: true,
  });
  return true;
}

const SNAPSHOT = `(() => {
  const root = document.querySelector('.xg-gantt');
  const container = root?.querySelector('.gantt-container');
  const bars = [...(root?.querySelectorAll('.bar-wrapper') ?? [])];
  const fillOf = (el) => (el ? getComputedStyle(el).fill : null);
  const cs = container ? getComputedStyle(container) : null;
  return {
    bars: bars.length,
    redBars: bars.filter((b) => fillOf(b.querySelector('.bar')) === 'rgb(220, 38, 38)').length,
    slateBars: bars.filter((b) => fillOf(b.querySelector('.bar')) === 'rgb(51, 65, 85)').length,
    gradations: bars.filter((b) => b.querySelector('.bar-progress')).length,
    weekendColumns: (root?.querySelectorAll('.holiday-highlight') ?? []).length,
    headerTicks: (root?.querySelectorAll('.grid-header text, .lower-text, .upper-text') ?? []).length,
    arrows: (root?.querySelectorAll('.arrow') ?? []).length,
    labels: bars.map((b) => b.querySelector('.bar-label')?.textContent?.trim()).filter(Boolean),
    charts: document.querySelectorAll('.xg-gantt .gantt-container').length,
    svgWidth: root?.querySelector('svg.gantt')?.getAttribute('width') ?? null,
    barVar: cs?.getPropertyValue('--g-bar-color').trim() ?? null,
    errorBanner: document.body.innerText.includes('could not be rendered'),
  };
})()`;

await send('Page.enable');
await send('Runtime.enable');

// --- load the app ------------------------------------------------------
await send('Page.navigate', { url: URL });
await sleep(4000);

const pageTitle = await evaluate('document.title');
const appMounted = await evaluate(`!!document.querySelector('#root')?.children.length`);

// --- open the Gantt section -------------------------------------------
const openedGantt = await clickByLabel('Gantt Schedule');
await sleep(1500);
const dayView = await evaluate(SNAPSHOT);

// --- toggle critical-path highlighting off ----------------------------
const toggledCritical = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Critical Path ('));
  if (!btn) return null;
  const before = btn.textContent.trim();
  btn.click();
  return before;
})()`);
await sleep(700);
const criticalOff = await evaluate(SNAPSHOT);
const toggleLabelAfter = await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Critical Path ('));
  return btn ? btn.getAttribute('aria-pressed') : null;
})()`);

// toggle back on
await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Critical Path ('));
  btn?.click();
})()`);
await sleep(700);
const criticalBackOn = await evaluate(SNAPSHOT);

// --- switch view modes ------------------------------------------------
const switchedWeek = await clickByLabel('Week');
await sleep(1400);
const weekView = await evaluate(SNAPSHOT);

const switchedMonth = await clickByLabel('Month');
await sleep(1400);
const monthView = await evaluate(SNAPSHOT);

// --- screenshot the whole Gantt panel ---------------------------------
// Capture in Day view (the default), and in Month view, for visual review.
const shoot = async (file) => {
  await evaluate(`(() => {
    const root = document.querySelector('.xg-gantt');
    const section = root?.closest('div.space-y-6') ?? root;
    const b = section.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + b.top - 20);
  })()`);
  await sleep(500);
  const rect = await evaluate(`(() => {
    const root = document.querySelector('.xg-gantt');
    const section = root?.closest('div.space-y-6') ?? root;
    const b = section.getBoundingClientRect();
    return { x: Math.max(0, b.x - 8), y: Math.max(0, b.y - 8), width: Math.min(1560, b.width + 16), height: Math.min(1500, b.height + 16) };
  })()`);
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    clip: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      scale: 1,
    },
  });
  writeFileSync(file, Buffer.from(data, 'base64'));
};

await clickByLabel('Day');
await sleep(1400);
await shoot('C:\\ghannt\\gantt-verify.png');
await clickByLabel('Month');
await sleep(1400);
await shoot('C:\\ghannt\\gantt-verify-month.png');

// --- interaction checks: drag to move, double-click for details --------
// Back to Day view for stable column math, then drive the bar with raw mouse
// input so the library's own drag/resize handling is exercised end-to-end.
await clickByLabel('Day');
await sleep(1200);
await evaluate(`(() => {
  document.querySelector('.xg-gantt .bar-wrapper .bar')?.scrollIntoView({ block: 'center' });
  return true;
})()`);
await sleep(400);

/** Center of the first bar, in viewport coordinates. */
const barCenter = () =>
  evaluate(`(() => {
    const bar = document.querySelector('.xg-gantt .bar-wrapper .bar');
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);

/** Start date shown for the first task in the Schedule Detail table. */
const rowStart = () =>
  evaluate(`(() => {
    const cells = document.querySelectorAll('table tbody tr td');
    return cells.length ? cells[1].textContent.trim() : null;
  })()`);
const pinnedCount = () =>
  evaluate(`document.querySelectorAll('.xg-gantt .bar-wrapper.xg-pinned').length`);
const hasErrorBanner = () =>
  evaluate(`document.body.innerText.includes('could not be rendered')`);

const moveBefore = { start: await rowStart(), pinned: await pinnedCount() };
const c = await barCenter();
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, button: 'none' });
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: c.x,
  y: c.y,
  button: 'left',
  buttons: 1,
  clickCount: 1,
});
for (const step of [15, 30, 48]) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: c.x + step,
    y: c.y,
    button: 'left',
    buttons: 1,
  });
  await sleep(50);
}
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: c.x + 48,
  y: c.y,
  button: 'left',
  buttons: 0,
  clickCount: 1,
});
await sleep(1300); // debounced commit + chart rebuild
const moveAfter = {
  start: await rowStart(),
  pinned: await pinnedCount(),
  errorBanner: await hasErrorBanner(),
};

// Double-click the same bar; the details modal must open and Close must dismiss.
const c2 = await barCenter();
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c2.x, y: c2.y, button: 'none' });
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: c2.x,
  y: c2.y,
  button: 'left',
  buttons: 1,
  clickCount: 1,
});
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: c2.x,
  y: c2.y,
  button: 'left',
  buttons: 0,
  clickCount: 1,
});
await send('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: c2.x,
  y: c2.y,
  button: 'left',
  buttons: 1,
  clickCount: 2,
});
await send('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: c2.x,
  y: c2.y,
  button: 'left',
  buttons: 0,
  clickCount: 2,
});
await sleep(700);
const dialogTitle = await evaluate(
  `document.querySelector('[role="dialog"] h3')?.textContent?.trim() ?? null`
);
const dismissed = dialogTitle ? await clickByLabel('Close') : false;
await sleep(400);
const dialogClosed = await evaluate(`!document.querySelector('[role="dialog"]')`);
const dragWorks = moveAfter.start !== moveBefore.start && moveAfter.pinned >= 1;
const dblclickWorks = Boolean(dialogTitle) && dialogClosed;

const screenshot = 'C:\\ghannt\\gantt-verify.png';

console.log(
  JSON.stringify(
    {
      chrome: version.Browser,
      pageTitle,
      appMounted,
      openedGantt,
      dayView,
      criticalPathToggle: {
        buttonLabelBefore: toggledCritical,
        ariaPressedAfterFirstClick: toggleLabelAfter,
        off: { redBars: criticalOff.redBars, slateBars: criticalOff.slateBars },
        backOn: { redBars: criticalBackOn.redBars, slateBars: criticalBackOn.slateBars },
      },
      weekView: { bars: weekView.bars, headerTicks: weekView.headerTicks, svgWidth: weekView.svgWidth, charts: weekView.charts, errorBanner: weekView.errorBanner },
      monthView: { bars: monthView.bars, headerTicks: monthView.headerTicks, svgWidth: monthView.svgWidth, charts: monthView.charts, errorBanner: monthView.errorBanner },
      interactions: {
        dragWorks,
        moveBefore,
        moveAfter,
        dblclickWorks,
        dialogTitle,
        dismissed,
        dialogClosed,
      },
      screenshot,
      consoleErrors,
      pageExceptions,
    },
    null,
    2
  )
);

await cleanup();
process.exit(0);
