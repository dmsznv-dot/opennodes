/**
 * OpenNodes — public GitHub Pages demo (simulation only).
 *
 * Simple-first: pick a task → connect a service → fill 2–5 clear fields → test → turn on.
 * The graph editor, versions, checksums and raw JSON stay available behind
 * "Advanced" and "Developer mode". Nothing here talks to a server: every "Test" is an
 * in-browser simulation and is labelled as such.
 */
import { h, svg, clear } from './dom.js';
import {
  t,
  L,
  setLocale,
  getLocale,
  detectLocale,
  formatRelative,
  formatDateTime,
} from './i18n.js';
import {
  ACTIONS,
  SERVICES,
  SERVICE_ORDER,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  PICKER_GROUPS,
  SYNONYMS,
  isDevAction,
} from './catalog.js';
import {
  validateDag,
  stepOrder,
  stepNumbers,
  ancestorsOf,
  parentsOf,
  nodeTitle,
  layout,
  CARD_W,
  CARD_H,
  parseFieldInput,
  fieldErrorText,
  toHuman,
  fromHuman,
  humanToken,
  resolveValue,
  exampleContext,
  nodeIssues,
  nodeState,
  automationIssues,
  simulate,
  describeIssue,
  graphSha256,
} from './engine.js';

// ── Persistent store (this browser only) ──────────────────────────────────────

const STORE_KEY = 'opennodes.demo.v2';
const MAX_RUNS = 60;

function defaultStore() {
  return {
    version: 2,
    automations: [],
    connections: [],
    runs: [],
    settings: { lang: null, theme: 'system', devMode: false },
    onboarding: { status: 'new', step: 1, goal: null, automationId: null, hidden: false },
    hints: {},
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.version === 2)
        return {
          ...defaultStore(),
          ...data,
          settings: { ...defaultStore().settings, ...data.settings },
        };
    }
  } catch {
    /* storage unavailable or corrupted — start fresh */
  }
  return defaultStore();
}

const store = loadStore();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* private mode: the demo still works for this session */
  }
}

// ── Transient UI state ────────────────────────────────────────────────────────

const ui = {
  route: { view: 'automations', id: null },
  homeQuery: '',
  homeCategory: 'all',
  tplQuery: '',
  tplCategory: 'all',
  panelNodeId: null,
  panelDirty: false,
  panelResult: null,
  focusedField: null,
  runPanelOpen: false,
  lastRunId: null,
};

// ── Bootstrapping ─────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function applySettings() {
  setLocale(store.settings.lang ?? detectLocale(navigator.languages ?? [navigator.language]));
  document.title = t('app.title');
  const theme = store.settings.theme;
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function parseRoute() {
  const [, view = 'automations', id = null] = (location.hash || '#/automations').split('/');
  const known = ['automations', 'templates', 'connections', 'history', 'editor'];
  ui.route = {
    view: known.includes(view) ? view : 'automations',
    id: id ? decodeURIComponent(id) : null,
  };
}

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', () => {
  if (ui.panelDirty && !confirm(t('ed.unsavedClose'))) return;
  ui.panelNodeId = null;
  ui.panelDirty = false;
  ui.panelResult = null;
  ui.runPanelOpen = false;
  parseRoute();
  render();
  $('view').focus({ preventScroll: true });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.modal-backdrop')) closeModal();
  else if (document.querySelector('.popover')) closePopover();
  else if (ui.panelNodeId) closePanel();
});

// ── Render root ───────────────────────────────────────────────────────────────

function render() {
  applySettings();
  advanceOnboarding();
  renderHeader();
  renderBanner();
  const view = clear($('view'));
  const r = ui.route;
  if (r.view === 'templates') view.append(viewTemplates());
  else if (r.view === 'connections') view.append(viewConnections());
  else if (r.view === 'history') view.append(viewHistory());
  else if (r.view === 'editor') {
    view.append(viewEditor(r.id));
    // On narrow screens wide branches overflow: start scrolled to the centre (the trigger).
    const canvas = view.querySelector('.canvas');
    if (canvas) canvas.scrollLeft = (canvas.scrollWidth - canvas.clientWidth) / 2;
  } else view.append(viewAutomations());
  renderTour();
  if (store.onboarding.status === 'new' && !document.querySelector('.modal-backdrop'))
    openWelcome();
}

function renderBanner() {
  clear($('demoBanner')).append(
    h('span', { class: 'demo-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'banner-long' }, t('demo.banner')),
    h('span', { class: 'banner-short' }, t('demo.bannerShort'))
  );
}

function renderHeader() {
  const nav = [
    ['automations', 'nav.automations'],
    ['templates', 'nav.templates'],
    ['connections', 'nav.connections'],
    ['history', 'nav.history'],
  ];
  const current = ui.route.view === 'editor' ? 'automations' : ui.route.view;
  clear($('appHeader')).append(
    h(
      'a',
      { class: 'brand', href: '#/automations', 'aria-label': 'OpenNodes' },
      h('img', { src: './logo-mark.svg', alt: '', class: 'brand-logo' }),
      h('span', { class: 'brand-title' }, 'OpenNodes')
    ),
    h('span', { class: 'demo-badge', title: t('demo.noRealRun') }, t('demo.badge')),
    h(
      'nav',
      { class: 'main-nav', 'aria-label': t('nav.main') },
      nav.map(([id, key]) =>
        h(
          'a',
          {
            href: `#/${id}`,
            class: ['nav-link', current === id && 'active'],
            'aria-current': current === id ? 'page' : null,
          },
          t(key)
        )
      )
    ),
    h('div', { class: 'header-right' }, langSwitch(), profileButton())
  );
}

function langSwitch() {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': t('lang.label') },
    ['ru', 'en'].map((l) =>
      h(
        'button',
        {
          type: 'button',
          class: ['seg-btn', getLocale() === l && 'active'],
          'aria-pressed': String(getLocale() === l),
          onclick: () => {
            store.settings.lang = l;
            save();
            render();
          },
        },
        l.toUpperCase()
      )
    )
  );
}

function profileButton() {
  return h(
    'button',
    {
      type: 'button',
      class: 'avatar-btn',
      'aria-label': t('menu.open'),
      'aria-haspopup': 'menu',
      onclick: (e) => openProfileMenu(e.currentTarget),
    },
    getLocale() === 'ru' ? 'Я' : 'Me'
  );
}

function openProfileMenu(anchor) {
  const ob = store.onboarding;
  const themeItem = (value) =>
    h(
      'button',
      {
        type: 'button',
        role: 'menuitemradio',
        class: 'menu-item',
        'aria-checked': String(store.settings.theme === value),
        onclick: () => {
          store.settings.theme = value;
          save();
          closePopover();
          render();
        },
      },
      (store.settings.theme === value ? '● ' : '○ ') + t(`menu.theme.${value}`)
    );

  openPopover(anchor, [
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item',
        onclick: () => {
          closePopover();
          if (ob.status === 'in_progress' && ob.hidden) {
            ob.hidden = false;
          } else {
            Object.assign(store.onboarding, {
              status: 'new',
              step: 1,
              goal: null,
              automationId: null,
              hidden: false,
            });
          }
          save();
          render();
        },
      },
      ob.status === 'in_progress' && ob.hidden ? t('menu.resumeTour') : t('menu.restartTour')
    ),
    h(
      'label',
      { class: 'menu-item menu-toggle' },
      h('input', {
        type: 'checkbox',
        checked: store.settings.devMode,
        onchange: (e) => {
          store.settings.devMode = e.target.checked;
          save();
          render();
        },
      }),
      t('menu.devMode')
    ),
    h('div', { class: 'menu-sep', role: 'separator' }),
    h('div', { class: 'menu-label' }, t('menu.theme')),
    themeItem('system'),
    themeItem('light'),
    themeItem('dark'),
    h('div', { class: 'menu-sep', role: 'separator' }),
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item',
        onclick: () => {
          closePopover();
          openModal({ title: t('menu.about'), body: h('p', {}, t('menu.aboutText')) });
        },
      },
      t('menu.about')
    ),
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item danger',
        onclick: () => {
          closePopover();
          if (!confirm(t('menu.resetConfirm'))) return;
          const lang = store.settings.lang;
          Object.assign(store, defaultStore());
          store.settings.lang = lang;
          save();
          go('#/automations');
        },
      },
      t('menu.reset')
    ),
  ]);
}

// ── Popover / modal / toast primitives ────────────────────────────────────────

