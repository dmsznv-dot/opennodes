/**
 * Live mode: the same editor, backed by an OpenNodes server instead of the in-browser
 * simulation. It is on when the page is served by the OpenNodes web server, which
 * defines `window.OPENNODES.api` in /config.js; on GitHub Pages it stays off.
 *
 * The editor keeps working on its in-memory `store`; this module loads the store from
 * the API, saves drafts back (debounced), and maps server runs to the editor's run
 * shape. Secrets never reach the store: connections are created on the server and only
 * their names come back.
 */
import { ACTIONS, SERVICES, TEMPLATES } from './catalog.js';
import { nodeTitle, stepNumbers, stepOrder, exampleContext } from './engine.js';
import { t, formatDateTime } from './i18n.js';

export const API = (typeof window !== 'undefined' && window.OPENNODES?.api) || null;
export const isLive = Boolean(API);

const TOKEN_KEY = 'opennodes.session';

export const session = {
  token: readToken(),
  user: null,
  workspace: null,
};

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token) {
  session.token = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts until the tab closes */
  }
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.code = body?.code;
    this.details = body?.details;
  }
}

/** Calls the API; a 401 on a signed-in call ends the session. */
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(session.token && { authorization: `Bearer ${session.token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { code: 'ERR_OFFLINE', message: t('auth.offline') });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && session.token && !path.startsWith('/auth/')) {
      writeToken(null);
      window.dispatchEvent(new Event('opennodes:signed-out'));
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

// ── Sign in ───────────────────────────────────────────────────────────────────

export const setupStatus = () => api('GET', '/setup/status');

export async function signIn(email, password) {
  const res = await api('POST', '/auth/login', { email, password });
  writeToken(res.token);
}

export async function createOwner(email, password, workspaceName) {
  const res = await api('POST', '/setup', { email, password, workspaceName });
  writeToken(res.token);
}

export async function signOut() {
  try {
    await api('POST', '/auth/logout');
  } finally {
    writeToken(null);
  }
}

// ── Editor graph ⇄ engine graph ───────────────────────────────────────────────

/** Each runnable editor action has its own node type, so the mapping is reversible. */
const TYPE_TO_ACTION = Object.fromEntries(
  Object.entries(ACTIONS)
    .filter(([, a]) => a.type)
    .map(([id, a]) => [a.type, id])
);

const port = (id, direction) => ({ id, name: id, type: 'any', direction, required: false });

export function toEngineGraph(a) {
  return {
    nodes: a.nodes.map((n) => {
      const action = ACTIONS[n.action];
      return {
        id: n.id,
        type: action?.type ?? n.action,
        data: {
          // The engine needs a label; the action id stands for "the default title".
          label: n.label || n.action,
          config: n.config ?? {},
          ...(n.connectionId && { credentialId: n.connectionId }),
          ...(n.disabled && { disabled: true }),
        },
        inputs: action?.kind === 'trigger' ? [] : [port('main', 'input')],
        outputs: [port('main', 'output')],
      };
    }),
    edges: a.edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: 'main',
      target: e.target,
      targetHandle: 'main',
    })),
  };
}

export function fromEngineGraph(nodes = [], edges = []) {
  return {
    nodes: nodes.map((n) => {
      const action = TYPE_TO_ACTION[n.type] ?? n.type;
      return {
        id: n.id,
        action,
        label: n.data?.label && n.data.label !== action ? n.data.label : '',
        config: n.data?.config ?? {},
        connectionId: n.data?.credentialId ?? null,
        disabled: Boolean(n.data?.disabled),
      };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

function toAutomation(wf) {
  const draft = fromEngineGraph(wf.draft.nodes, wf.draft.edges);
  const live = wf.versions.find((v) => v.version === wf.activeVersion);
  const published = live ? fromEngineGraph(live.nodes, live.edges) : null;
  return {
    id: wf.id,
    name: wf.name,
    templateId: null,
    status: wf.isActive ? 'active' : wf.activeVersion ? 'paused' : 'draft',
    dirty: Boolean(published) && JSON.stringify(published) !== JSON.stringify(draft),
    publishedVersion: wf.activeVersion ?? 0,
    published,
    nodes: draft.nodes,
    edges: draft.edges,
    nodeErrors: {},
    createdAt: Date.parse(wf.createdAt),
    lastRunAt: null,
    lastRunResult: null,
  };
}

// ── Connections ───────────────────────────────────────────────────────────────

const TYPE_TO_SERVICE = {
  telegram: 'telegram',
  'core.telegramBot': 'telegram',
  openai: 'ai',
  'ai.openai': 'ai',
  'openai-compatible': 'ai',
  ollama: 'ollama',
  smtp: 'email',
  postgres: 'postgres',
  mcp: 'mcp',
};

function toConnection(c) {
  return {
    id: c.id,
    service: TYPE_TO_SERVICE[c.type] ?? c.type,
    name: c.name,
    mode: 'live',
    type: c.type,
    createdAt: Date.parse(c.createdAt),
  };
}

/** What the connect form asks for, per service. Values go to the server only. */
export const CONNECT_FIELDS = {
  telegram: [{ key: 'botToken', label: 'conn.fieldBotToken', secret: true, required: true }],
  ai: [
    { key: 'apiKey', label: 'conn.fieldApiKey', secret: true },
    {
      key: 'baseUrl',
      label: 'conn.fieldBaseUrl',
      help: 'conn.fieldBaseUrlHint',
      placeholder: 'http://localhost:1234/v1',
    },
    { key: 'defaultModel', label: 'conn.fieldModel', placeholder: 'gpt-4o-mini' },
  ],
  mcp: [
    {
      key: 'url',
      label: 'conn.fieldMcpUrl',
      help: 'conn.fieldMcpUrlHint',
      placeholder: 'https://example.com/mcp',
      secret: true,
      required: true,
    },
    { key: 'token', label: 'conn.fieldMcpToken', secret: true },
  ],
};

/** Saves a connection on the server and checks it. Returns the store entry. */
export async function createConnection(serviceId, name, values) {
  let type = serviceId;
  let secrets = {};
  if (serviceId === 'telegram') {
    secrets = { botToken: values.botToken.trim() };
  } else if (serviceId === 'mcp') {
    secrets = Object.fromEntries(
      Object.entries({ url: values.url?.trim(), token: values.token?.trim() }).filter(([, v]) => v)
    );
  } else if (serviceId === 'ai') {
    const baseUrl = values.baseUrl?.trim();
    type = baseUrl ? 'openai-compatible' : 'openai';
    secrets = Object.fromEntries(
      Object.entries({
        apiKey: values.apiKey?.trim(),
        baseUrl,
        defaultModel: values.defaultModel?.trim(),
      }).filter(([, v]) => v)
    );
  }
  const created = await api('POST', `/workspaces/${session.workspace.id}/credentials`, {
    name,
    type,
    secrets,
  });
  return toConnection(created);
}

export const checkConnection = (id) =>
  api('GET', `/workspaces/${session.workspace.id}/credentials/${id}/check`);

// ── Runs ──────────────────────────────────────────────────────────────────────

function summarize(output) {
  if (output == null) return '';
  if (typeof output !== 'object') return String(output).slice(0, 160);
  for (const key of ['text', 'category', 'titles', 'messageId', 'status']) {
    if (output[key] !== undefined && output[key] !== null && output[key] !== '') {
      return String(output[key]).slice(0, 160);
    }
  }
  const json = JSON.stringify(output);
  return json.length > 160 ? `${json.slice(0, 157)}…` : json;
}

/** What started the run, in words: "Schedule · 2 Nov, 09:00", "Anna: hello". */
function triggerSummary(type, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (type === 'trigger.cron') {
    const at = Date.parse(p.scheduledAt ?? p.firedAt);
    return t('run.sum.cron', { when: Number.isFinite(at) ? formatDateTime(at) : '—' });
  }
  if (type === 'trigger.telegram') return `${p.fromName || p.username || '—'}: «${p.text ?? ''}»`;
  if (type === 'trigger.webhook') return t('run.sum.webhook', { n: Object.keys(p).length });
  return p.text ? `«${String(p.text).slice(0, 140)}»` : t('run.sum.manual');
}

function toStep(s, a, nums) {
  const node = a?.nodes.find((n) => n.id === s.nodeId);
  const out = s.outputPayload;
  let status;
  let summary = summarize(out);
  if (s.status === 'SUCCEEDED') {
    // A condition that did not hold, or an RSS step with nothing new, stops the flow below.
    const stopped =
      (s.nodeType === 'logic.condition' && out?.passed === false) || out?.stopped === true;
    status = stopped ? 'stopped' : 'ok';
    if (s.nodeType === 'core.rss' && out?.stopped) summary = t('run.noNewItems');
    if (s.nodeType?.startsWith('trigger.')) summary = triggerSummary(s.nodeType, out?.payload);
  } else if (s.status === 'FAILED') status = 'failed';
  else if (s.status === 'SKIPPED') status = out?.disabled ? 'skipped' : 'notReached';
  else if (s.status === 'PENDING' && out?.waitingUntil) {
    status = 'waiting';
    summary = t('run.waiting', { when: formatDateTime(Date.parse(out.waitingUntil)) });
  } else if (s.status === 'RUNNING' || s.status === 'PENDING') {
    status = 'running';
    summary = t('run.running');
  } else status = 'notReached';
  return {
    nodeId: s.nodeId,
    n: nums.get(s.nodeId) ?? '?',
    title: node ? nodeTitle(node) : s.nodeName || s.nodeId,
    status,
    summary,
    input: s.inputPayload ?? undefined,
    output: out ?? undefined,
    ...(status === 'failed' && {
      error: { key: 'err.server', params: { message: s.errorMessage || t('common.error') } },
    }),
  };
}

const RESULT = {
  SUCCEEDED: 'ok',
  FAILED: 'failed',
  CANCELLED: 'failed',
  QUEUED: 'running',
  RUNNING: 'running',
  WAITING: 'waiting',
};

/** A server run (or test result) in the editor's run shape. */
export function toRun(exec, automations, kind = exec.triggerType) {
  const a = automations.find((x) => x.id === exec.workflowId);
  const nums = a ? stepNumbers(a) : new Map();
  const steps = (exec.steps ?? []).map((s) => toStep(s, a, nums));
  let result = RESULT[exec.status] ?? 'running';
  if (result === 'ok' && steps.some((s) => s.status === 'stopped')) result = 'stopped';
  if (a && ['ok', 'stopped', 'failed'].includes(result)) {
    // Steps the run never got to, so the card lists the whole scenario.
    const seen = new Set(steps.map((s) => s.nodeId));
    for (const id of stepOrder(a)) {
      if (seen.has(id)) continue;
      const node = a.nodes.find((n) => n.id === id);
      steps.push({ nodeId: id, n: nums.get(id), title: nodeTitle(node), status: 'notReached' });
    }
    steps.sort((x, y) => (Number(x.n) || 0) - (Number(y.n) || 0));
  }
  const failed = steps.find((s) => s.status === 'failed');
  return {
    id: exec.id,
    automationId: exec.workflowId,
    automationName: a?.name ?? '—',
    at: Date.parse(exec.createdAt ?? exec.startedAt) || Date.now(),
    kind,
    live: true,
    status: exec.status,
    result,
    failedNodeId: failed?.nodeId ?? exec.errorNodeId ?? null,
    ...(result === 'failed' &&
      !failed &&
      exec.errorMessage && {
        error: { key: 'err.server', params: { message: exec.errorMessage } },
      }),
    steps,
  };
}

/** Example `$trigger` data for a test, like the run the trigger would start. */
function samplePayload(a) {
  const trigger = a.nodes.find((n) => ACTIONS[n.action]?.kind === 'trigger');
  if (!trigger) return {};
  const cfg = trigger.config ?? {};
  if (trigger.action === 'manual.run') return { text: cfg.sampleText ?? '' };
  if (trigger.action === 'schedule.every') {
    const now = new Date().toISOString();
    return { firedAt: now, scheduledAt: now, timezone: cfg.timezone || 'UTC' };
  }
  return exampleContext(a).trigger;
}

/** "Test": runs the scenario as it is in the editor, with real steps, unrecorded. */
export async function testRun(a, untilNodeId) {
  const res = await api('POST', `/workflows/${a.id}/test-run`, {
    ...toEngineGraph(a),
    payload: samplePayload(a),
    ...(untilNodeId && { untilNodeId }),
  });
  return toRun(
    {
      id: `test_${Date.now().toString(36)}`,
      workflowId: a.id,
      createdAt: new Date().toISOString(),
      status: res.execution.status,
      errorMessage: res.execution.errorMessage,
      errorNodeId: res.execution.errorNodeId,
      steps: res.steps,
    },
    [a],
    'test'
  );
}

/** "Run now" for a manual automation: a real, recorded run of the live version. */
export async function runNow(a) {
  const res = await api('POST', `/workflows/${a.id}/execute`, {
    payload: samplePayload(a),
    wait: true,
    waitTimeoutMs: 30_000,
  });
  return toRun({ ...res.execution, steps: res.steps }, [a]);
}

// ── Loading and saving ────────────────────────────────────────────────────────

/** Editor actions the server cannot run are shown as "planned" instead. */
function applyCatalog(catalog) {
  const runnable = new Set(catalog.nodeTypes);
  for (const action of Object.values(ACTIONS)) {
    if (action.type && !runnable.has(action.type)) action.planned = true;
  }
  for (const [id, service] of Object.entries(SERVICES)) {
    const actions = Object.values(ACTIONS).filter((x) => x.service === id);
    if (actions.length && actions.every((x) => x.planned)) service.planned = true;
  }
  // A template with such a step is shown as "planned" (with the services it waits for).
  for (const tpl of TEMPLATES) {
    const waiting = tpl.nodes
      .map((n) => ACTIONS[n.action])
      .filter((x) => x?.planned)
      .map((x) => x.service);
    if (waiting.length) tpl.planned = [...new Set([...(tpl.planned ?? []), ...waiting])];
  }
}

/** Each automation's "last run" line, from the newest run in the store. */
function applyLastRuns(store) {
  for (const a of store.automations) {
    const last = store.runs.find((r) => r.automationId === a.id && r.kind !== 'test');
    if (!last) continue;
    a.lastRunAt = last.at;
    a.lastRunResult =
      last.result === 'failed'
        ? `failed:${last.steps.find((s) => s.status === 'failed')?.n ?? '?'}`
        : last.result;
  }
}

const synced = new Map(); // automation id → JSON of what the server has
const syncedConnections = new Set();

const snapshot = (a) => JSON.stringify({ name: a.name, ...toEngineGraph(a) });

/** Fills the store from the server. Throws ApiError (401 → sign in again). */
export async function loadWorkspace(store) {
  const me = await api('GET', '/me');
  session.user = me.user;
  session.workspace = me.workspaces[0];
  const ws = session.workspace.id;
  const [catalog, wfs, creds, runs] = await Promise.all([
    api('GET', '/catalog'),
    api('GET', `/workspaces/${ws}/workflows`),
    api('GET', `/workspaces/${ws}/credentials`),
    api('GET', `/workspaces/${ws}/executions?limit=50`),
  ]);
  applyCatalog(catalog);
  store.automations = wfs.workflows.map(toAutomation).sort((x, y) => y.createdAt - x.createdAt);
  store.connections = creds.credentials.map(toConnection);
  store.runs = runs.executions.map((e) => toRun(e, store.automations));
  applyLastRuns(store);
  synced.clear();
  for (const a of store.automations) synced.set(a.id, snapshot(a));
  syncedConnections.clear();
  for (const c of store.connections) syncedConnections.add(c.id);
}

/** Fresh run history from the server; tests from this session stay listed in the editor. */
export async function reloadRuns(store) {
  const res = await api('GET', `/workspaces/${session.workspace.id}/executions?limit=50`);
  const tests = store.runs.filter((r) => r.kind === 'test');
  store.runs = [...res.executions.map((e) => toRun(e, store.automations)), ...tests].sort(
    (x, y) => y.at - x.at
  );
  applyLastRuns(store);
}

/** Re-reads one automation after publish / on-off, keeping its run summary. */
export async function refreshAutomation(store, id) {
  const fresh = toAutomation(await api('GET', `/workflows/${id}`));
  const a = store.automations.find((x) => x.id === id);
  if (!a) return;
  Object.assign(a, { ...fresh, lastRunAt: a.lastRunAt, lastRunResult: a.lastRunResult });
  synced.set(id, snapshot(a));
}

let timer = null;
let chain = Promise.resolve();

/** Writes what changed in the store to the server: drafts, new and deleted items. */
async function syncNow(store, onError) {
  try {
    for (const a of store.automations) {
      const snap = snapshot(a);
      if (!synced.has(a.id)) {
        await api('POST', `/workspaces/${session.workspace.id}/workflows`, {
          id: a.id,
          name: a.name,
          ...toEngineGraph(a),
        });
      } else if (synced.get(a.id) !== snap) {
        await api('PUT', `/workflows/${a.id}/draft`, { name: a.name, ...toEngineGraph(a) });
      } else continue;
      synced.set(a.id, snap);
    }
    const ids = new Set(store.automations.map((a) => a.id));
    for (const id of [...synced.keys()]) {
      if (ids.has(id)) continue;
      await api('DELETE', `/workflows/${id}`);
      synced.delete(id);
    }
    const connIds = new Set(store.connections.map((c) => c.id));
    for (const id of [...syncedConnections]) {
      if (connIds.has(id)) continue;
      await api('DELETE', `/workspaces/${session.workspace.id}/credentials/${id}`);
      syncedConnections.delete(id);
    }
    for (const id of connIds) syncedConnections.add(id);
  } catch (err) {
    onError?.(err);
  }
}

export function scheduleSync(store, onError) {
  if (!session.workspace) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    chain = chain.then(() => syncNow(store, onError));
  }, 400);
}

/** Saves pending changes now (before publish / test, which read the server copy). */
export function flushSync(store, onError) {
  clearTimeout(timer);
  chain = chain.then(() => syncNow(store, onError));
  return chain;
}

export async function publish(store, a) {
  await flushSync(store);
  await api('POST', `/workflows/${a.id}/publish`);
  await refreshAutomation(store, a.id);
}

export async function setActive(store, a, active) {
  await api('PUT', `/workflows/${a.id}/active`, { active });
  await refreshAutomation(store, a.id);
}

/** Next run, last error and so on, for the editor's status line. */
export async function triggerStatus(a) {
  const res = await api('GET', `/workflows/${a.id}/triggers`);
  return res.triggers[0] ?? null;
}

export const webhookUrl = (a) => `${location.origin}${API}/webhooks/${a.id}`;
