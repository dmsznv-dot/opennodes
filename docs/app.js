/**
 * OpenNodes v1.0 — Interactive GitHub Pages Prototype Engine
 * Implements:
 * - Real-time Kahn's Algorithm cycle detection
 * - Deterministic SHA-256 workflow graph checksum (Web Crypto API)
 * - Draft vs. Published immutable snapshot isolation & rollback
 * - 480px Node Configuration Drawer with upstream AST expression autocomplete
 * - Live DAG step execution simulator with [REDACTED] secret masking & tabular micro-timings
 */

const NODE_CATALOG = {
  triggers: [
    { type: 'trigger.manual', label: 'Manual Trigger', portType: 'trigger', defaultConfig: { mode: 'interactive' } },
    { type: 'trigger.cron', label: 'Cron Schedule', portType: 'trigger', defaultConfig: { cron: '*/15 * * * *', timezone: 'UTC' } },
    { type: 'trigger.webhook', label: 'Incoming Webhook', portType: 'trigger', defaultConfig: { path: '/webhooks/inbound', verifyHmac: true } },
    { type: 'trigger.telegram', label: 'Telegram Polling', portType: 'trigger', defaultConfig: { allowedCommands: '/start,/ask' } },
  ],
  primitives: [
    { type: 'primitive.if', label: 'IF Condition Branch', portType: 'boolean', defaultConfig: { expression: '{{ $trigger.priority == "HIGH" }}' } },
    { type: 'primitive.filter', label: 'Filter Items', portType: 'json', defaultConfig: { condition: '{{ $item.score >= 80 }}' } },
    { type: 'primitive.map', label: 'Map Transform', portType: 'json', defaultConfig: { mapping: '{"summary": "{{ $trigger.title }}"}' } },
    { type: 'primitive.delay', label: 'Durable Delay', portType: 'any', defaultConfig: { delayMs: 1500 } },
    { type: 'primitive.forEach', label: 'ForEach Loop', portType: 'json', defaultConfig: { itemsPath: '{{ $trigger.items }}' } },
    { type: 'primitive.merge', label: 'Merge Branches', portType: 'json', defaultConfig: { mode: 'combineByIndex' } },
  ],
  connectors: [
    { type: 'core.httpRequest', label: 'HTTP Request (SSRF Safe)', portType: 'json', defaultConfig: { method: 'POST', url: 'https://api.example.com/v1/ingest' } },
    { type: 'core.outgoingWebhook', label: 'Outgoing Webhook', portType: 'json', defaultConfig: { url: 'https://hooks.partner.io/notify' } },
    { type: 'core.jsonTransform', label: 'JSON Transform', portType: 'json', defaultConfig: { expression: '{{ $nodes.trig_1.output }}' } },
    { type: 'core.csv', label: 'CSV Parser / Writer', portType: 'json', defaultConfig: { delimiter: ',', headers: true } },
    { type: 'core.rss', label: 'RSS Feed Reader', portType: 'json', defaultConfig: { feedUrl: 'https://hnrss.org/frontpage' } },
    { type: 'core.smtp', label: 'SMTP Email Dispatch', portType: 'json', defaultConfig: { to: 'ops@opennodes.dev', subject: 'Alert: {{ $trigger.event }}' } },
    { type: 'core.postgresSql', label: 'PostgreSQL Query', portType: 'json', defaultConfig: { query: 'INSERT INTO ledger (id, amount) VALUES ($1, $2)' } },
    { type: 'core.telegramBot', label: 'Telegram Send Message', portType: 'json', defaultConfig: { chatId: '-1001928374', text: '{{ $nodes.ai_1.output.text }}' } },
    { type: 'core.filesystem', label: 'Sandboxed Filesystem', portType: 'string', defaultConfig: { operation: 'writeFile', relativePath: 'exports/output.json' } },
    { type: 'ai.openai', label: 'OpenAI Chat Completion', portType: 'string', defaultConfig: { model: 'gpt-4o-mini', prompt: 'Summarize: {{ $trigger.content }}' } },
    { type: 'ai.ollama', label: 'Ollama Local LLM', portType: 'string', defaultConfig: { model: 'llama3.2', prompt: 'Diagnose error: {{ $trigger.error }}' } },
  ],
};

