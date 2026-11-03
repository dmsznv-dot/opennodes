/**
 * OpenNodes demo — graph model helpers, typed fields, readable data chips and the
 * in-browser *simulation*. Nothing here performs network requests: the public demo
 * never calls real connectors (see docs/README note and BUG-01 in the UX audit).
 */
import { ACTIONS, SERVICES } from './catalog.js';
import { L, t, getLocale } from './i18n.js';

// ── Graph validation (single trigger + Kahn cycle check) ────────────────────

export function validateDag(nodes, edges) {
  const triggers = nodes.filter((n) => ACTIONS[n.action]?.kind === 'trigger');
  if (triggers.length === 0)
    return { valid: false, code: 'ERR_MISSING_TRIGGER', messageKey: 'err.noTrigger' };
  if (triggers.length > 1)
    return { valid: false, code: 'ERR_MULTIPLE_TRIGGERS', messageKey: 'err.multiTrigger' };

  const inDegree = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!adj.has(e.source) || !inDegree.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    inDegree.set(e.target, inDegree.get(e.target) + 1);
  }
  const queue = [...inDegree].filter(([, d]) => d === 0).map(([id]) => id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of adj.get(id)) {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== nodes.length) {
    const cycle = nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);
    return { valid: false, code: 'ERR_CYCLIC_DEPENDENCY_DETECTED', messageKey: 'err.cycle', cycle };
  }
  return { valid: true, order };
}

/** Display order: trigger first, then breadth-first; stable even for invalid graphs. */
export function stepOrder(a) {
  const res = validateDag(a.nodes, a.edges);
  if (res.valid) {
    const trigger = a.nodes.find((n) => ACTIONS[n.action]?.kind === 'trigger');
    return [trigger.id, ...res.order.filter((id) => id !== trigger.id)];
  }
  return a.nodes.map((n) => n.id);
}

export function stepNumbers(a) {
  return new Map(stepOrder(a).map((id, i) => [id, i + 1]));
}

export function parentsOf(a, id) {
  return a.edges.filter((e) => e.target === id).map((e) => e.source);
}

export function ancestorsOf(a, id) {
  const seen = new Set();
  const queue = [id];
  while (queue.length) {
    for (const p of parentsOf(a, queue.shift())) {
      if (!seen.has(p)) {
        seen.add(p);
        queue.push(p);
      }
    }
  }
  return seen;
}

export function nodeTitle(node) {
  return node.label || L(ACTIONS[node.action]?.name) || node.id;
}

// ── Layout (automatic, top-to-bottom layers) ─────────────────────────────────

export const CARD_W = 296;
export const CARD_H = 104;
const GAP_X = 32;
const GAP_Y = 64;

export function layout(a, cardH = CARD_H) {
  const order = stepOrder(a);
  const layer = new Map();
  for (const id of order) {
    const parents = parentsOf(a, id).filter((p) => layer.has(p));
    layer.set(id, parents.length ? Math.max(...parents.map((p) => layer.get(p))) + 1 : 0);
  }
  const rows = [];
  for (const id of order) (rows[layer.get(id)] ??= []).push(id);
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const width = widest * CARD_W + (widest - 1) * GAP_X;
  const pos = new Map();
  rows.forEach((row, r) => {
    const rowW = row.length * CARD_W + (row.length - 1) * GAP_X;
    const x0 = (width - rowW) / 2;
    row.forEach((id, i) => pos.set(id, { x: x0 + i * (CARD_W + GAP_X), y: r * (cardH + GAP_Y) }));
  });
  return { pos, width, height: rows.length * (cardH + GAP_Y) };
}

// ── Typed fields (mirrors apps/web NodeConfigDrawerController.parseFieldInput) ─

const EXPRESSION_RE = /^\s*\{\{[\s\S]*\}\}\s*$/;