function openPopover(anchor, items) {
  closePopover();
  const rect = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'popover', role: 'menu' }, items);
  document.body.append(pop);
  const left = Math.max(
    8,
    Math.min(rect.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)
  );
  Object.assign(pop.style, { top: `${rect.bottom + 6}px`, left: `${left}px` });
  pop.querySelector('button, input')?.focus();
  setTimeout(() => document.addEventListener('click', onOutside, true));
  function onOutside(e) {
    if (!pop.contains(e.target)) closePopover();
  }
  pop._cleanup = () => document.removeEventListener('click', onOutside, true);
}

function closePopover() {
  document.querySelectorAll('.popover').forEach((p) => {
    p._cleanup?.();
    p.remove();
  });
}

let modalReturnFocus = null;

/** @param {{ title: string, body: Node|Node[], actions?: Array<{label:string, primary?:boolean, danger?:boolean, onClick?:Function}>, wide?: boolean, onClose?: Function, dismissible?: boolean }} opts */
function openModal(opts) {
  closeModal();
  modalReturnFocus = document.activeElement;
  const titleId = `m_${Math.random().toString(36).slice(2, 7)}`;
  const actions = opts.actions ?? [{ label: t('common.close') }];
  const card = h(
    'div',
    {
      class: ['modal-card', opts.wide && 'wide'],
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    },
    h(
      'div',
      { class: 'modal-head' },
      h('h2', { id: titleId, class: 'modal-title' }, opts.title),
      opts.dismissible === false
        ? null
        : h(
            'button',
            {
              type: 'button',
              class: 'icon-btn',
              'aria-label': t('common.close'),
              onclick: closeModal,
            },
            '✕'
          )
    ),
    h('div', { class: 'modal-body' }, opts.body),
    actions.length
      ? h(
          'div',
          { class: 'modal-actions' },
          actions.map((a) =>
            h(
              'button',
              {
                type: 'button',
                class: ['btn', a.primary && 'btn-primary', a.danger && 'btn-danger'],
                onclick: () => {
                  if (a.onClick?.() !== false) closeModal();
                },
              },
              a.label
            )
          )
        )
      : null
  );
  const backdrop = h(
    'div',
    {
      class: 'modal-backdrop',
      onclick: (e) => {
        if (e.target === backdrop && opts.dismissible !== false) closeModal();
      },
    },
    card
  );
  backdrop._onClose = opts.onClose;
  document.body.append(backdrop);
  (
    card.querySelector('.modal-body button, .modal-body input, .modal-actions .btn-primary') ??
    card.querySelector('button')
  )?.focus();
}

function closeModal() {
  const b = document.querySelector('.modal-backdrop');
  if (!b) return;
  b.remove();
  b._onClose?.();
  modalReturnFocus?.focus?.();
}