const PORT_COLORS = {
  trigger: '#f59e0b',
  json: '#3b82f6',
  string: '#10b981',
  boolean: '#ec4899',
  any: '#94a3b8',
};

const STATUS_COLORS = {
  IDLE: '#8b94a5',
  QUEUED: '#8b94a5',
  RUNNING: '#3b82f6',
  SUCCEEDED: '#10b981',
  FAILED: '#ef4444',
  SKIPPED: '#6b7280',
};

const SCENARIO_TEMPLATES = {
  rss_ai_telegram: {
    name: 'RSS Feed to Telegram Intelligence Bot',
    nodes: [
      { id: 'trig_1', type: 'trigger.cron', label: 'Every 15m Cron', x: 56, y: 120, portType: 'trigger', credentialId: '', config: { cron: '*/15 * * * *', timezone: 'UTC' } },
      { id: 'rss_1', type: 'core.rss', label: 'Fetch Tech RSS', x: 320, y: 120, portType: 'json', credentialId: '', config: { feedUrl: 'https://hnrss.org/newest?points=100' } },
      { id: 'ai_1', type: 'ai.openai', label: 'OpenAI Executive Summary', x: 584, y: 120, portType: 'string', credentialId: 'cred_openai_prod', config: { model: 'gpt-4o-mini', prompt: 'Summarize article: {{ $nodes.rss_1.output.title }}' } },
      { id: 'tg_1', type: 'core.telegramBot', label: 'Post to Telegram Channel', x: 848, y: 120, portType: 'json', credentialId: 'cred_tg_bot', config: { chatId: '@opennodes_intel', text: '{{ $nodes.ai_1.output.text }}' } },
    ],
    edges: [
      { id: 'e1', source: 'trig_1', target: 'rss_1' },
      { id: 'e2', source: 'rss_1', target: 'ai_1' },
      { id: 'e3', source: 'ai_1', target: 'tg_1' },
    ],
  },
  stripe_sql_smtp: {
    name: 'Webhook Payment to SQL Ledger & Receipt Email',
    nodes: [
      { id: 'trig_1', type: 'trigger.webhook', label: 'Stripe Webhook (HMAC)', x: 56, y: 132, portType: 'trigger', credentialId: 'cred_webhook_hmac', config: { path: '/webhooks/stripe', verifyHmac: true } },
      { id: 'if_1', type: 'primitive.if', label: 'IF amount >= $100', x: 320, y: 132, portType: 'boolean', credentialId: '', config: { expression: '{{ $trigger.amount >= 10000 }}' } },
      { id: 'sql_1', type: 'core.postgresSql', label: 'Insert SQL Audit Ledger', x: 584, y: 64, portType: 'json', credentialId: 'cred_pg_main', config: { query: 'INSERT INTO payments (tx_id, amount) VALUES ($1, $2)' } },
      { id: 'smtp_1', type: 'core.smtp', label: 'Send Customer Receipt', x: 848, y: 132, portType: 'json', credentialId: 'cred_smtp_relay', config: { to: '{{ $trigger.customer_email }}', subject: 'Payment Confirmed' } },
    ],
    edges: [
      { id: 'e1', source: 'trig_1', target: 'if_1' },
      { id: 'e2', source: 'if_1', target: 'sql_1' },
      { id: 'e3', source: 'sql_1', target: 'smtp_1' },
    ],
  },
  health_ollama_alert: {
    name: 'Server Health Monitor & Local Ollama Diagnostic',
    nodes: [
      { id: 'trig_1', type: 'trigger.manual', label: 'Manual / Cron Probe', x: 56, y: 120, portType: 'trigger', credentialId: '', config: { targetEnv: 'production-eu' } },
      { id: 'http_1', type: 'core.httpRequest', label: 'GET /health/ready', x: 320, y: 120, portType: 'json', credentialId: '', config: { method: 'GET', url: 'https://api.opennodes.io/health/ready' } },
      { id: 'ollama_1', type: 'ai.ollama', label: 'Ollama Root-Cause Analysis', x: 584, y: 120, portType: 'string', credentialId: '', config: { model: 'llama3.2', prompt: 'Analyze telemetry: {{ $nodes.http_1.output.status }}' } },
      { id: 'tg_1', type: 'core.telegramBot', label: 'Alert On-Call Engineer', x: 848, y: 120, portType: 'json', credentialId: 'cred_tg_bot', config: { chatId: '-100998877', text: 'INCIDENT: {{ $nodes.ollama_1.output.diagnosis }}' } },
    ],
    edges: [
      { id: 'e1', source: 'trig_1', target: 'http_1' },
      { id: 'e2', source: 'http_1', target: 'ollama_1' },
      { id: 'e3', source: 'ollama_1', target: 'tg_1' },
    ],
  },
};