export function parseFieldInput(field, raw) {
  if (field.type === 'connections') {
    const ids = (Array.isArray(raw) ? raw : []).map(String).filter(Boolean);
    if (ids.length) return { ok: true, value: ids };
    return field.required ? { ok: false, code: 'required' } : { ok: true, omitted: true };
  }
  if (field.type === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' };
  }
  const isEmpty =
    raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
  if (isEmpty)
    return field.required ? { ok: false, code: 'required' } : { ok: true, omitted: true };
  if (typeof raw === 'string' && EXPRESSION_RE.test(raw)) return { ok: true, value: raw.trim() };

  switch (field.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, code: 'number' };
    }
    case 'boolean':
      return { ok: true, value: Boolean(raw) };
    case 'json':
      if (typeof raw !== 'string') return { ok: true, value: raw };
      try {
        return { ok: true, value: JSON.parse(raw) };
      } catch (err) {
        return { ok: false, code: 'json', reason: err.message };
      }
    case 'select':
      return !field.options || field.options.some((o) => o.value === String(raw))
        ? { ok: true, value: String(raw) }
        : { ok: false, code: 'select' };
    default:
      return { ok: true, value: String(raw) };
  }
}

export const FIELD_ERROR_TEXT = {
  required: { ru: 'Заполните это поле.', en: 'Fill in this field.' },
  number: { ru: 'Нужно число, например 10 или 0.5.', en: 'Enter a number, e.g. 10 or 0.5.' },
  json: { ru: 'Некорректный JSON: {reason}', en: 'Invalid JSON: {reason}' },
  select: { ru: 'Выберите вариант из списка.', en: 'Choose an option from the list.' },
  token: {
    ru: 'Не удалось распознать {token}. Вставьте данные кнопкой ниже.',
    en: 'Could not recognise {token}. Insert data with the buttons below.',
  },
};

export function fieldErrorText(code, params = {}) {
  return L(FIELD_ERROR_TEXT[code]).replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
}

// ── Readable data chips: {{ $nodes.ai_1.output.text }} ⇄ {Шаг 2: Ответ AI} ──────

const EXPR_GLOBAL = /\{\{\s*\$(trigger|nodes)\.(?:([\w-]+)\.output\.)?([\w]+)\s*\}\}/g;
const HUMAN_GLOBAL = /\{(?:Шаг|Step)\s+(\d+):\s*([^{}]+?)\}/g;

function triggerNode(a) {
  return a.nodes.find((n) => ACTIONS[n.action]?.kind === 'trigger');
}

function outputLabel(node, key, locale = getLocale()) {
  const out = ACTIONS[node.action]?.outputs?.find((o) => o.key === key);
  return out ? (out.label[locale] ?? out.label.en) : key;
}

export function humanToken(n, label) {
  return `{${getLocale() === 'ru' ? 'Шаг' : 'Step'} ${n}: ${label}}`;
}

export function toHuman(a, value) {
  if (typeof value !== 'string') return value;
  const nums = stepNumbers(a);
  return value.replace(EXPR_GLOBAL, (m, scope, nodeId, key) => {
    const node = scope === 'trigger' ? triggerNode(a) : a.nodes.find((n) => n.id === nodeId);
    if (!node || !nums.has(node.id)) return m;
    return humanToken(nums.get(node.id), outputLabel(node, key));
  });
}

/** Converts readable chips back to engine expressions. Unknown chips are reported, not guessed. */
export function fromHuman(a, text) {
  const order = stepOrder(a);
  const bad = [];
  const value = String(text).replace(HUMAN_GLOBAL, (m, num, label) => {
    const node = a.nodes.find((n) => n.id === order[Number(num) - 1]);
    const want = label.trim().toLowerCase();
    const out =
      node &&
      ACTIONS[node.action]?.outputs?.find((o) =>
        [o.label.ru, o.label.en, o.key].some((l) => l.toLowerCase() === want)
      );
    if (!out) {
      bad.push(m);
      return m;
    }
    return ACTIONS[node.action].kind === 'trigger'
      ? `{{ $trigger.${out.key} }}`
      : `{{ $nodes.${node.id}.output.${out.key} }}`;
  });
  return { value, bad };
}