function toast(text, kind = 'ok') {
  const el = h('div', { class: ['toast', kind], role: 'status' }, text);
  $('toastRoot').append(el);
  setTimeout(() => el.remove(), 3600);
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function serviceIcon(serviceId, size = 'md') {
  const s = SERVICES[serviceId] ?? { icon: '?', color: '#64748b' };
  return h(
    'span',
    { class: ['svc-icon', size], style: { backgroundColor: s.color }, 'aria-hidden': 'true' },
    s.icon
  );
}

function templateServices(tpl) {
  return [...new Set(tpl.nodes.map((n) => ACTIONS[n.action]?.service).filter(Boolean))];
}

function requiredConnections(tpl) {
  return templateServices(tpl).filter((s) => SERVICES[s].auth && !SERVICES[s].planned);
}

function statusPill(a) {
  const label = t(`status.${a.status}`);
  const extra = a.status !== 'draft' && a.dirty ? ` · ${t('status.unpublished')}` : '';
  return h('span', { class: ['pill', `pill-${a.status}`] }, label + extra);
}

function stepStatePill(state) {
  const key = {
    needsSetup: 'step.needsSetup',
    ready: 'step.ready',
    error: 'step.error',
    disabled: 'step.disabled',
  }[state];
  return h('span', { class: ['state', `state-${state}`] }, t(key));
}

const STOPWORDS = new Set(
  'и в во на по из для с со к ко о об а но или что чтобы когда если это мне я хочу нужно как the a an to of in on for from with when if and or i want need my me it is'.split(
    ' '
  )
);

function normalize(s) {
  return String(s).toLowerCase().replace(/ё/g, 'е');
}

const stem = (w) => (w.length > 6 ? w.slice(0, -2) : w.length === 6 ? w.slice(0, -1) : w);
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Scores how well a natural-language query matches a text, with RU/EN synonym expansion. */
function searchScore(query, haystack) {
  const hay = normalize(haystack);
  const tokens = normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  if (!tokens.length) return 1;
  let hits = 0;
  for (const token of tokens) {
    const variants = new Set([token]);
    for (const group of SYNONYMS) {
      if (
        group.some(
          (g) => stem(normalize(g)) === stem(token) || normalize(g).startsWith(stem(token))
        )
      )
        group.forEach((g) => variants.add(normalize(g)));
    }
    // Match at word start only, so "письмо" does not hit "запись".
    if (
      [...variants].some((v) =>
        new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(stem(v))}`, 'u').test(hay)
      )
    )
      hits++;
  }
  return hits / tokens.length;
}

/** Keeps only the strongest matches so a long phrase does not return the whole catalog. */
function bestMatches(scored) {
  const best = Math.max(0, ...scored.map((x) => x.score));
  const floor = best >= 1 ? 1 : Math.max(0.5, best * 0.75);
  return scored.filter((x) => x.score > 0 && x.score >= floor - 1e-9);
}

function bothLangs(v) {
  return typeof v === 'string' ? v : `${v?.ru ?? ''} ${v?.en ?? ''}`;
}

function templateHaystack(tpl) {
  return [
    bothLangs(tpl.name),
    bothLangs(tpl.desc),
    ...tpl.nodes.map(
      (n) =>
        `${bothLangs(ACTIONS[n.action]?.name)} ${ACTIONS[n.action]?.keywords ?? ''} ${bothLangs(SERVICES[ACTIONS[n.action]?.service]?.name)}`
    ),
  ].join(' ');
}

function filterTemplates(query, category) {
  const scored = TEMPLATES.filter((tpl) => category === 'all' || tpl.category === category).map(
    (tpl) => ({ tpl, score: searchScore(query, templateHaystack(tpl)) })
  );
  return bestMatches(scored)
    .sort((x, y) => y.score - x.score || (y.tpl.recommended ? 1 : 0) - (x.tpl.recommended ? 1 : 0))
    .map((x) => x.tpl);
}

function categoryChips(selected, onSelect) {
  const cats = ['all', ...TEMPLATE_CATEGORIES];
  return h(
    'div',
    { class: 'chips', role: 'group' },
    cats.map((c) =>
      h(
        'button',
        {
          type: 'button',
          class: ['chip', selected === c && 'active'],
          'aria-pressed': String(selected === c),
          onclick: () => onSelect(c),
        },
        t(`cat.${c}`)
      )
    )
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────

function templateCard(tpl) {
  const services = templateServices(tpl);
  const needs = requiredConnections(tpl);
  const planned = tpl.planned?.length > 0;
  return h(
    'article',
    { class: ['tpl-card', planned && 'planned'] },
    h(
      'div',
      { class: 'tpl-icons' },
      services.map((s, i) => [
        i ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→') : null,
        serviceIcon(s, 'sm'),
      ])
    ),
    h('h3', { class: 'tpl-title' }, L(tpl.name)),
    h('p', { class: 'tpl-desc' }, L(tpl.desc)),
    h(
      'div',
      { class: 'tpl-badges' },
      planned ? h('span', { class: 'badge badge-planned' }, t('tpl.planned')) : null,
      tpl.recommended ? h('span', { class: 'badge badge-accent' }, t('tpl.recommended')) : null,
      tpl.safe ? h('span', { class: 'badge badge-ok' }, t('tpl.safe')) : null
    ),
    h(
      'p',
      { class: 'tpl-needs' },
      planned
        ? t('tpl.plannedHint', { services: tpl.planned.map((s) => L(SERVICES[s].name)).join(', ') })
        : needs.length
          ? `${t('tpl.needs')}: ${needs.map((s) => L(SERVICES[s].name)).join(', ')}`
          : t('tpl.nothingNeeded')
    ),
    h(
      'div',
      { class: 'tpl-actions' },
      h(
        'button',
        { type: 'button', class: 'btn btn-ghost', onclick: () => openTemplateDetails(tpl) },
        t('tpl.details')
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary',
          disabled: planned,
          onclick: () => createFromTemplate(tpl),
        },
        t('tpl.use')
      )
    )
  );
}

function openTemplateDetails(tpl) {
  const planned = tpl.planned?.length > 0;
  const needs = requiredConnections(tpl);
  const section = (title, ...content) =>
    h('section', { class: 'detail-section' }, h('h3', {}, title), content);
  openModal({
    title: L(tpl.name),
    wide: true,
    body: [
      h('p', { class: 'muted' }, L(tpl.desc)),
      h(
        'ol',
        { class: 'chain' },
        tpl.nodes.map((n) => {
          const act = ACTIONS[n.action];
          return h(
            'li',
            {},
            serviceIcon(act.service, 'sm'),
            h('span', {}, L(act.name)),
            act.planned ? h('span', { class: 'badge badge-planned' }, t('tpl.planned')) : null
          );
        })
      ),
      section(
        t('tpl.needs'),
        h(
          'p',
          {},
          needs.length ? needs.map((s) => L(SERVICES[s].name)).join(', ') : t('tpl.nothingNeeded')
        )
      ),
      section(t('tpl.sampleInput'), h('p', {}, L(tpl.sampleInput))),
      section(t('tpl.outputPreview'), h('p', {}, L(tpl.outputPreview))),
      section(t('tpl.limitations'), h('p', {}, L(tpl.limitations))),
      L(tpl.setup)?.length
        ? section(
            t('tpl.setup'),
            h(
              'ol',
              { class: 'plain-list' },
              L(tpl.setup).map((s) => h('li', {}, s))
            )
          )
        : null,
    ],
    actions: planned
      ? [{ label: t('common.close') }]
      : [
          { label: t('ed.cancel') },
          { label: t('tpl.use'), primary: true, onClick: () => createFromTemplate(tpl) },
        ],
  });
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function defaultConfig(actionId) {
  const cfg = {};
  for (const f of ACTIONS[actionId].fields ?? []) {
    if (f.default !== undefined)
      cfg[f.key] = f.default && typeof f.default === 'object' ? L(f.default) : f.default;
  }
  return cfg;
}

function localizeConfig(value) {
  if (Array.isArray(value)) return value.map(localizeConfig);
  if (value && typeof value === 'object') {
    if ('ru' in value && 'en' in value && Object.keys(value).length === 2) return L(value);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localizeConfig(v)]));
  }
  return value;
}

function autoConnection(actionId) {
  const service = ACTIONS[actionId].service;
  return SERVICES[service]?.auth
    ? (store.connections.find((c) => c.service === service)?.id ?? null)
    : null;
}

function newAutomation(name, nodes = [], edges = [], templateId = null) {
  const a = {
    id: uid('wf'),
    name,
    templateId,
    status: 'draft',
    dirty: false,
    publishedVersion: 0,
    published: null,
    nodes,
    edges,
    nodeErrors: {},
    createdAt: Date.now(),
    lastRunAt: null,
    lastRunResult: null,
  };
  store.automations.unshift(a);
  const ob = store.onboarding;
  if (ob.status === 'in_progress' && ob.step === 1) {
    ob.step = 2;
    ob.automationId = a.id;
  }
  save();
  return a;
}

function createFromTemplate(tpl) {
  if (tpl.planned?.length) return;
  const nodes = tpl.nodes.map((n) => ({
    id: n.id,
    action: n.action,
    label: '',
    config: { ...defaultConfig(n.action), ...localizeConfig(n.config) },
    connectionId: autoConnection(n.action),
    disabled: false,
  }));
  const edges = tpl.edges.map(([source, target], i) => ({ id: `e${i + 1}`, source, target }));
  const a = newAutomation(L(tpl.name), nodes, edges, tpl.id);
  closeModal();
  go(`#/editor/${a.id}`);
}

function createBlank() {
  const a = newAutomation(getLocale() === 'ru' ? 'Новая автоматизация' : 'New automation');
  go(`#/editor/${a.id}`);
}

// ── View: My automations (home) ───────────────────────────────────────────────

function viewAutomations() {
  const grid = h('div', { class: 'tpl-grid' });
  const fill = () => {
    const list = filterTemplates(ui.homeQuery, ui.homeCategory).slice(0, ui.homeQuery ? 8 : 4);
    clear(grid).append(
      ...(list.length ? list.map(templateCard) : [h('p', { class: 'empty' }, t('home.noResults'))])
    );
  };
  fill();

  const search = h('input', {
    type: 'search',
    class: 'input search-input',
    value: ui.homeQuery,
    placeholder: t('home.searchPlaceholder'),
    'aria-label': t('home.title'),
    oninput: (e) => {
      ui.homeQuery = e.target.value;
      fill();
    },
  });

  return h(
    'div',
    { class: 'page' },
    h(
      'section',
      { class: 'hero' },
      h('h1', { class: 'page-title' }, t('home.title')),
      h('p', { class: 'muted' }, t('home.subtitle')),
      search,
      categoryChips(ui.homeCategory, (c) => {
        ui.homeCategory = c;
        render();
      })
    ),
    h(
      'section',
      { class: 'block' },
      h(
        'div',
        { class: 'block-head' },
        h('h2', {}, t('home.popular')),
        h(
          'div',
          { class: 'row-gap' },
          h('a', { class: 'btn btn-ghost', href: '#/templates' }, t('home.allTemplates')),
          h(
            'button',
            { type: 'button', class: 'btn', onclick: createBlank },
            `＋ ${t('home.fromScratch')}`
          )
        )
      ),
      grid
    ),
    h(
      'section',
      { class: 'block' },
      h('h2', {}, t('home.mine')),
      store.automations.length
        ? h('ul', { class: 'auto-list' }, store.automations.map(automationRow))
        : h('p', { class: 'empty' }, t('home.empty'))
    )
  );
}

function automationRow(a) {
  const services = [
    ...new Set(
      stepOrder(a)
        .map((id) => ACTIONS[a.nodes.find((n) => n.id === id)?.action]?.service)
        .filter(Boolean)
    ),
  ];
  const last = a.lastRunAt
    ? `${t('list.lastRun', { when: formatRelative(a.lastRunAt) })} · ${runResultText(a.lastRunResult)}`
    : t('list.lastRun', { when: t('list.never') });
  return h(
    'li',
    { class: 'auto-row' },
    h(
      'a',
      { class: 'auto-main', href: `#/editor/${a.id}` },
      h(
        'span',
        { class: 'tpl-icons' },
        services.map((s) => serviceIcon(s, 'sm'))
      ),
      h(
        'span',
        { class: 'auto-text' },
        h('span', { class: 'auto-name' }, a.name),
        h('span', { class: 'muted small' }, last)
      )
    ),
    statusPill(a),
    h(
      'div',
      { class: 'row-gap' },
      a.status === 'active'
        ? h(
            'button',
            { type: 'button', class: 'btn btn-ghost', onclick: () => setPaused(a) },
            t('list.disable')
          )
        : h(
            'button',
            { type: 'button', class: 'btn btn-ghost', onclick: () => requestActivate(a) },
            t('list.enable')
          ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-ghost danger-text',
          'aria-label': `${t('list.delete')}: ${a.name}`,
          onclick: () => {
            if (!confirm(t('list.deleteConfirm', { name: a.name }))) return;
            store.automations = store.automations.filter((x) => x.id !== a.id);
            save();
            render();
          },
        },
        t('list.delete')
      )
    )
  );
}

function runResultText(result) {
  if (result === 'ok') return t('hist.ok');
  if (result === 'stopped') return t('hist.okStopped');
  if (result?.startsWith?.('failed')) return t('hist.failed', { n: result.split(':')[1] ?? '?' });
  return '';
}

// ── View: Templates ───────────────────────────────────────────────────────────

function viewTemplates() {
  const grid = h('div', { class: 'tpl-grid' });
  const fill = () => {
    let list = filterTemplates(ui.tplQuery, ui.tplCategory);
    const ob = store.onboarding;
    if (ob.status === 'in_progress' && ob.step === 1 && !ui.tplQuery) {
      const first = TEMPLATES.find((x) => x.recommended);
      list = [first, ...list.filter((x) => x !== first)];
    }
    clear(grid).append(
      ...(list.length ? list.map(templateCard) : [h('p', { class: 'empty' }, t('home.noResults'))])
    );
  };
  fill();
  return h(
    'div',
    { class: 'page' },
    h('h1', { class: 'page-title' }, t('tpl.title')),
    h('p', { class: 'muted' }, t('tpl.subtitle')),
    h('input', {
      type: 'search',
      class: 'input search-input',
      value: ui.tplQuery,
      placeholder: t('tpl.searchPlaceholder'),
      'aria-label': t('tpl.title'),
      oninput: (e) => {
        ui.tplQuery = e.target.value;
        fill();
      },
    }),
    categoryChips(ui.tplCategory, (c) => {
      ui.tplCategory = c;
      render();
    }),
    grid
  );
}

// ── View: Connections ─────────────────────────────────────────────────────────

function viewConnections() {
  const cards = SERVICE_ORDER.filter(
    (id) =>
      store.settings.devMode || !SERVICES[id].dev || store.connections.some((c) => c.service === id)
  ).map((id) => {
    const s = SERVICES[id];
    const conns = store.connections.filter((c) => c.service === id);
    let status;
    let actions;
    if (s.planned) {
      status = h('span', { class: 'badge badge-planned' }, t('conn.planned'));
      actions = null;
    } else if (!s.auth) {
      status = h('span', { class: 'badge' }, t('conn.noAuth'));
      actions = null;
    } else if (conns.length) {
      status = h('span', { class: 'badge badge-ok' }, t('conn.connected'));
      actions = conns.map((c) =>
        h(
          'div',
          { class: 'conn-line' },
          h('span', { class: 'small' }, c.name),
          h(
            'div',
            { class: 'row-gap' },
            h(
              'button',
              { type: 'button', class: 'btn btn-ghost', onclick: () => toast(t('conn.checkOk')) },
              t('conn.check')
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-ghost danger-text',
                onclick: () => {
                  if (!confirm(t('conn.disconnectConfirm', { name: c.name }))) return;
                  store.connections = store.connections.filter((x) => x.id !== c.id);
                  save();
                  render();
                },
              },
              t('conn.disconnect')
            )
          )
        )
      );
    } else {
      status = h('span', { class: 'badge badge-warn' }, t('conn.notConnected'));
      actions = h(
        'button',
        { type: 'button', class: 'btn btn-primary', onclick: () => openConnect(id) },
        t('conn.connect')
      );
    }
    return h(
      'article',
      { class: ['conn-card', s.planned && 'planned'] },
      h('div', { class: 'conn-head' }, serviceIcon(id), h('h3', {}, L(s.name))),
      status,
      actions
    );
  });
  return h(
    'div',
    { class: 'page' },
    h('h1', { class: 'page-title' }, t('conn.title')),
    h('p', { class: 'muted' }, t('conn.subtitle')),
    store.settings.devMode ? h('p', { class: 'note' }, t('conn.securityDev')) : null,
    h('div', { class: 'conn-grid' }, cards)
  );
}

function openConnect(serviceId, onDone) {
  const s = SERVICES[serviceId];
  openModal({
    title: t('conn.modalTitle', { service: L(s.name) }),
    body: [
      s.needs
        ? h(
            'section',
            { class: 'detail-section' },
            h('h3', {}, t('conn.whatNeeded')),
            h(
              'ol',
              { class: 'plain-list' },
              L(s.needs).map((x) => h('li', {}, x))
            )
          )
        : null,
      h('p', { class: 'note' }, t('conn.demoNotice')),
      store.settings.devMode ? h('p', { class: 'muted small' }, t('conn.securityDev')) : null,
    ],
    actions: [
      { label: t('ed.cancel') },
      {
        label: t('conn.useTest'),
        primary: true,
        onClick: () => {
          const conn = {
            id: uid('conn'),
            service: serviceId,
            name: t('conn.testName', { service: L(s.name) }),
            mode: 'test',
            createdAt: Date.now(),
          };
          store.connections.push(conn);
          // Steps waiting for this service pick the new connection up automatically.
          for (const a of store.automations) {
            for (const n of a.nodes) {
              if (
                ACTIONS[n.action]?.service === serviceId &&
                !store.connections.some((c) => c.id === n.connectionId)
              ) {
                n.connectionId = conn.id;
                if (a.nodeErrors) delete a.nodeErrors[n.id];
              }
            }
          }
          save();
          toast(t('conn.connected'));
          onDone?.(conn);
          render();
        },
      },
    ],
  });
}

// ── View: History ─────────────────────────────────────────────────────────────

function viewHistory() {
  return h(
    'div',
    { class: 'page' },
    h('h1', { class: 'page-title' }, t('hist.title')),
    h('p', { class: 'muted' }, t('hist.subtitle')),
    store.runs.length
      ? h(
          'ul',
          { class: 'run-list' },
          store.runs.map((run) => h('li', {}, runCard(run, { showAutomation: true })))
        )
      : h('p', { class: 'empty' }, t('hist.empty'))
  );
}

function runHeadline(run) {
  if (run.result === 'ok') return t('hist.ok');
  if (run.result === 'stopped') return t('hist.okStopped');
  const failed = run.steps.find((s) => s.status === 'failed');
  return t('hist.failed', { n: failed?.n ?? '?' });
}

function runCard(run, { showAutomation = false, inEditor = false } = {}) {
  const a = store.automations.find((x) => x.id === run.automationId);
  const kind = run.result === 'failed' ? 'fail' : 'ok';
  return h(
    'article',
    { class: ['run-card', kind] },
    h(
      'div',
      { class: 'run-head' },
      h(
        'div',
        {},
        showAutomation
          ? h(
              'div',
              { class: 'auto-name' },
              a ? a.name : `${run.automationName} (${t('hist.deleted')})`
            )
          : null,
        h(
          'div',
          { class: 'run-title' },
          h('span', { class: 'badge' }, t('run.simulated')),
          ' ',
          inEditor
            ? run.result === 'ok'
              ? t('run.ok')
              : run.result === 'stopped'
                ? t('run.stopped', { n: run.steps.find((s) => s.status === 'stopped')?.n })
                : t('run.failed', { n: run.steps.find((s) => s.status === 'failed')?.n ?? '?' })
            : runHeadline(run)
        ),
        h('div', { class: 'muted small' }, formatDateTime(run.at))
      ),
      h(
        'div',
        { class: 'row-gap' },
        a && showAutomation
          ? h('a', { class: 'btn btn-ghost', href: `#/editor/${a.id}` }, t('hist.openAutomation'))
          : null,
        a
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn-ghost',
                onclick: () => runCheck(a, { navigate: showAutomation }),
              },
              t('hist.retry')
            )
          : null
      )
    ),
    run.error ? h('p', { class: 'error-text' }, describeIssue(run.error)) : null,
    h(
      'ol',
      { class: 'step-results' },
      run.steps.map((s) => stepResultRow(s, a))
    )
  );
}

