#!/usr/bin/env node
/**
 * End-to-end smoke check of a running installation (docker compose up, or pnpm start:local),
 * through the web app exactly as a browser uses it: sign in with the session cookie,
 * create and publish an automation (CSRF header), run it through the queue and the worker,
 * and start it from its webhook.
 *
 *   node scripts/smoke.mjs                 # http://localhost:3000
 *   SMOKE_URL=http://localhost:3100 node scripts/smoke.mjs
 *
 * On an installation that is already set up, pass the owner's SMOKE_EMAIL / SMOKE_PASSWORD.
 */

const BASE = (process.env.SMOKE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL ?? 'smoke@opennodes.local';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Smoke-Check-12345!';
const READY_TIMEOUT_MS = Number(process.env.SMOKE_READY_TIMEOUT_MS ?? 180_000);

const cookies = {};
let step = 0;

function ok(message) {
  console.log(`  ✓ ${++step}. ${message}`);
}
function fail(message, detail) {
  console.error(`  ✗ ${++step}. ${message}`);
  if (detail !== undefined)
    console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(1);
}

async function call(method, path, body, { csrf = true } = {}) {
  const headers = {
    cookie: Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrf && method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(cookies.on_csrf ?? '');
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (/max-age=0/i.test(c)) delete cookies[name];
    else cookies[name] = value;
  }
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON (the page, config.js) */
  }
  return { status: res.status, data };
}

const port = (direction) => [
  { id: 'main', name: direction, type: 'any', direction, required: false },
];
const GRAPH = {
  nodes: [
    {
      id: 'hook',
      type: 'trigger.webhook',
      data: { label: 'Hook', config: {} },
      inputs: [],
      outputs: port('output'),
    },
    {
      id: 'echo',
      type: 'primitive.map',
      data: { label: 'Echo', config: { transform: { got: '{{ $trigger.ping }}' } } },
      inputs: port('input'),
      outputs: port('output'),
    },
  ],
  edges: [{ id: 'e1', source: 'hook', sourceHandle: 'main', target: 'echo', targetHandle: 'main' }],
};

async function waitReady() {
  const until = Date.now() + READY_TIMEOUT_MS;
  let last;
  while (Date.now() < until) {
    try {
      last = await call('GET', '/health/ready');
      if (last.status === 200) return last.data;
    } catch (err) {
      last = { status: 0, data: String(err.cause?.code ?? err.message) };
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  fail(`not ready after ${READY_TIMEOUT_MS / 1000}s at ${BASE}`, last);
}

async function waitRun(id) {
  for (let i = 0; i < 60; i++) {
    const res = await call('GET', `/api/v1/executions/${id}`);
    const status = res.data?.execution?.status ?? res.data?.status;
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status)) return res.data;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  fail(`run ${id} did not finish in 60s`);
}

console.log(`OpenNodes smoke check → ${BASE}`);

const ready = await waitReady();
ok(`API and database are ready (bootstrapped: ${ready.bootstrapped})`);

const page = await call('GET', '/');
const config = await call('GET', '/config.js');
if (page.status !== 200 || !String(config.data).includes('/api/v1'))
  fail('web app does not serve the editor', config);
ok('web app serves the editor in live mode');

const status = await call('GET', '/api/v1/setup/status');
const auth = status.data.bootstrapped
  ? await call('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD }, { csrf: false })
  : await call(
      'POST',
      '/api/v1/setup',
      { email: EMAIL, password: PASSWORD, workspaceName: 'Smoke' },
      { csrf: false }
    );
if (auth.status >= 300)
  fail('sign-in failed (set SMOKE_EMAIL / SMOKE_PASSWORD on a set-up install)', auth.data);
if (!cookies.on_session || !cookies.on_csrf)
  fail('sign-in did not set the session and CSRF cookies', Object.keys(cookies));
ok('signed in: HttpOnly session cookie and CSRF cookie are set');

const me = await call('GET', '/api/v1/me');
if (me.status !== 200) fail('the session cookie is not accepted', me.data);
const workspaceId = me.data.workspaces?.[0]?.id ?? me.data.workspaceId ?? auth.data.workspaceId;
if (!workspaceId) fail('no workspace in the profile', me.data);
ok(`session cookie works (${me.data.user?.email ?? EMAIL})`);

const forged = await call(
  'POST',
  `/api/v1/workspaces/${workspaceId}/workflows`,
  { name: 'x', ...GRAPH },
  { csrf: false }
);
if (forged.status !== 403)
  fail(`a change without the CSRF header must be refused, got HTTP ${forged.status}`, forged.data);
ok('a change without the CSRF header is refused (403)');

const created = await call('POST', `/api/v1/workspaces/${workspaceId}/workflows`, {
  name: `Smoke ${new Date().toISOString()}`,
  ...GRAPH,
});
if (created.status !== 201) fail('could not create an automation', created.data);
const wf = created.data;
const published = await call('POST', `/api/v1/workflows/${wf.id}/publish`);
if (published.status >= 300) fail('could not publish', published.data);
const active = await call('PUT', `/api/v1/workflows/${wf.id}/active`, { active: true });
if (active.status >= 300) fail('could not turn the automation on', active.data);
ok('automation created, published and turned on');

const run = await call('POST', `/api/v1/workflows/${wf.id}/execute`, {
  payload: { ping: 'pong' },
  wait: true,
  waitTimeoutMs: 60_000,
});
const echo = run.data?.steps?.find((s) => s.nodeId === 'echo');
if (run.data?.execution?.status !== 'SUCCEEDED' || echo?.outputPayload?.got !== 'pong') {
  fail('manual run did not succeed through the queue and worker', run.data);
}
ok('manual run: queued, executed by the worker, output is right');

const hook = await fetch(`${BASE}/api/v1/webhooks/${wf.id}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ping: 'hook' }),
});
const hookBody = await hook.json().catch(() => null);
if (hook.status !== 202 || !hookBody?.executionId)
  fail(`webhook did not start a run (HTTP ${hook.status})`, hookBody);
const done = await waitRun(hookBody.executionId);
const doneStatus = done.execution?.status ?? done.status;
if (doneStatus !== 'SUCCEEDED') fail('webhook run failed', done);
ok('webhook run succeeded');

await call('DELETE', `/api/v1/workflows/${wf.id}`);
const out = await call('POST', '/api/v1/auth/logout');
const after = await call('GET', '/api/v1/me');
if (out.status !== 200 || after.status !== 401)
  fail('sign-out did not end the session', { out: out.status, after: after.status });
ok('cleaned up and signed out');

console.log('Smoke check passed.');