/** Expressions that point at steps which no longer exist or are not upstream. */
export function danglingRefs(a, node) {
  const upstream = ancestorsOf(a, node.id);
  const bad = [];
  for (const v of Object.values(node.config ?? {})) {
    const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
    for (const m of s.matchAll(EXPR_GLOBAL)) {
      if (m[1] === 'nodes' && !upstream.has(m[2])) bad.push(m[0]);
    }
  }
  return bad;
}

// ── Expression resolution for simulation previews ───────────────────────────

export function resolveValue(value, ctx) {
  if (typeof value === 'string') {
    const whole = value.match(
      /^\s*\{\{\s*\$(trigger|nodes)\.(?:([\w-]+)\.output\.)?(\w+)\s*\}\}\s*$/
    );
    if (whole) return lookup(ctx, whole[1], whole[2], whole[3]);
    return value.replace(EXPR_GLOBAL, (m, scope, id, key) => {
      const v = lookup(ctx, scope, id, key);
      return v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, ctx)]));
  return value;
}

function lookup(ctx, scope, id, key) {
  return scope === 'trigger' ? ctx.trigger?.[key] : ctx.nodes[id]?.[key];
}

/** Context made of each upstream output's *example* values, for "Example:" previews. */
export function exampleContext(a) {
  const ctx = { trigger: {}, nodes: {} };
  for (const n of a.nodes) {
    const outs = ACTIONS[n.action]?.outputs ?? [];
    const vals = Object.fromEntries(outs.map((o) => [o.key, L(o.example)]));
    if (ACTIONS[n.action]?.kind === 'trigger') ctx.trigger = vals;
    ctx.nodes[n.id] = vals;
  }
  return ctx;
}

// ── Step readiness ("Нужна настройка" / "Готово" / "Ошибка" / "Отключён") ───

export function nodeIssues(a, node, connections) {
  const action = ACTIONS[node.action];
  if (!action || action.planned) return [{ key: 'err.planned' }];
  const issues = [];
  const service = SERVICES[action.service];
  if (service?.auth) {
    if (!node.connectionId)
      issues.push({ key: 'err.noConnection', params: { service: L(service.name) } });
    else if (!connections.some((c) => c.id === node.connectionId))
      issues.push({ key: 'err.connectionMissing', params: { service: L(service.name) } });
  }
  for (const f of action.fields ?? []) {
    let v = node.config?.[f.key];
    // A list of connections counts only the ones that still exist.
    if (f.type === 'connections') {
      v = (Array.isArray(v) ? v : []).filter((id) => connections.some((c) => c.id === id));
      if (!v.length) v = undefined;
    }
    if (f.required && (v === undefined || v === null || v === ''))
      issues.push({ key: 'err.field', params: { label: L(f.label) }, field: f.key });
  }
  for (const token of danglingRefs(a, node))
    issues.push({ key: 'err.badToken', params: { token } });
  return issues;
}

export function nodeState(a, node, connections) {
  if (node.disabled) return 'disabled';
  if (nodeIssues(a, node, connections).length) return 'needsSetup';
  if (a.nodeErrors?.[node.id]) return 'error';
  return 'ready';
}

export function automationIssues(a, connections) {
  const dag = validateDag(a.nodes, a.edges);
  const nums = stepNumbers(a);
  const list = dag.valid
    ? []
    : [{ key: dag.messageKey, params: { path: (dag.cycle ?? []).join(' → ') } }];
  for (const id of stepOrder(a)) {
    const node = a.nodes.find((n) => n.id === id);
    if (node.disabled) continue;
    for (const issue of nodeIssues(a, node, connections))
      list.push({ ...issue, nodeId: id, n: nums.get(id) });
  }
  return list;
}

// ── Secret redaction for "Technical details" ──────────────────────────────────