function stepResultRow(s, a) {
  const icon = { ok: '✓', stopped: '■', failed: '✕', skipped: '–', notReached: '·' }[s.status];
  const text =
    s.status === 'failed'
      ? describeIssue(s.error)
      : s.status === 'skipped'
        ? t('run.skipped')
        : s.status === 'notReached'
          ? t('run.notReached')
          : L(s.summary);
  const live = a?.nodes.find((n) => n.id === s.nodeId);
  return h(
    'li',
    { class: ['step-result', `sr-${s.status}`] },
    h('span', { class: 'sr-icon', 'aria-hidden': 'true' }, icon),
    h(
      'div',
      { class: 'sr-body' },
      h(
        'div',
        { class: 'sr-title' },
        `${t('step.n', { n: s.n })} · ${live ? nodeTitle(live) : s.title}`
      ),
      h('div', { class: 'sr-text' }, text),
      s.status === 'failed' && a
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small',
              onclick: () => {
                go(`#/editor/${a.id}`);
                setTimeout(() => openPanel(a, s.nodeId));
              },
            },
            t('hist.fix')
          )
        : null,
      s.input || s.output
        ? h(
            'details',
            { class: 'tech' },
            h('summary', {}, t('hist.tech')),
            h(
              'div',
              { class: 'tech-grid' },
              h(
                'div',
                {},
                h('div', { class: 'small muted' }, t('hist.input')),
                h('pre', { class: 'code' }, JSON.stringify(s.input, null, 2))
              ),
              h(
                'div',
                {},
                h('div', { class: 'small muted' }, t('hist.output')),
                h('pre', { class: 'code' }, JSON.stringify(s.output, null, 2))
              )
            )
          )
        : null
    )
  );
}

// ── View: Editor ──────────────────────────────────────────────────────────────

function getAutomation(id) {
  return store.automations.find((a) => a.id === id);
}

function touch(a) {
  if (a.publishedVersion > 0) a.dirty = true;
  save();
}