const state = {
  nodes: [],
  edges: [],
  selectedNodeId: null,
  zoom: 1.0,
  publishedVersion: 1,
  publishedSnapshot: null,
  isDraftDirty: false,
  credentials: [
    { id: 'cred_openai_prod', name: 'OpenAI Production Key', type: 'ai.openai', maskedHint: '••••••••9999', keyVersion: 1 },
    { id: 'cred_tg_bot', name: 'Telegram Ops Bot Token', type: 'core.telegramBot', maskedHint: '••••••••4821', keyVersion: 1 },
    { id: 'cred_pg_main', name: 'Primary PostgreSQL DSN', type: 'core.postgresSql', maskedHint: '••••••••5432', keyVersion: 1 },
    { id: 'cred_smtp_relay', name: 'Transactional SMTP Relay', type: 'core.smtp', maskedHint: '••••••••7710', keyVersion: 1 },
    { id: 'cred_webhook_hmac', name: 'Stripe HMAC Signing Secret', type: 'trigger.webhook', maskedHint: '••••••••ab12', keyVersion: 1 },
  ],
  nodeStatuses: {},
  nodeDurations: {},
  executionSteps: [],
  selectedStepIndex: 0,
};

// 1. Kahn's Algorithm Cycle Detection & Single Trigger Validation
function validateDag(nodes, edges) {
  const triggers = nodes.filter((n) => n.type.startsWith('trigger.'));
  if (triggers.length === 0) {
    return { valid: false, code: 'ERR_MISSING_TRIGGER', message: 'Workflow requires exactly 1 root Trigger node.' };
  }
  if (triggers.length > 1) {
    return { valid: false, code: 'ERR_MULTIPLE_TRIGGERS', message: `Found ${triggers.length} triggers. Only 1 root trigger allowed.` };
  }

  const inDegree = new Map();
  const adj = new Map();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!adj.has(e.source) || !inDegree.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  }

  const queue = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const topo = [];
  while (queue.length > 0) {
    const curr = queue.shift();
    topo.push(curr);
    for (const next of adj.get(curr) || []) {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  if (topo.length !== nodes.length) {
    const cycleNodes = nodes.filter((n) => !topo.includes(n.id)).map((n) => n.id);
    return {
      valid: false,
      code: 'ERR_CYCLIC_DEPENDENCY_DETECTED',
      message: `Cycle detected involving nodes: [${cycleNodes.join(' ⇄ ')}]`,
    };
  }

  return { valid: true, topologicalOrder: topo, message: 'Single root trigger verified. 0 cycles detected.' };
}

// 2. Permutation-Invariant Canonical SHA-256 Checksum
async function computeGraphSha256(nodes, edges) {
  const canonical = {
    nodes: [...nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => ({ id: n.id, type: n.type, label: n.label, config: n.config, credentialId: n.credentialId })),
    edges: [...edges]
      .sort((a, b) => `${a.source}->${a.target}`.localeCompare(`${b.source}->${b.target}`))
      .map((e) => ({ source: e.source, target: e.target })),
  };
  const raw = JSON.stringify(canonical);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}

// 3. Recursive Secret Redactor (@localflow/observability)
function redactSecrets(obj) {
  const sensitiveKeyRegex = /password|secret|token|apikey|api_key|authorization|credential|private_key/i;
  const secretValueRegex = /^(sk-[a-zA-Z0-9_-]{8,}|Bearer\s+.+|ghp_[a-zA-Z0-9]+)$/i;

  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'string' && secretValueRegex.test(obj)) return '[REDACTED]';
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(redactSecrets);

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (sensitiveKeyRegex.test(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out;
}

// 4. Load Scenario Template
async function loadScenario(key) {
  const tpl = SCENARIO_TEMPLATES[key];
  if (!tpl) return;
  state.nodes = structuredClone(tpl.nodes);
  state.edges = structuredClone(tpl.edges);
  state.selectedNodeId = state.nodes[0]?.id || null;
  state.nodeStatuses = {};
  state.nodeDurations = {};
  state.isDraftDirty = false;
  state.publishedSnapshot = {
    version: state.publishedVersion,
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
  };
  await renderAll();
  await executeWorkflowSimulation(true);
}

// 5. Render Canvas, Edges, Sidebar & Config Drawer
async function renderAll() {
  renderVersionBar();
  renderEdgeSelectors();
  renderValidationBanner();
  renderCanvasNodesAndEdges();
  renderConfigDrawer();
  await updateChecksumBadge();
}

async function updateChecksumBadge() {
  const hex = await computeGraphSha256(state.nodes, state.edges);
  const el = document.getElementById('checksumBadge');
  el.textContent = `sha256: ${hex.slice(0, 12)}…${hex.slice(-4)}`;
  el.title = `Full SHA-256: ${hex}`;
}

function renderVersionBar() {
  const badge = document.getElementById('versionBadge');
  if (state.isDraftDirty) {
    badge.textContent = `DRAFT (Unsaved edits · Active: v${state.publishedVersion})`;
    badge.className = 'version-pill';
  } else {
    badge.textContent = `PUBLISHED v${state.publishedVersion}`;
    badge.className = 'version-pill published';
  }
  document.getElementById('nodeCountLabel').textContent = `${state.nodes.length} nodes · ${state.edges.length} edges`;
  document.getElementById('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
}

function renderValidationBanner() {
  const res = validateDag(state.nodes, state.edges);
  const badge = document.getElementById('dagStatusBadge');
  const banner = document.getElementById('validationBanner');
  if (res.valid) {
    badge.textContent = 'ACYCLIC ✓';
    badge.style.color = '#10b981';
    banner.className = 'alert-banner ok';
    banner.textContent = res.message;
  } else {
    badge.textContent = res.code;
    badge.style.color = '#ef4444';
    banner.className = 'alert-banner error';
    banner.textContent = res.message;
  }
}

function renderEdgeSelectors() {
  const srcSel = document.getElementById('edgeSourceSelect');
  const tgtSel = document.getElementById('edgeTargetSelect');
  const prevSrc = srcSel.value;
  const prevTgt = tgtSel.value;

  srcSel.innerHTML = state.nodes.map((n) => `<option value="${n.id}">From: ${n.label} (${n.id})</option>`).join('');
  tgtSel.innerHTML = state.nodes.map((n) => `<option value="${n.id}">To: ${n.label} (${n.id})</option>`).join('');

  if (state.nodes.some((n) => n.id === prevSrc)) srcSel.value = prevSrc;
  if (state.nodes.some((n) => n.id === prevTgt)) tgtSel.value = prevTgt;
  else if (state.nodes.length > 1) tgtSel.value = state.nodes[1].id;
}

function renderCanvasNodesAndEdges() {
  const transformEl = document.getElementById('canvasTransform');
  transformEl.style.transform = `scale(${state.zoom})`;

  const svg = document.getElementById('edgesSvg');
  const nodesLayer = document.getElementById('nodesLayer');

  // Render cubic Bezier SVG edges
  const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
  let svgHtml = '';
  for (const edge of state.edges) {
    const s = nodeMap.get(edge.source);
    const t = nodeMap.get(edge.target);
    if (!s || !t) continue;
    const x1 = s.x + 208;
    const y1 = s.y + 42;
    const x2 = t.x;
    const y2 = t.y + 42;
    const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
    const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    const color = PORT_COLORS[s.portType] || PORT_COLORS.json;
    const isRunning = state.nodeStatuses[t.id] === 'RUNNING';
    svgHtml += `
      <path d="${path}" stroke="${color}" stroke-width="${isRunning ? 3 : 2}" fill="none" opacity="0.85" />
      <circle cx="${x2}" cy="${y2}" r="4" fill="${color}" />
    `;
  }
  svg.innerHTML = svgHtml;

  // Render Node Cards
  nodesLayer.innerHTML = '';
  for (const node of state.nodes) {
    const status = state.nodeStatuses[node.id] || 'IDLE';
    const duration = state.nodeDurations[node.id];
    const portColor = PORT_COLORS[node.portType] || PORT_COLORS.json;
    const statusColor = STATUS_COLORS[status] || STATUS_COLORS.IDLE;

    const card = document.createElement('div');
    card.className = `dag-node ${state.selectedNodeId === node.id ? 'selected' : ''}`;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;

    card.innerHTML = `
      <div class="dag-node-header">
        <span class="dag-node-type">${node.type}</span>
        <span class="dag-node-status tabular-nums" style="color: ${statusColor};">${status}</span>
      </div>
      <div class="dag-node-title">${node.label}</div>
      <div class="dag-node-footer">
        <span><span class="port-dot" style="background:${portColor};"></span> ${node.portType}</span>
        <span class="tabular-nums">${duration !== undefined ? `${duration}ms` : node.id}</span>
      </div>
    `;

    // Pointer Drag & Select
    card.addEventListener('mousedown', (ev) => {
      ev.stopPropagation();
      state.selectedNodeId = node.id;
      renderCanvasNodesAndEdges();
      renderConfigDrawer();

      const startX = ev.clientX;
      const startY = ev.clientY;
      const origX = node.x;
      const origY = node.y;

      const onMove = (moveEv) => {
        const dx = (moveEv.clientX - startX) / state.zoom;
        const dy = (moveEv.clientY - startY) / state.zoom;
        node.x = Math.max(16, Math.round((origX + dx) / 4) * 4);
        node.y = Math.max(16, Math.round((origY + dy) / 4) * 4);
        renderCanvasNodesAndEdges();
      };

      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    nodesLayer.appendChild(card);
  }
}

// 6. Render 480px Right-Side Node Configuration Drawer
function renderConfigDrawer() {
  const node = state.nodes.find((n) => n.id === state.selectedNodeId) || state.nodes[0];
  if (!node) return;

  document.getElementById('drawerNodeType').textContent = node.type;
  document.getElementById('drawerNodeTitle').textContent = node.label;
  document.getElementById('drawerNodeId').textContent = node.id;
  document.getElementById('drawerLabelInput').value = node.label;

  // Credentials selector
  const credSelect = document.getElementById('drawerCredentialSelect');
  credSelect.innerHTML =
    `<option value="">— None (No Secret Required) —</option>` +
    state.credentials
      .map((c) => `<option value="${c.id}">${c.name} (${c.maskedHint})</option>`)
      .join('');
  credSelect.value = node.credentialId || '';

  // Dynamic Config Fields
  const fieldsContainer = document.getElementById('drawerDynamicFields');
  fieldsContainer.innerHTML = '';
  for (const [key, val] of Object.entries(node.config || {})) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field-group';
    wrapper.innerHTML = `
      <label class="field-label">
        <span>${key} <span style="color: #ef4444;">*</span></span>
        <span class="palette-tag">${typeof val}</span>
      </label>
      <input class="input-control drawer-config-input" data-config-key="${key}" value="${String(val).replace(/"/g, '&quot;')}" />
    `;
    fieldsContainer.appendChild(wrapper);
  }

  // Upstream AST Autocomplete Suggestions
  const suggestions = ['{{ $trigger.payload }}', '{{ $execution.id }}'];
  const visited = new Set();
  const queue = [node.id];
  while (queue.length > 0) {
    const curr = queue.shift();
    for (const e of state.edges) {
      if (e.target === curr && !visited.has(e.source)) {
        visited.add(e.source);
        queue.push(e.source);
        suggestions.push(`{{ $nodes.${e.source}.output.data }}`);
      }
    }
  }

  const autoContainer = document.getElementById('drawerAutocompleteList');
  autoContainer.innerHTML = suggestions
    .map((expr) => `<button type="button" class="expr-chip" data-expr="${expr}">${expr}</button>`)
    .join('');

  autoContainer.querySelectorAll('.expr-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const firstInput = fieldsContainer.querySelector('.drawer-config-input');
      if (firstInput) {
        firstInput.value = `${firstInput.value} ${btn.dataset.expr}`.trim();
      }
    });
  });
}

// 7. Execute Workflow Simulation & Populate Run Inspector
async function executeWorkflowSimulation(silent = false) {
  const dagCheck = validateDag(state.nodes, state.edges);
  if (!dagCheck.valid) {
    renderValidationBanner();
    return;
  }

  const execId = `exec_${Math.random().toString(36).slice(2, 10)}`;
  document.getElementById('execIdBadge').textContent = execId;
  document.getElementById('execStatusBadge').textContent = 'RUNNING';
  document.getElementById('execStatusBadge').className = 'version-pill';

  const injectSecret = document.getElementById('chkSimulateSecret').checked;
  const order = dagCheck.topologicalOrder;
  state.executionSteps = [];
  state.nodeStatuses = {};
  state.nodeDurations = {};

  for (const id of order) state.nodeStatuses[id] = 'QUEUED';
  renderCanvasNodesAndEdges();

  let totalMs = 0;
  for (const nodeId of order) {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    state.nodeStatuses[nodeId] = 'RUNNING';
    renderCanvasNodesAndEdges();
    if (!silent) {
      await new Promise((r) => setTimeout(r, 160));
    }

    const stepMs = Math.floor(12 + Math.random() * 68);
    totalMs += stepMs;
    state.nodeStatuses[nodeId] = 'SUCCEEDED';
    state.nodeDurations[nodeId] = stepMs;

    const rawInput = {
      nodeId: node.id,
      type: node.type,
      resolvedConfig: structuredClone(node.config),
      ...(injectSecret
        ? {
            apiKey: 'sk-live-secret-token-9999999999',
            authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
          }
        : {}),
    };

    const rawOutput = {
      status: 'ok',
      nodeId: node.id,
      processedAt: new Date().toISOString(),
      result:
        node.type === 'ai.openai' || node.type === 'ai.ollama'
          ? { text: 'AI synthesis complete: 3 high-priority signals identified.' }
          : { rowsAffected: 1, delivered: true },
      ...(injectSecret ? { leakedClientSecret: 'top-secret-password-value' } : {}),
    };

    state.executionSteps.push({
      nodeId: node.id,
      label: node.label,
      type: node.type,
      status: 'SUCCEEDED',
      durationMs: stepMs,
      sanitizedInput: redactSecrets(rawInput),
      sanitizedOutput: redactSecrets(rawOutput),
    });

    renderCanvasNodesAndEdges();
    renderInspector();
  }

  document.getElementById('execStatusBadge').textContent = 'SUCCEEDED';
  document.getElementById('execStatusBadge').className = 'version-pill published';
  document.getElementById('execDurationLabel').textContent = `${totalMs}ms`;
}

function renderInspector() {
  const listEl = document.getElementById('inspectorStepsList');
  listEl.innerHTML = state.executionSteps
    .map(
      (s, idx) => `
      <div class="step-row ${idx === state.selectedStepIndex ? 'active' : ''}" data-idx="${idx}">
        <span>
          <strong style="color: #10b981;">✓</strong> ${s.label}
          <span class="palette-tag">(${s.nodeId})</span>
        </span>
        <span class="tabular-nums" style="color: var(--ink-400);">${s.durationMs}ms</span>
      </div>
    `
    )
    .join('');

  listEl.querySelectorAll('.step-row').forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedStepIndex = Number(row.dataset.idx);
      renderInspector();
    });
  });

  const activeStep = state.executionSteps[state.selectedStepIndex] || state.executionSteps[0];
  if (activeStep) {
    document.getElementById('inspectorInputPre').textContent = JSON.stringify(activeStep.sanitizedInput, null, 2);
    document.getElementById('inspectorOutputPre').textContent = JSON.stringify(activeStep.sanitizedOutput, null, 2);
    document.getElementById('stepDurationBadge').textContent = `${activeStep.durationMs}ms`;
  }
}

