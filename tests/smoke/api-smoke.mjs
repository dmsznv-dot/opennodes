// BUG-09 smoke: drives a running API over HTTP and prints a PASS/FAIL/FINDING log.
// Start a fresh API first (pnpm --filter @localflow/api... build), e.g.
//   PORT=4100 HOST=127.0.0.1 node apps/api/dist/index.js
// Usage: node tests/smoke/api-smoke.mjs <phase> [baseUrl]   phase = run | after-restart
// Run `run`, restart the API, then run `after-restart`. Report: tests/smoke/BUG-09-report.md
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const phase = process.argv[2] ?? 'run';
const BASE = process.argv[3] ?? 'http://127.0.0.1:4100';
const STATE = join(tmpdir(), 'opennodes-api-smoke-state.json');

async function call(method, path, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const log = [];
function check(name, ok, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`;
  log.push(line);
  console.log(line);
}
function finding(name, detail) {
  const line = `FIND  ${name}  — ${detail}`;
  log.push(line);
  console.log(line);
}

const node = (id, type, label, config = {}) => ({
  id, type, data: { label, config },
  inputs: type.startsWith('trigger.') ? [] : [{ id: 'main', name: 'In', type: 'any', direction: 'input' }],
  outputs: [{ id: 'main', name: 'Out', type: 'any', direction: 'output' }],
  position: { x: 0, y: 0 },
});
const edge = (id, source, target) => ({
  id, source, target, sourceHandle: 'main', targetHandle: 'main',
});

if (phase === 'run') {
  // 1. Health
  const live = await call('GET', '/health/live');
  check('health/live', live.status === 200);
  const ready = await call('GET', '/health/ready');
  check('health/ready responds', ready.status === 200, JSON.stringify(ready.body.checks));

  // 2. First run / setup
  const st = await call('GET', '/api/v1/setup/status');
  check('setup/status before bootstrap = false', st.body.bootstrapped === false);
  const weak = await call('POST', '/api/v1/setup', {
    body: { email: 'bad', password: 'x', workspaceName: 'Моя команда' },
  });
  check('setup rejects weak input with 4xx', weak.status >= 400 && weak.status < 500,
    `${weak.status} ${JSON.stringify(weak.body).slice(0, 160)}`);
  const setup = await call('POST', '/api/v1/setup', {
    body: { email: 'owner@example.test', password: 'StrongPassword123!', fullName: 'Owner', workspaceName: 'Моя команда' },
  });
  check('setup creates owner', setup.status === 201, `${setup.status}`);
  const ownerToken = setup.body.token;
  const wsId = setup.body.workspaceId;
  const again = await call('POST', '/api/v1/setup', {
    body: { email: 'evil@example.test', password: 'StrongPassword123!', workspaceName: 'X' },
  });
  check('repeat setup blocked (409)', again.status === 409, `${again.status}`);
  if ('slug' in setup.body || 'workspaceSlug' in setup.body) {
    check('workspace slug for «Моя команда»', true, JSON.stringify(setup.body));
  } else {
    finding('setup response has no slug', `keys: ${Object.keys(setup.body).join(', ')}`);
  }

  // 3. Login
  const badLogin = await call('POST', '/api/v1/auth/login', {
    body: { email: 'owner@example.test', password: 'wrong' },
  });
  check('login wrong password → 401', badLogin.status === 401);
  const login = await call('POST', '/api/v1/auth/login', {
    body: { email: 'OWNER@example.test', password: 'StrongPassword123!' },
  });
  check('login ok (case-insensitive email)', login.status === 200);
  const token = login.body.token ?? ownerToken;

  // 4. 401s
  const noAuth = await call('GET', `/api/v1/workspaces/${wsId}/workflows`);
  check('no token → 401', noAuth.status === 401);
  const badTok = await call('GET', `/api/v1/workspaces/${wsId}/workflows`, { token: 'nope' });
  check('bad token → 401', badTok.status === 401);
  const otherWs = await call('GET', `/api/v1/workspaces/ws_other/workflows`, { token });
  check('foreign workspace → 403', otherWs.status === 403, `${otherWs.status}`);

  // 5. Credentials
  const cred = await call('POST', `/api/v1/workspaces/${wsId}/credentials`, {
    token, body: { name: 'TG test', type: 'telegram', secrets: { botToken: '123456:not-a-real-secret-ABC' } },
  });
  check('create credential', cred.status === 201, `${cred.status}`);
  const credList = await call('GET', `/api/v1/workspaces/${wsId}/credentials`, { token });
  const leaked = JSON.stringify(credList.body).includes('not-a-real-secret');
  check('credential list never returns secret', !leaked, JSON.stringify(credList.body.credentials?.[0] ?? {}));
  const credBad = await call('POST', `/api/v1/workspaces/${wsId}/credentials`, { token, body: {} });
  if (credBad.status === 201) finding('credential without name/type accepted', JSON.stringify(credBad.body));
  else check('credential without name/type rejected', true, `${credBad.status}`);

  // 6. Workflow: manual trigger → map → telegram send (the connector)
  const wf = await call('POST', `/api/v1/workspaces/${wsId}/workflows`, {
    token,
    body: {
      name: 'Smoke: Telegram send',
      nodes: [
        node('t1', 'trigger.manual', 'Start'),
        node('m1', 'primitive.map', 'Shape', { transform: { text: 'Hi {{ $trigger.name }}', zero: 0, off: false } }),
        node('tg1', 'core.telegramBot', 'Send to Telegram', {
          operation: 'sendMessage', chatId: '1', text: '{{ $nodes.m1.output.text }}',
        }),
      ],
      edges: [edge('e1', 't1', 'm1'), edge('e2', 'm1', 'tg1')],
    },
  });
  check('create workflow', wf.status === 201, `${wf.status}`);
  const wfId = wf.body.id;

  const getOne = await call('GET', `/api/v1/workflows/${wfId}`, { token });
  if (getOne.status !== 200) finding('no GET /workflows/:id', `${getOne.status} ${getOne.body.code ?? ''}`);

  const execDraft = await call('POST', `/api/v1/workflows/${wfId}/execute`, { token, body: {} });
  check('execute unpublished → 400', execDraft.status === 400, `${execDraft.status}`);

  // cycle on publish
  const cyc = await call('PUT', `/api/v1/workflows/${wfId}/draft`, {
    token, body: { nodes: wf.body.draft.nodes, edges: [...wf.body.draft.edges, edge('e3', 'tg1', 'm1')] },
  });
  const pubCyc = await call('POST', `/api/v1/workflows/${wfId}/publish`, { token });
  check('publish with cycle → 422', pubCyc.status === 422, `${pubCyc.status} ${pubCyc.body.code ?? ''}`);
  await call('PUT', `/api/v1/workflows/${wfId}/draft`, {
    token, body: { nodes: wf.body.draft.nodes, edges: wf.body.draft.edges },
  });
  void cyc;

  const pub = await call('POST', `/api/v1/workflows/${wfId}/publish`, { token });
  check('publish v1', pub.status === 201, `${pub.status} checksum=${pub.body.checksum?.slice(0, 12)}`);

  const run = await call('POST', `/api/v1/workflows/${wfId}/execute`, {
    token, body: { payload: { name: 'Аня' }, wait: true },
  });
  check('execute returns 200', run.status === 200, `${run.status}`);
  const exec = run.body.execution ?? {};
  const steps = run.body.steps ?? [];
  const tg = steps.find((s) => s.nodeId === 'tg1');
  const map = steps.find((s) => s.nodeId === 'm1');
  check('map step keeps types (0/false) and resolves expression',
    map?.outputPayload?.zero === 0 && map?.outputPayload?.off === false && map?.outputPayload?.text === 'Hi Аня',
    JSON.stringify(map?.outputPayload));
  if (exec.status === 'SUCCEEDED' && tg?.status === 'SUCCEEDED') {
    finding('BUG-01 (backend): Telegram step SUCCEEDED without any connector',
      `output=${JSON.stringify(tg.outputPayload)} — no network call, no credential, chatId 1`);
  } else {
    check('Telegram step without connector is not reported as success', true,
      `${exec.status} / ${tg?.status} ${tg?.errorMessage ?? ''}`);
  }

  // 7. Inspect
  const execGet = await call('GET', `/api/v1/executions/${exec.id}`, { token });
  check('GET execution', execGet.status === 200, `${execGet.status}`);
  const hist = await call('GET', `/api/v1/workflows/${wfId}/executions`, { token });
  if (hist.status !== 200) finding('no run history endpoint', `GET /workflows/:id/executions → ${hist.status}`);

  // 8. RBAC: second user, viewer
  const intruder = await call('POST', '/api/v1/auth/login', {
    body: { email: 'evil@example.test', password: 'StrongPassword123!' },
  });
  check('blocked setup did not create a user', intruder.status === 401);

  // 9. Webhook
  const wfHook = await call('POST', `/api/v1/workspaces/${wsId}/workflows`, {
    token,
    body: {
      name: 'Smoke: webhook', webhookSecret: 'whsec_test',
      nodes: [node('w1', 'trigger.webhook', 'Hook'), node('m2', 'primitive.map', 'Echo', { transform: { got: '{{ $trigger.a }}' } })],
      edges: [edge('e1', 'w1', 'm2')],
    },
  });
  await call('POST', `/api/v1/workflows/${wfHook.body.id}/publish`, { token });
  const rawBody = '{"a": 1}'; // note the space: what a real sender signs
  const sig = createHmac('sha256', 'whsec_test').update(rawBody).digest('hex');
  const hookOk = await call('POST', `/api/v1/webhooks/${wfHook.body.id}`, {
    raw: rawBody, headers: { 'x-hub-signature-256': `sha256=${sig}`, 'x-idempotency-key': 'k1' },
  });
  if (hookOk.status === 202) check('webhook with valid HMAC over raw bytes', true);
  else finding('webhook HMAC is checked against re-serialized JSON, not raw body',
    `valid signature of '${rawBody}' → ${hookOk.status} ${hookOk.body.code ?? ''}`);
  const compact = '{"a":1}';
  const sig2 = createHmac('sha256', 'whsec_test').update(compact).digest('hex');
  const hookC = await call('POST', `/api/v1/webhooks/${wfHook.body.id}`, {
    raw: compact, headers: { 'x-hub-signature-256': `sha256=${sig2}`, 'x-idempotency-key': 'k2' },
  });
  check('webhook with compact JSON + valid HMAC → 202', hookC.status === 202, `${hookC.status}`);
  const hookBad = await call('POST', `/api/v1/webhooks/${wfHook.body.id}`, {
    raw: compact, headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
  });
  check('webhook bad HMAC → 401', hookBad.status === 401);
  const dup = await call('POST', `/api/v1/webhooks/${wfHook.body.id}`, {
    raw: compact, headers: { 'x-hub-signature-256': `sha256=${sig2}`, 'x-idempotency-key': 'k2' },
  });
  check('webhook idempotency dedup', dup.body.deduplicated === true && dup.body.executionId === hookC.body.executionId);

  // 10. IDOR on SSE events: a user outside the workspace
  const strangerReg = await call('POST', '/api/v1/setup', {
    body: { email: 'x@example.test', password: 'StrongPassword123!', workspaceName: 'X' },
  });
  void strangerReg; // blocked (already bootstrapped) — no way to make a 2nd user via API
  finding('no API to invite users / roles', 'viewer/editor RBAC cannot be exercised end-to-end over HTTP');

  // 11. cancel a finished run
  const cancel = await call('POST', `/api/v1/executions/${exec.id}/cancel`, { token });
  if (cancel.body.execution?.status === 'CANCELLED' && exec.status === 'SUCCEEDED')
    finding('cancel overwrites a finished run', `${exec.status} → CANCELLED`);

  // 12. malformed body must not wipe the draft
  const boom = await call('PUT', `/api/v1/workflows/${wfId}/draft`, { token, raw: 'not json' });
  const wiped = boom.status === 200 && boom.body.draft?.nodes?.length === 0;
  if (wiped) finding('PUT /draft with non-JSON body wipes the draft', `200, draft.nodes = []`);
  else check('malformed draft body rejected', boom.status === 400, `${boom.status}`);

  writeFileSync(STATE, JSON.stringify({ token, wsId, wfId, execId: exec.id, email: 'owner@example.test' }));
} else {
  if (!existsSync(STATE)) throw new Error('run phase first');
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const st = await call('GET', '/api/v1/setup/status');
  check('after restart: still bootstrapped', st.body.bootstrapped === true, JSON.stringify(st.body));
  const login = await call('POST', '/api/v1/auth/login', {
    body: { email: s.email, password: 'StrongPassword123!' },
  });
  check('after restart: owner can log in', login.status === 200, `${login.status}`);
  const oldTok = await call('GET', `/api/v1/workspaces/${s.wsId}/workflows`, { token: s.token });
  check('after restart: old session valid', oldTok.status === 200, `${oldTok.status}`);
  const ex = await call('GET', `/api/v1/executions/${s.execId}`, { token: s.token });
  check('after restart: execution history kept', ex.status === 200, `${ex.status}`);
  const hijack = await call('POST', '/api/v1/setup', {
    body: { email: 'attacker@example.test', password: 'StrongPassword123!', workspaceName: 'Pwn' },
  });
  check('after restart: setup stays locked', hijack.status === 409,
    `${hijack.status} — ${hijack.status === 201 ? 'anyone can re-bootstrap and become OWNER' : ''}`);
}

process.exitCode = log.some((l) => l.startsWith('FAIL')) ? 1 : 0;