function viewEditor(id) {
  const a = getAutomation(id);
  if (!a) {
    return h(
      'div',
      { class: 'page' },
      h('p', { class: 'empty' }, t('ed.notFound')),
      h('a', { class: 'btn', href: '#/automations' }, t('ed.back'))
    );
  }
  const dev = store.settings.devMode;
  const dag = validateDag(a.nodes, a.edges);

  const nameInput = h('input', {
    class: 'input name-input',
    value: a.name,
    'aria-label': t('ed.nameLabel'),
    placeholder: t('ed.namePlaceholder'),
    onchange: (e) => {
      a.name = e.target.value.trim() || a.name;
      touch(a);
    },
  });

  const bar = h(
    'div',
    { class: 'editor-bar' },
    h('a', { class: 'back-link', href: '#/automations' }, `← ${t('ed.back')}`),
    nameInput,
    statusPill(a),
    h('div', { class: 'spacer' }),
    dev
      ? h(
          'span',
          {
            class: ['pill', dag.valid ? 'pill-active' : 'pill-error'],
            title: dag.valid
              ? t('ed.dagOk')
              : describeIssue({
                  key: dag.messageKey,
                  params: { path: (dag.cycle ?? []).join(' → ') },
                }),
          },
          dag.valid ? 'DAG ✓' : dag.code
        )
      : null,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-ghost',
        'aria-haspopup': 'menu',
        onclick: (e) => openVersionMenu(e.currentTarget, a),
      },
      `${t('ed.version')} ▾`
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        title: t('ed.checkHint'),
        disabled: !a.nodes.length,
        onclick: () => runCheck(a),
      },
      `▶ ${t('ed.check')}`
    ),
    a.status === 'active'
      ? a.dirty
        ? h(
            'button',
            { type: 'button', class: 'btn btn-primary', onclick: () => requestActivate(a) },
            t('ed.publish')
          )
        : h(
            'button',
            { type: 'button', class: 'btn', onclick: () => setPaused(a) },
            t('ed.disable')
          )
      : h(
          'button',
          {
            type: 'button',
            class: 'btn btn-primary',
            disabled: !a.nodes.length,
            onclick: () => requestActivate(a),
          },
          t('ed.enable')
        )
  );

  const body = h(
    'div',
    { class: ['editor-body', ui.panelNodeId && 'with-panel'] },
    h(
      'div',
      { class: 'canvas', tabindex: '-1' },
      a.nodes.length ? canvasContent(a) : emptyCanvas(a)
    ),
    ui.panelNodeId
      ? nodePanel(
          a,
          a.nodes.find((n) => n.id === ui.panelNodeId)
        )
      : null
  );

  const lastRun =
    ui.runPanelOpen && store.runs.find((r) => r.id === ui.lastRunId && r.automationId === a.id);
  return h(
    'div',
    { class: 'editor' },
    bar,
    body,
    lastRun
      ? h(
          'section',
          { class: 'run-panel', 'aria-label': t('run.title') },
          h(
            'div',
            { class: 'run-panel-head' },
            h('h2', {}, t('run.title')),
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-ghost',
                onclick: () => {
                  ui.runPanelOpen = false;
                  render();
                },
              },
              t('run.close')
            )
          ),
          runCard(lastRun, { inEditor: true })
        )
      : null
  );
}

function emptyCanvas(a) {
  return h(
    'div',
    { class: 'empty-canvas' },
    h('h2', {}, t('ed.empty')),
    h('p', { class: 'muted' }, t('ed.emptyHint')),
    h(
      'button',
      { type: 'button', class: 'btn btn-primary', onclick: () => openPicker(a, null) },
      `＋ ${t('ed.addStep')}`
    )
  );
}