// 8. Initialize Palette & Interactive Event Listeners
function initPalette() {
  const bindGroup = (containerId, items) => {
    const el = document.getElementById(containerId);
    el.innerHTML = items
      .map(
        (item) => `
        <button type="button" class="palette-item" data-type="${item.type}">
          <span>+ ${item.label}</span>
          <span class="palette-tag">${item.portType}</span>
        </button>
      `
      )
      .join('');

    el.querySelectorAll('.palette-item').forEach((btn, idx) => {
      btn.addEventListener('click', async () => {
        const item = items[idx];
        const newId = `node_${state.nodes.length + 1}`;
        const lastNode = state.nodes[state.nodes.length - 1];
        const newNode = {
          id: newId,
          type: item.type,
          label: item.label,
          x: lastNode ? Math.min(920, lastNode.x + 240) : 120,
          y: lastNode ? (lastNode.y + 88) % 280 + 48 : 120,
          portType: item.portType,
          credentialId: '',
          config: structuredClone(item.defaultConfig),
        };
        state.nodes.push(newNode);
        if (lastNode && !item.type.startsWith('trigger.')) {
          state.edges.push({ id: `e_${Date.now()}`, source: lastNode.id, target: newId });
        }
        state.selectedNodeId = newId;
        state.isDraftDirty = true;
        await renderAll();
      });
    });
  };

  bindGroup('paletteTriggers', NODE_CATALOG.triggers);
  bindGroup('palettePrimitives', NODE_CATALOG.primitives);
  bindGroup('paletteConnectors', NODE_CATALOG.connectors);
}