export function redactSecrets(obj) {
  const sensitiveKey =
    /password|secret|token|apikey|api_key|authorization|credential|private_key|dsn/i;
  const secretValue = /^(sk-[a-zA-Z0-9_-]{8,}|Bearer\s+.+|ghp_[a-zA-Z0-9]+)$/i;
  if (obj === null || typeof obj !== 'object') {
    return typeof obj === 'string' && secretValue.test(obj) ? '[REDACTED]' : obj;
  }
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, sensitiveKey.test(k) ? '[REDACTED]' : redactSecrets(v)])
  );
}

// ── Simulation (never calls the network) ──────────────────────────────────────

/**
 * Walks the graph in topological order using example data. Steps that are not set up
 * fail with a human-readable reason instead of pretending to succeed.
 * @param {{ until?: string }} opts  stop after this node (used by "Test this step")
 */
export function simulate(a, connections, opts = {}) {
  const dag = validateDag(a.nodes, a.edges);
  const nums = stepNumbers(a);
  const run = {
    id: `sim_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    automationId: a.id,
    automationName: a.name,
    at: Date.now(),
    kind: 'simulation',
    result: 'ok',
    failedNodeId: null,
    steps: [],
  };
  if (!dag.valid) {
    run.result = 'failed';
    run.error = { key: dag.messageKey, params: { path: (dag.cycle ?? []).join(' → ') } };
    return run;
  }

  const ctx = { trigger: {}, nodes: {} };
  const blocked = new Set();
  const order = stepOrder(a);
  const scope = opts.until ? new Set([opts.until, ...ancestorsOf(a, opts.until)]) : null;

  for (const id of order) {
    if (scope && !scope.has(id)) continue;
    const node = a.nodes.find((n) => n.id === id);
    const action = ACTIONS[node.action];
    const base = { nodeId: id, n: nums.get(id), title: nodeTitle(node) };

    if (run.result === 'failed' || parentsOf(a, id).some((p) => blocked.has(p))) {
      blocked.add(id);
      run.steps.push({ ...base, status: 'notReached' });
      continue;
    }
    if (node.disabled) {
      run.steps.push({ ...base, status: 'skipped' });
      continue;
    }
    const issues = nodeIssues(a, node, connections);
    if (issues.length) {
      run.result = 'failed';
      run.failedNodeId = id;
      blocked.add(id);
      run.steps.push({ ...base, status: 'failed', error: issues[0] });
      continue;
    }

    const resolved = resolveValue(structuredClone(node.config ?? {}), ctx);
    const conn = connections.find((c) => c.id === node.connectionId);
    const sim = action.simulate(resolved);
    if (action.kind === 'trigger') ctx.trigger = sim.output;
    ctx.nodes[id] = sim.output;

    const input = { config: resolved };
    if (conn)
      input.connection = {
        id: conn.id,
        name: conn.name,
        token: `demo-${conn.id}-not-a-real-secret`,
      };
    run.steps.push({
      ...base,
      status: sim.stop ? 'stopped' : 'ok',
      summary: sim.summary,
      input: redactSecrets({ nodeType: action.type, ...input }),
      output: redactSecrets(sim.output),
    });
    if (sim.stop) {
      blocked.add(id);
      if (run.result === 'ok') run.result = 'stopped';
    }
  }
  return run;
}

export function describeIssue(issue) {
  return t(issue.key, issue.params ?? {});
}

// ── Deterministic graph checksum (developer mode) ─────────────────────────────

export async function graphSha256(a) {
  const canonical = {
    nodes: [...a.nodes]
      .sort((x, y) => x.id.localeCompare(y.id))
      .map((n) => ({
        id: n.id,
        type: ACTIONS[n.action]?.type ?? n.action,
        config: n.config,
        connectionId: n.connectionId ?? null,
        disabled: !!n.disabled,
      })),
    edges: a.edges.map((e) => `${e.source}->${e.target}`).sort(),
  };
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical))
  );
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