function canvasContent(a) {
  const cardH = store.settings.devMode ? CARD_H + 20 : CARD_H;
  const { pos, width, height } = layout(a, cardH);
  const nums = stepNumbers(a);
  const PLUS = 56;
  const leaves = a.nodes.filter((n) => !a.edges.some((e) => e.source === n.id));
  const totalH = height + PLUS;

  const edgeLayer = svg(
    'svg',
    {
      class: 'edges',
      width,
      height: totalH,
      viewBox: `0 0 ${width} ${totalH}`,
      'aria-hidden': 'true',
    },
    a.edges.map((e) => {
      const s = pos.get(e.source);
      const d = pos.get(e.target);
      if (!s || !d) return null;
      const x1 = s.x + CARD_W / 2;
      const y1 = s.y + cardH;
      const x2 = d.x + CARD_W / 2;
      const y2 = d.y;
      const my = (y1 + y2) / 2;
      return svg('path', {
        d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`,
        class: 'edge',
      });
    }),
    leaves.map((n) => {
      const p = pos.get(n.id);
      return svg('path', {
        d: `M ${p.x + CARD_W / 2} ${p.y + cardH} L ${p.x + CARD_W / 2} ${p.y + cardH + 20}`,
        class: 'edge edge-dashed',
      });
    })
  );

  const cards = a.nodes.map((n) => {
    const p = pos.get(n.id);
    const act = ACTIONS[n.action];
    const state = nodeState(a, n, store.connections);
    const sub = nodeSubtitle(a, n);
    return h(
      'button',
      {
        type: 'button',
        class: ['node-card', ui.panelNodeId === n.id && 'selected', `ns-${state}`],
        style: { left: `${p.x}px`, top: `${p.y}px`, width: `${CARD_W}px`, height: `${cardH}px` },
        'aria-label': `${t('step.n', { n: nums.get(n.id) })}: ${nodeTitle(n)} — ${t(`step.${state}`)}`,
        onclick: () => openPanel(a, n.id),
      },
      h(
        'span',
        { class: 'node-top' },
        serviceIcon(act?.service),
        h(
          'span',
          { class: 'node-kicker' },
          `${t('step.n', { n: nums.get(n.id) })} · ${act?.kind === 'trigger' ? t('kind.trigger') : L(SERVICES[act?.service]?.name)}`
        ),
        stepStatePill(state)
      ),
      h('span', { class: 'node-title' }, nodeTitle(n)),
      h('span', { class: 'node-sub' }, sub),
      store.settings.devMode ? h('span', { class: 'node-dev' }, `${act?.type} · ${n.id}`) : null
    );
  });

  const pluses = leaves.map((n) => {
    const p = pos.get(n.id);
    return h(
      'button',
      {
        type: 'button',
        class: 'plus-btn',
        style: { left: `${p.x + CARD_W / 2 - 16}px`, top: `${p.y + cardH + 20}px` },
        'aria-label': `${t('ed.addNext')} (${nodeTitle(n)})`,
        title: t('ed.addNext'),
        onclick: () => openPicker(a, n.id),
      },
      '＋'
    );
  });

  return h(
    'div',
    { class: 'canvas-inner', style: { width: `${width}px`, height: `${totalH}px` } },
    edgeLayer,
    cards,
    pluses
  );
}

function nodeSubtitle(a, n) {
  const act = ACTIONS[n.action];
  if (!act || act.planned) return t('err.planned');
  const issues = nodeIssues(a, n, store.connections);
  if (issues.length) return describeIssue(issues[0]);
  if (a.nodeErrors?.[n.id]) return describeIssue(a.nodeErrors[n.id]);
  const first = (act.fields ?? []).find(
    (f) => f.basic && n.config?.[f.key] !== undefined && n.config[f.key] !== ''
  );
  if (!first) return L(act.desc);
  let v = n.config[first.key];
  if (first.type === 'select') v = L(first.options.find((o) => o.value === v)?.label) || v;
  return `${L(first.label)}: ${toHuman(a, String(v))}`;
}

function openVersionMenu(anchor, a) {
  const items = [
    h(
      'div',
      { class: 'menu-label' },
      a.publishedVersion ? t('ed.versionInfo', { v: a.publishedVersion }) : t('ed.versionNone')
    ),
  ];
  if (a.dirty && a.published) {
    items.push(
      h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          class: 'menu-item',
          onclick: () => {
            closePopover();
            requestActivate(a);
          },
        },
        t('ed.publish')
      ),
      h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          class: 'menu-item',
          onclick: () => {
            closePopover();
            a.nodes = structuredClone(a.published.nodes);
            a.edges = structuredClone(a.published.edges);
            a.dirty = false;
            ui.panelNodeId = null;
            save();
            toast(t('ed.reverted', { v: a.publishedVersion }));
            render();
          },
        },
        t('ed.revert', { v: a.publishedVersion })
      )
    );
  }
  if (store.settings.devMode) {
    const sum = h('code', { class: 'small' }, '…');
    graphSha256(a).then((hex) => {
      sum.textContent = `sha256:${hex.slice(0, 16)}…`;
      sum.title = hex;
    });
    items.push(
      h('div', { class: 'menu-sep' }),
      h('div', { class: 'menu-label' }, t('ed.checksum')),
      h('div', { class: 'menu-item static' }, sum)
    );
  }
  openPopover(anchor, items);
}

// ── Run / activate ────────────────────────────────────────────────────────────

function runCheck(a, { navigate = false } = {}) {
  const run = simulate(a, store.connections);
  store.runs.unshift(run);
  store.runs.length = Math.min(store.runs.length, MAX_RUNS);
  a.lastRunAt = run.at;
  const failed = run.steps.find((s) => s.status === 'failed');
  a.lastRunResult = run.result === 'failed' ? `failed:${failed?.n ?? '?'}` : run.result;
  a.nodeErrors = failed ? { [failed.nodeId]: failed.error } : {};
  const ob = store.onboarding;
  if (
    ob.status === 'in_progress' &&
    ob.step === 3 &&
    ob.automationId === a.id &&
    run.result !== 'failed'
  )
    ob.step = 4;
  save();
  ui.lastRunId = run.id;
  ui.runPanelOpen = true;
  if (navigate) go(`#/editor/${a.id}`);
  render();
  document.querySelector('.run-panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function issueList(a, issues) {
  return h(
    'ul',
    { class: 'issue-list' },
    issues.map((issue) =>
      h(
        'li',
        {},
        h(
          'span',
          {},
          issue.n ? `${t('step.n', { n: issue.n })}: ${describeIssue(issue)}` : describeIssue(issue)
        ),
        issue.nodeId
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small',
                onclick: () => {
                  closeModal();
                  if (ui.route.id !== a.id) go(`#/editor/${a.id}`);
                  setTimeout(() => openPanel(a, issue.nodeId));
                },
              },
              t('hist.fix')
            )
          : null
      )
    )
  );
}

function requestActivate(a) {
  const issues = automationIssues(a, store.connections);
  if (issues.length) {
    openModal({ title: t('ed.fixFirst'), body: issueList(a, issues) });
    return;
  }
  const external = stepOrder(a)
    .map((id) => a.nodes.find((n) => n.id === id))
    .filter((n) => !n.disabled && ACTIONS[n.action]?.external);
  const nums = stepNumbers(a);
  openModal({
    title: t('ed.activateTitle', { name: a.name }),
    body: [
      external.length
        ? [
            h('p', {}, t('ed.activateExternal')),
            h(
              'ul',
              { class: 'plain-list' },
              external.map((n) =>
                h(
                  'li',
                  {},
                  `${t('step.n', { n: nums.get(n.id) })}: ${nodeTitle(n)} — ${nodeSubtitle(a, n)}`
                )
              )
            ),
          ]
        : h('p', {}, t('ed.activateNoExternal')),
      h('p', { class: 'note' }, t('ed.activateDemo')),
    ],
    actions: [
      { label: t('ed.cancel') },
      {
        label: a.status === 'active' ? t('ed.publish') : t('ed.activateConfirm'),
        primary: true,
        onClick: () => {
          const wasActive = a.status === 'active';
          a.publishedVersion += 1;
          a.published = { nodes: structuredClone(a.nodes), edges: structuredClone(a.edges) };
          a.status = 'active';
          a.dirty = false;
          const ob = store.onboarding;
          if (ob.status === 'in_progress' && ob.step === 4 && ob.automationId === a.id) {
            ob.status = 'finishing';
            ob.hidden = false;
          }
          save();
          toast(wasActive ? t('ed.published', { v: a.publishedVersion }) : t('ed.activated'));
          render();
        },
      },
    ],
  });
}

function setPaused(a) {
  a.status = 'paused';
  save();
  toast(t('ed.paused'));
  render();
}

// ── Step picker ───────────────────────────────────────────────────────────────

function openPicker(a, parentId) {
  const triggerMode = !a.nodes.length || parentId === null;
  const list = h('div', { class: 'picker-list' });
  const fill = (query) => {
    clear(list);
    const groups = PICKER_GROUPS.filter((g) =>
      triggerMode ? g.id === 'trigger' : g.id !== 'trigger'
    );
    const matches = bestMatches(
      Object.entries(ACTIONS)
        .filter(([, act]) => groups.some((g) => g.match(act)))
        .map(([id, act]) => ({
          id,
          act,
          score: searchScore(
            query,
            `${bothLangs(act.name)} ${bothLangs(act.desc)} ${act.keywords ?? ''} ${bothLangs(SERVICES[act.service]?.name)}`
          ),
        }))
    );
    let total = 0;
    for (const g of groups) {
      const items = matches
        .filter((x) => g.match(x.act))
        .sort((x, y) => (x.act.planned ? 1 : 0) - (y.act.planned ? 1 : 0) || y.score - x.score);
      if (!items.length) continue;
      total += items.length;
      const rows = items.map(({ id, act }) =>
        h(
          'button',
          {
            type: 'button',
            class: 'picker-item',
            disabled: !!act.planned,
            onclick: () => {
              closeModal();
              addStep(a, parentId, id);
            },
          },
          serviceIcon(act.service),
          h(
            'span',
            { class: 'picker-text' },
            h('span', { class: 'picker-name' }, L(act.name)),
            h(
              'span',
              { class: 'muted small' },
              act.planned ? `${t('picker.planned')} · ${L(act.desc)}` : L(act.desc)
            )
          )
        )
      );
      const head = h('h3', { class: 'picker-group' }, t(g.label));
      if (g.id === 'dev' && !query)
        list.append(h('details', { class: 'picker-dev' }, h('summary', {}, t('cat.dev')), rows));
      else list.append(head, ...rows);
    }
    if (!total) list.append(h('p', { class: 'empty' }, t('picker.empty')));
  };
  fill('');
  openModal({
    title: triggerMode ? t('picker.titleTrigger') : t('picker.title'),
    wide: true,
    body: [
      h('input', {
        type: 'search',
        class: 'input search-input',
        placeholder: t('picker.search'),
        'aria-label': t('picker.title'),
        oninput: (e) => fill(e.target.value),
      }),
      list,
    ],
    actions: [],
  });
}

function addStep(a, parentId, actionId) {
  const act = ACTIONS[actionId];
  const base = actionId.split('.')[0].replace(/[^a-z]/g, '') || 'step';
  let n = 1;
  while (a.nodes.some((x) => x.id === `${base}_${n}`)) n++;
  const id =
    act.kind === 'trigger' && !a.nodes.some((x) => x.id === 'trigger') ? 'trigger' : `${base}_${n}`;
  a.nodes.push({
    id,
    action: actionId,
    label: '',
    config: defaultConfig(actionId),
    connectionId: autoConnection(actionId),
    disabled: false,
  });
  if (parentId) a.edges.push({ id: uid('e'), source: parentId, target: id });
  touch(a);
  openPanel(a, id);
}

// ── Node panel ────────────────────────────────────────────────────────────────

function openPanel(a, nodeId) {
  if (ui.panelDirty && ui.panelNodeId !== nodeId && !confirm(t('ed.unsavedClose'))) return;
  ui.panelNodeId = nodeId;
  ui.panelDirty = false;
  ui.panelResult = null;
  ui.focusedField = null;
  render();
  document.querySelector('.panel')?.focus();
}

function closePanel() {
  if (ui.panelDirty && !confirm(t('ed.unsavedClose'))) return;
  ui.panelNodeId = null;
  ui.panelDirty = false;
  ui.panelResult = null;
  render();
}

function nodePanel(a, node) {
  if (!node) return null;
  const act = ACTIONS[node.action];
  const service = SERVICES[act?.service];
  const nums = stepNumbers(a);
  const state = nodeState(a, node, store.connections);
  const ex = exampleContext(a);
  const controls = new Map();
  const errorEls = new Map();
  const markDirty = () => {
    ui.panelDirty = true;
  };

  const fieldControl = (f) => {
    const id = `f_${node.id}_${f.key}`;
    const val = node.config?.[f.key];
    let control;
    if (f.type === 'boolean') {
      control = h('input', {
        id,
        type: 'checkbox',
        class: 'switch',
        checked: val === true,
        onchange: markDirty,
      });
    } else if (f.type === 'select') {
      control = h(
        'select',
        { id, class: 'input', onchange: markDirty },
        f.required ? null : h('option', { value: '' }, '—'),
        f.options.map((o) =>
          h('option', { value: o.value, selected: String(val ?? '') === o.value }, L(o.label))
        )
      );
    } else if (f.type === 'json') {
      control = h('textarea', {
        id,
        class: 'input mono',
        rows: 3,
        spellcheck: 'false',
        placeholder: f.placeholder ?? '',
        value: val === undefined ? '' : JSON.stringify(val, null, 2),
        oninput: markDirty,
      });
    } else if (f.type === 'number') {
      control = h('input', {
        id,
        type: 'text',
        inputmode: 'decimal',
        class: 'input',
        value: val === undefined ? '' : String(val),
        placeholder: f.placeholder ?? '',
        oninput: markDirty,
      });
    } else {
      const shown = toHuman(a, val === undefined ? '' : String(val));
      control =
        f.type === 'textarea'
          ? h('textarea', {
              id,
              class: 'input',
              rows: 3,
              value: shown,
              placeholder: L(f.placeholder) || '',
              oninput: markDirty,
            })
          : h('input', {
              id,
              type: 'text',
              class: 'input',
              value: shown,
              placeholder: L(f.placeholder) || '',
              oninput: markDirty,
            });
    }
    if (f.acceptsData)
      control.addEventListener('focus', () => {
        ui.focusedField = control;
      });
    controls.set(f.key, control);

    const err = h('div', { class: 'field-error', id: `${id}_err`, role: 'alert' });
    errorEls.set(f.key, err);
    control.setAttribute('aria-describedby', `${id}_err`);

    let preview = null;
    if (f.acceptsData) {
      preview = h('div', { class: 'field-preview small muted' });
      const update = () => {
        const { value } = fromHuman(a, control.value);
        preview.textContent = /\{\{/.test(value)
          ? t('panel.example', { text: String(resolveValue(value, ex)) })
          : '';
      };
      control.addEventListener('input', update);
      update();
    }

    const label = h(
      'label',
      { for: id, class: 'field-label' },
      L(f.label),
      f.required ? null : h('span', { class: 'muted small' }, ` (${t('panel.optional')})`)
    );
    if (f.type === 'boolean') return h('div', { class: 'field field-inline' }, control, label, err);
    return h(
      'div',
      { class: 'field' },
      label,
      control,
      f.help ? h('div', { class: 'small muted' }, L(f.help)) : null,
      preview,
      err
    );
  };

  const fields = act?.fields ?? [];
  const basic = fields.filter((f) => f.basic);
  const advanced = fields.filter((f) => !f.basic);

  // Account
  let accountSelect = null;
  const accountBlock = service?.auth
    ? (() => {
        const conns = store.connections.filter((c) => c.service === act.service);
        accountSelect = h(
          'select',
          { id: `acc_${node.id}`, class: 'input', onchange: markDirty },
          h('option', { value: '' }, t('panel.chooseAccount')),
          conns.map((c) =>
            h('option', { value: c.id, selected: node.connectionId === c.id }, c.name)
          )
        );
        return h(
          'div',
          { class: 'field' },
          h('label', { class: 'field-label', for: `acc_${node.id}` }, t('panel.account')),
          h(
            'div',
            { class: 'row-gap' },
            accountSelect,
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-ghost',
                onclick: () =>
                  openConnect(act.service, (conn) => {
                    node.connectionId = conn.id;
                    if (a.nodeErrors) delete a.nodeErrors[node.id];
                    touch(a);
                  }),
              },
              `＋ ${t('panel.connectNew', { service: L(service.name) })}`
            )
          )
        );
      })()
    : null;

  // Data chips from upstream steps
  const upstream = stepOrder(a)
    .filter((id) => ancestorsOf(a, node.id).has(id))
    .map((id) => a.nodes.find((n) => n.id === id));
  const dataBlock = fields.some((f) => f.acceptsData)
    ? h(
        'div',
        { class: 'data-block' },
        h('div', { class: 'field-label' }, t('panel.data')),
        upstream.length
          ? [
              h('div', { class: 'small muted' }, t('panel.dataHint')),
              upstream.map((u) => {
                const outs = ACTIONS[u.action]?.outputs ?? [];
                if (!outs.length) return null;
                return h(
                  'div',
                  { class: 'data-group' },
                  h(
                    'div',
                    { class: 'small' },
                    `${t('step.n', { n: nums.get(u.id) })} · ${nodeTitle(u)}`
                  ),
                  h(
                    'div',
                    { class: 'chips' },
                    outs.map((o) =>
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'chip data-chip',
                          title: t('panel.example', { text: L(o.example) }),
                          onmousedown: (e) => e.preventDefault(),
                          onclick: () => {
                            const target =
                              ui.focusedField && document.body.contains(ui.focusedField)
                                ? ui.focusedField
                                : controls.get(fields.find((f) => f.acceptsData).key);
                            insertAtCursor(target, humanToken(nums.get(u.id), L(o.label)));
                            markDirty();
                          },
                        },
                        L(o.label)
                      )
                    )
                  )
                );
              }),
            ]
          : h('div', { class: 'small muted' }, t('panel.noData'))
      )
    : null;

  const labelInput = h('input', {
    id: `lbl_${node.id}`,
    class: 'input',
    value: node.label ?? '',
    placeholder: L(act?.name),
    oninput: markDirty,
  });
  const disabledInput = h('input', {
    id: `dis_${node.id}`,
    type: 'checkbox',
    class: 'switch',
    checked: !!node.disabled,
    onchange: markDirty,
  });

  const resultBox = h('div', { class: 'panel-result' });
  if (ui.panelResult) resultBox.append(ui.panelResult);

  const saveNode = () => {
    const raw = {};
    let ok = true;
    errorEls.forEach((el) => {
      el.textContent = '';
    });
    for (const f of fields) {
      const c = controls.get(f.key);
      let v = f.type === 'boolean' ? c.checked : c.value;
      if ((f.type === 'text' || f.type === 'textarea') && typeof v === 'string') {
        const conv = fromHuman(a, v);
        if (conv.bad.length) {
          errorEls.get(f.key).textContent = fieldErrorText('token', { token: conv.bad[0] });
          ok = false;
          continue;
        }
        v = conv.value;
      }
      raw[f.key] = v;
    }
    const config = {};
    for (const f of fields) {
      if (!(f.key in raw)) continue;
      const res = parseFieldInput(f, raw[f.key]);
      if (!res.ok) {
        errorEls.get(f.key).textContent = fieldErrorText(res.code, { reason: res.reason ?? '' });
        ok = false;
      } else if (!res.omitted) {
        config[f.key] = res.value;
      }
    }
    if (!ok) {
      resultBox.replaceChildren(h('div', { class: 'alert error' }, t('common.saveError')));
      return false;
    }
    node.config = config;
    node.label = labelInput.value.trim();
    node.disabled = disabledInput.checked;
    if (accountSelect) node.connectionId = accountSelect.value || null;
    if (a.nodeErrors) delete a.nodeErrors[node.id];
    ui.panelDirty = false;
    touch(a);
    return true;
  };

  const panel = h(
    'aside',
    { class: 'panel', tabindex: '-1', 'aria-label': nodeTitle(node) },
    h(
      'div',
      { class: 'panel-head' },
      serviceIcon(act?.service, 'lg'),
      h(
        'div',
        { class: 'panel-titles' },
        h(
          'div',
          { class: 'small muted' },
          `${t('step.n', { n: nums.get(node.id) })} · ${L(service?.name)}`
        ),
        h('h2', {}, nodeTitle(node)),
        stepStatePill(state)
      ),
      h(
        'button',
        { type: 'button', class: 'icon-btn', 'aria-label': t('panel.close'), onclick: closePanel },
        '✕'
      )
    ),
    !store.hints.panel
      ? h(
          'div',
          { class: 'hint' },
          h('strong', {}, `${t('panel.hintTitle')}: `),
          t('panel.hint'),
          ' ',
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-small',
              onclick: () => {
                store.hints.panel = true;
                save();
                render();
              },
            },
            t('panel.gotIt')
          )
        )
      : null,
    act?.planned ? h('div', { class: 'alert error' }, t('err.planned')) : null,
    accountBlock,
    h('h3', { class: 'panel-section' }, t('panel.basic')),
    basic.map(fieldControl),
    dataBlock,
    h(
      'details',
      { class: 'panel-details' },
      h('summary', {}, t('panel.advanced')),
      advanced.map(fieldControl),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field-label', for: `lbl_${node.id}` }, t('panel.stepName')),
        labelInput
      ),
      h(
        'div',
        { class: 'field field-inline' },
        disabledInput,
        h('label', { class: 'field-label', for: `dis_${node.id}` }, t('panel.disableStep'))
      )
    ),
    store.settings.devMode ? devSection(a, node, nums) : null,
    resultBox,
    h(
      'div',
      { class: 'panel-foot' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-ghost danger-text',
          onclick: () => {
            if (!confirm(t('panel.deleteConfirm', { name: nodeTitle(node) }))) return;
            deleteStep(a, node.id);
          },
        },
        t('panel.delete')
      ),
      h('div', { class: 'spacer' }),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onclick: () => {
            if (ui.panelDirty && !saveNode()) return;
            const run = simulate(a, store.connections, { until: node.id });
            const step =
              run.steps.find((s) => s.nodeId === node.id) ??
              run.steps.find((s) => s.status === 'failed');
            ui.panelResult = h(
              'div',
              { class: 'test-result' },
              h('div', { class: 'field-label' }, t('panel.testResult')),
              step ? stepResultRow(step, a) : h('p', {}, describeIssue(run.error))
            );
            render();
          },
        },
        t('panel.test')
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-primary',
          onclick: () => {
            if (!saveNode()) return;
            ui.panelResult = h('div', { class: 'alert ok' }, t('panel.saved'));
            render();
          },
        },
        t('panel.save')
      )
    )
  );
  return h(
    'div',
    { class: 'panel-wrap' },
    h('div', { class: 'panel-scrim', onclick: closePanel }),
    panel
  );
}