function initEvents() {
  document.getElementById('templateSelect').addEventListener('change', (e) => {
    loadScenario(e.target.value);
  });

  document.getElementById('btnConnectEdge').addEventListener('click', async () => {
    const source = document.getElementById('edgeSourceSelect').value;
    const target = document.getElementById('edgeTargetSelect').value;
    if (!source || !target || source === target) return;

    const candidateEdges = [...state.edges, { id: `e_${Date.now()}`, source, target }];
    const check = validateDag(state.nodes, candidateEdges);
    if (!check.valid) {
      const badge = document.getElementById('dagStatusBadge');
      const banner = document.getElementById('validationBanner');
      badge.textContent = check.code;
      badge.style.color = '#ef4444';
      banner.className = 'alert-banner error';
      banner.textContent = `Blocked by Kahn's Cycle Guard: ${check.message}`;
      return;
    }
    state.edges = candidateEdges;
    state.isDraftDirty = true;
    await renderAll();
  });

  document.getElementById('btnTestCycle').addEventListener('click', () => {
    if (state.nodes.length < 2) return;
    const first = state.nodes[0];
    const last = state.nodes[state.nodes.length - 1];
    const badge = document.getElementById('dagStatusBadge');
    const banner = document.getElementById('validationBanner');
    badge.textContent = 'ERR_CYCLIC_DEPENDENCY_DETECTED';
    badge.style.color = '#ef4444';
    banner.className = 'alert-banner error';
    banner.textContent = `Rejected edge (${last.id} → ${first.id}): Creates cyclic loop [${first.id} → … → ${last.id} → ${first.id}].`;
  });

  document.getElementById('btnPublish').addEventListener('click', async () => {
    const check = validateDag(state.nodes, state.edges);
    if (!check.valid) {
      renderValidationBanner();
      return;
    }
    state.publishedVersion += 1;
    state.isDraftDirty = false;
    state.publishedSnapshot = {
      version: state.publishedVersion,
      nodes: structuredClone(state.nodes),
      edges: structuredClone(state.edges),
    };
    await renderAll();
  });

  document.getElementById('btnRollback').addEventListener('click', async () => {
    if (!state.publishedSnapshot) return;
    state.nodes = structuredClone(state.publishedSnapshot.nodes);
    state.edges = structuredClone(state.publishedSnapshot.edges);
    state.isDraftDirty = false;
    state.selectedNodeId = state.nodes[0]?.id || null;
    await renderAll();
  });

  document.getElementById('btnSaveNode').addEventListener('click', async () => {
    const node = state.nodes.find((n) => n.id === state.selectedNodeId);
    if (!node) return;
    node.label = document.getElementById('drawerLabelInput').value.trim() || node.label;
    node.credentialId = document.getElementById('drawerCredentialSelect').value;

    const inputs = document.querySelectorAll('.drawer-config-input');
    const box = document.getElementById('drawerValidationBox');
    for (const inp of inputs) {
      const k = inp.dataset.configKey;
      const v = inp.value.trim();
      if (!v) {
        box.className = 'alert-banner error';
        box.textContent = `Validation Error: Field '${k}' is required.`;
        return;
      }
      node.config[k] = v;
    }
    box.className = 'alert-banner ok';
    box.textContent = 'Saved to Draft snapshot (Active Published version unchanged).';
    state.isDraftDirty = true;
    await renderAll();
  });

  document.getElementById('btnDeleteNode').addEventListener('click', async () => {
    if (!state.selectedNodeId) return;
    const delId = state.selectedNodeId;
    state.nodes = state.nodes.filter((n) => n.id !== delId);
    state.edges = state.edges.filter((e) => e.source !== delId && e.target !== delId);
    state.selectedNodeId = state.nodes[0]?.id || null;
    state.isDraftDirty = true;
    await renderAll();
  });

  document.getElementById('btnRunWorkflow').addEventListener('click', () => {
    executeWorkflowSimulation(false);
  });

  document.getElementById('chkSimulateSecret').addEventListener('change', () => {
    executeWorkflowSimulation(true);
  });

  document.getElementById('btnZoomIn').addEventListener('click', () => {
    state.zoom = Math.min(1.5, +(state.zoom + 0.1).toFixed(2));
    renderVersionBar();
    renderCanvasNodesAndEdges();
  });

  document.getElementById('btnZoomOut').addEventListener('click', () => {
    state.zoom = Math.max(0.6, +(state.zoom - 0.1).toFixed(2));
    renderVersionBar();
    renderCanvasNodesAndEdges();
  });

  document.getElementById('btnAutoLayout').addEventListener('click', () => {
    state.nodes.forEach((n, idx) => {
      n.x = 56 + idx * 264;
      n.y = 120;
    });
    renderCanvasNodesAndEdges();
  });

  // Modals
  const backdrop = document.getElementById('modalBackdrop');
  const modalTitle = document.getElementById('modalTitle');
  const modalContent = document.getElementById('modalContent');

  document.getElementById('btnCloseModal').addEventListener('click', () => {
    backdrop.classList.remove('open');
  });

  document.getElementById('btnVault').addEventListener('click', () => {
    modalTitle.textContent = 'Workspace Credentials Vault (AES-256-GCM Envelope Encryption)';
    modalContent.innerHTML = `
      <div class="alert-banner ok">
        Plaintext secrets are never returned by the API. Stored with 96-bit IV + 128-bit GCM AuthTag.
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${state.credentials
          .map(
            (c) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:var(--ink-950); border:1px solid var(--ink-800); border-radius:4px;">
            <div>
              <strong>${c.name}</strong>
              <span class="palette-tag" style="margin-left:6px;">${c.type}</span>
            </div>
            <span class="checksum-pill tabular-nums">${c.maskedHint} (key v${c.keyVersion})</span>
          </div>
        `
          )
          .join('')}
      </div>
    `;
    backdrop.classList.add('open');
  });

  document.getElementById('btnSetupModal').addEventListener('click', () => {
    modalTitle.textContent = '/setup — Instance Owner Bootstrap & RBAC Matrix';
    modalContent.innerHTML = `
      <div class="alert-banner ok">
        Instance Status: <strong>BOOTSTRAPPED</strong> (POST /api/v1/setup locked with HTTP 409 Conflict)
      </div>
      <div class="field-group">
        <label class="field-label"><span>Primary Owner Account</span><span>Role: OWNER</span></label>
        <input class="input-control" value="owner@opennodes.dev" readonly />
      </div>
      <div class="field-group">
        <label class="field-label"><span>Active RBAC Policy Matrix (4 Roles)</span></label>
        <pre class="code-pre">OWNER  -> Full workspace, credentials, publish & member control
ADMIN  -> Manage credentials, workflows, publish & executions
EDITOR -> Create/edit draft workflows & trigger manual runs
VIEWER -> Read-only inspection of workflows & redacted run logs</pre>
      </div>
    `;
    backdrop.classList.add('open');
  });
}

initPalette();
initEvents();
loadScenario('rss_ai_telegram');