function insertAtCursor(el, text) {
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  el.value = before + sep + text + el.value.slice(end);
  const caret = start + sep.length + text.length;
  el.focus();
  el.setSelectionRange?.(caret, caret);
  el.dispatchEvent(new Event('input'));
}

function deleteStep(a, id) {
  const parents = parentsOf(a, id);
  const children = a.edges.filter((e) => e.source === id).map((e) => e.target);
  a.nodes = a.nodes.filter((n) => n.id !== id);
  a.edges = a.edges.filter((e) => e.source !== id && e.target !== id);
  // Keep the chain intact: reconnect the removed step's parents to its children.
  for (const p of parents)
    for (const c of children)
      if (!a.edges.some((e) => e.source === p && e.target === c))
        a.edges.push({ id: uid('e'), source: p, target: c });
  ui.panelNodeId = null;
  ui.panelDirty = false;
  touch(a);
  render();
}

/** Shortest existing path from → to (BFS), used to explain which steps would form a loop. */
function pathBetween(a, from, to) {
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const e of a.edges) {
      if (e.source === cur && !prev.has(e.target)) {
        prev.set(e.target, cur);
        queue.push(e.target);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path = [];
  for (let cur = to; cur != null; cur = prev.get(cur)) path.unshift(cur);
  return path;
}

function devSection(a, node, nums) {
  const act = ACTIONS[node.action];
  const outgoing = a.edges.filter((e) => e.source === node.id);
  const others = stepOrder(a)
    .filter((id) => id !== node.id)
    .map((id) => a.nodes.find((n) => n.id === id));
  const select = h(
    'select',
    { class: 'input', 'aria-label': t('panel.devConnect') },
    others.map((n) =>
      h('option', { value: n.id }, `${t('step.n', { n: nums.get(n.id) })} · ${nodeTitle(n)}`)
    )
  );
  const msg = h('div', { class: 'small', role: 'status' });
  return h(
    'details',
    { class: 'panel-details dev' },
    h('summary', {}, t('panel.dev')),
    h(
      'dl',
      { class: 'dev-dl' },
      h('dt', {}, t('panel.devType')),
      h('dd', {}, h('code', {}, act?.type ?? '—')),
      h('dt', {}, t('panel.devId')),
      h('dd', {}, h('code', {}, node.id))
    ),
    h('div', { class: 'field-label' }, t('panel.devConfig')),
    h(
      'pre',
      { class: 'code' },
      JSON.stringify(
        { config: node.config, connectionId: node.connectionId ?? null, disabled: !!node.disabled },
        null,
        2
      )
    ),
    h('div', { class: 'field-label' }, t('panel.devEdges')),
    outgoing.length
      ? h(
          'ul',
          { class: 'plain-list' },
          outgoing.map((e) => {
            const target = a.nodes.find((n) => n.id === e.target);
            return h(
              'li',
              { class: 'row-gap' },
              `→ ${t('step.n', { n: nums.get(e.target) })} · ${target ? nodeTitle(target) : e.target}`,
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-small',
                  onclick: () => {
                    a.edges = a.edges.filter((x) => x.id !== e.id);
                    touch(a);
                    render();
                  },
                },
                t('panel.devRemoveEdge')
              )
            );
          })
        )
      : h('p', { class: 'small muted' }, t('panel.devNoEdges')),
    others.length
      ? h(
          'div',
          { class: 'field' },
          h('div', { class: 'field-label' }, t('panel.devConnect')),
          h(
            'div',
            { class: 'row-gap' },
            select,
            h(
              'button',
              {
                type: 'button',
                class: 'btn',
                onclick: () => {
                  const target = select.value;
                  if (a.edges.some((e) => e.source === node.id && e.target === target)) return;
                  const candidate = [...a.edges, { id: uid('e'), source: node.id, target }];
                  const check = validateDag(a.nodes, candidate);
                  if (!check.valid) {
                    const loop = check.cycle ? pathBetween(a, target, node.id) : null;
                    const path = loop
                      ? [...loop, target].map((id) => nums.get(id)).join(' → ')
                      : '';
                    msg.className = 'small error-text';
                    msg.textContent = `${describeIssue({ key: check.messageKey, params: { path: path ?? '' } })} [${check.code}]`;
                    return;
                  }
                  a.edges = candidate;
                  touch(a);
                  toast(t('panel.connected'));
                  render();
                },
              },
              t('panel.devConnectBtn')
            )
          ),
          msg
        )
      : null
  );
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function openWelcome() {
  const goal = (id, catId) =>
    h(
      'button',
      {
        type: 'button',
        class: 'goal-card',
        onclick: () => {
          Object.assign(store.onboarding, {
            status: 'in_progress',
            step: 1,
            goal: id,
            automationId: null,
            hidden: false,
          });
          ui.tplCategory = catId;
          ui.tplQuery = '';
          save();
          closeModal();
          go('#/templates');
        },
      },
      h('span', { class: 'goal-title' }, t(`onb.goal.${id}`)),
      h('span', { class: 'muted small' }, t(`onb.goal.${id}Text`))
    );
  openModal({
    title: t('onb.welcomeTitle'),
    dismissible: false,
    body: [
      h('div', { class: 'welcome-top' }, h('p', {}, t('onb.welcomeText')), langSwitchForModal()),
      h(
        'div',
        { class: 'goal-grid' },
        goal('notifications', 'notifications'),
        goal('sheets', 'all'),
        goal('ai', 'ai'),
        goal('custom', 'all')
      ),
      h('p', { class: 'note' }, t('demo.banner')),
    ],
    actions: [
      {
        label: t('onb.skip'),
        onClick: () => {
          store.onboarding.status = 'skipped';
          save();
          render();
        },
      },
    ],
  });
}

function langSwitchForModal() {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': t('lang.label') },
    ['ru', 'en'].map((l) =>
      h(
        'button',
        {
          type: 'button',
          class: ['seg-btn', getLocale() === l && 'active'],
          'aria-pressed': String(getLocale() === l),
          onclick: () => {
            store.settings.lang = l;
            save();
            closeModal();
            render();
          },
        },
        l.toUpperCase()
      )
    )
  );
}

function advanceOnboarding() {
  const ob = store.onboarding;
  if (ob.status !== 'in_progress') return;
  const a = ob.automationId && getAutomation(ob.automationId);
  if (ob.step > 1 && !a) {
    Object.assign(ob, { step: 1, automationId: null });
    save();
    return;
  }
  if (ob.step === 2 && automationIssues(a, store.connections).length === 0) {
    ob.step = 3;
    save();
  }
}

function renderTour() {
  const root = clear($('tourRoot'));
  const ob = store.onboarding;
  if (ob.status === 'finishing') {
    root.append(
      h(
        'aside',
        { class: 'tour', 'aria-live': 'polite' },
        h(
          'div',
          { class: 'tour-progress' },
          [1, 2, 3, 4].map(() => h('span', { class: 'dot done' }))
        ),
        h('p', {}, t('onb.done')),
        h(
          'div',
          { class: 'row-gap' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn-primary',
              onclick: () => {
                ob.status = 'done';
                save();
                render();
              },
            },
            t('onb.close')
          )
        )
      )
    );
    return;
  }
  if (ob.status !== 'in_progress' || ob.hidden) return;
  root.append(
    h(
      'aside',
      { class: 'tour', 'aria-live': 'polite', 'aria-label': t('onb.progress', { n: ob.step }) },
      h(
        'div',
        { class: 'tour-head' },
        h('span', { class: 'small muted' }, t('onb.progress', { n: ob.step })),
        h(
          'div',
          { class: 'tour-progress' },
          [1, 2, 3, 4].map((i) =>
            h('span', { class: ['dot', i < ob.step && 'done', i === ob.step && 'current'] })
          )
        )
      ),
      h('p', {}, t(`onb.s${ob.step}`)),
      h(
        'div',
        { class: 'row-gap' },
        ob.step === 1 && ui.route.view !== 'templates'
          ? h('a', { class: 'btn btn-primary', href: '#/templates' }, t('onb.goTemplates'))
          : null,
        ob.step > 1 && ob.automationId && ui.route.id !== ob.automationId
          ? h(
              'a',
              { class: 'btn btn-primary', href: `#/editor/${ob.automationId}` },
              t('list.open')
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost',
            onclick: () => {
              ob.hidden = true;
              save();
              render();
            },
          },
          t('onb.hide')
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost',
            onclick: () => {
              ob.status = 'skipped';
              save();
              render();
            },
          },
          t('onb.skip')
        )
      )
    )
  );
}

// ── Start ─────────────────────────────────────────────────────────────────────

parseRoute();
render();
