/**
 * OpenNodes — editor. On GitHub Pages it is the public demo (simulation only); served
 * by the OpenNodes web server it runs against the real API (see live.js).
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
  setLiveMode,
} from './i18n.js';
import * as live from './live.js';
import { tokenField, parseExpr, buildExpr } from './tokens.js';
import { attachCanvas, isTyping } from './canvas.js';
import {
  tagCategories,
  listChoices,
  listSource,
  choiceFor,
  targetInfo,
  valueKind,
  GROUPS,
} from './tags.js';
import { markdownNodes } from './markdown.js';
import { savePreset, applyPreset, presetStatus, PRESET_KINDS } from './presets.js';
import {
  ACTIONS,
  SERVICES,
  SERVICE_ORDER,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  PICKER_GROUPS,
  SYNONYMS,
  isDevAction,
  postFields,
  voiceText,
  systemPrompt,
  userPrompt,
  askedLanguage,
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

// Live mode keeps only per-browser preferences locally; everything else is on the server.
const STORE_KEY = live.isLive ? 'opennodes.app.v1' : 'opennodes.demo.v2';
setLiveMode(live.isLive);
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
    voicePresets: [],
    promptPresets: [],
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.version === 2 && live.isLive)
        return {
          ...defaultStore(),
          settings: { ...defaultStore().settings, ...data.settings },
          onboarding: data.onboarding ?? defaultStore().onboarding,
          hints: data.hints ?? {},
          voicePresets: Array.isArray(data.voicePresets) ? data.voicePresets : [],
          promptPresets: Array.isArray(data.promptPresets) ? data.promptPresets : [],
        };
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
    const { automations, connections, runs, ...prefs } = store;
    localStorage.setItem(STORE_KEY, JSON.stringify(live.isLive ? prefs : store));
  } catch {
    /* private mode: the demo still works for this session */
  }
  if (live.isLive) live.scheduleSync(store, showApiError);
}

function showApiError(err) {
  toast(t('live.saveFailed', { message: err?.message ?? String(err) }), 'error');
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
  /** Live mode before the workspace is loaded: 'loading' | 'login' | 'setup' | 'offline'. */
  auth: live.isLive ? 'loading' : null,
  authError: null,
  busy: false,
  triggerInfo: null,
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
  ui.triggerInfo = null;
  parseRoute();
  render();
  $('view').focus({ preventScroll: true });
});

document.addEventListener('keydown', (e) => {
  // Canvas shortcuts: only in the editor, never while typing or with a dialog open.
  if (
    ui.route.view === 'editor' &&
    ui.canvas &&
    !isTyping(e.target) &&
    !document.querySelector('.modal-backdrop, .popover')
  ) {
    const mod = e.metaKey || e.ctrlKey;
    const a = getAutomation(ui.route.id);
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (a) (e.shiftKey ? redo : undo)(a);
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (a) redo(a);
      return;
    }
    if (!mod && !e.altKey) {
      const act = { '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', 0: 'reset', f: 'fit', F: 'fit' }[
        e.key
      ];
      if (act) {
        e.preventDefault();
        ui.canvas[act]();
        return;
      }
    }
  }
  if (e.key !== 'Escape') return;
  if (hintEl) return hideHint();
  if (document.querySelector('.modal-backdrop')) closeModal();
  else if (document.querySelector('.popover')) closePopover();
  else if (ui.panelNodeId) closePanel();
});

// ── Render root ───────────────────────────────────────────────────────────────

function render() {
  hideHint();
  applySettings();
  if (ui.auth) return renderAuth();
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
    ui.afterRender?.();
    ui.afterRender = null;
  } else view.append(viewAutomations());
  renderTour();
  if (store.onboarding.status === 'new' && !document.querySelector('.modal-backdrop'))
    openWelcome();
}

function renderBanner() {
  $('demoBanner').hidden = live.isLive;
  if (live.isLive) return;
  clear($('demoBanner')).append(
    h('span', { class: 'demo-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'banner-long' }, t('demo.banner')),
    h('span', { class: 'banner-short' }, t('demo.bannerShort'))
  );
}

function renderHeader() {
  const nav = [
    ['automations', 'nav.automations', 'nav.automationsShort'],
    ['templates', 'nav.templates', 'nav.templates'],
    ['connections', 'nav.connections', 'nav.connections'],
    ['history', 'nav.history', 'nav.history'],
  ];
  const current = ui.route.view === 'editor' ? 'automations' : ui.route.view;
  clear($('appHeader')).append(
    h(
      'a',
      { class: 'brand', href: '#/automations', 'aria-label': 'OpenNodes' },
      h('img', { src: './logo-mark.svg', alt: '', class: 'brand-logo' }),
      h('span', { class: 'brand-title' }, 'OpenNodes')
    ),
    // Element.append() would print null as text, so the badge is spread in or not at all.
    ...(live.isLive
      ? []
      : [h('span', { class: 'demo-badge', title: t('demo.noRealRun') }, t('demo.badge'))]),
    h(
      'nav',
      { class: 'main-nav', 'aria-label': t('nav.main') },
      nav.map(([id, key, short]) =>
        h(
          'a',
          {
            href: `#/${id}`,
            class: ['nav-link', current === id && 'active'],
            'aria-current': current === id ? 'page' : null,
            'data-hint': id === 'automations' ? null : `nav.${id}`,
          },
          h('span', { class: 'nav-long' }, t(key)),
          h('span', { class: 'nav-short', 'aria-hidden': 'true' }, t(short))
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
      'data-hint': 'profile',
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
    live.session.user
      ? h('div', { class: 'menu-label' }, t('auth.signedInAs', { email: live.session.user.email }))
      : null,
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
            for (const k of Object.keys(store.hints))
              if (k.startsWith('hover.')) delete store.hints[k];
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
    live.isLive
      ? h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: 'menu-item',
            onclick: async () => {
              closePopover();
              await live.signOut().catch(() => {});
              signedOut();
            },
          },
          t('auth.logout')
        )
      : null,
    live.isLive
      ? null
      : h(
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
  // Below the anchor when it fits, otherwise above it (e.g. a field at the bottom of a panel).
  const below = rect.bottom + 6 + pop.offsetHeight <= window.innerHeight - 8;
  const top = below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - pop.offsetHeight);
  Object.assign(pop.style, { top: `${top}px`, left: `${left}px` });
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
      class: ['modal-card', opts.wide && 'wide', opts.size && `modal-${opts.size}`],
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
    .sort(
      (x, y) =>
        // Templates that can be used now come before the ones still waiting for an integration.
        (x.tpl.planned?.length ? 1 : 0) - (y.tpl.planned?.length ? 1 : 0) ||
        y.score - x.score ||
        (y.tpl.recommended ? 1 : 0) - (x.tpl.recommended ? 1 : 0)
    )
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
      // A template that cannot run yet offers details only, not a disabled primary button.
      planned
        ? null
        : h(
            'button',
            {
              type: 'button',
              class: 'btn btn-primary',
              'data-hint': 'useTemplate',
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
  // The server keys automations by UUID; the editor creates them before saving.
  if (live.isLive && prefix === 'wf') return crypto.randomUUID();
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
  const a = newAutomation(getLocale() === 'ru' ? 'Новый сценарий' : 'New automation');
  go(`#/editor/${a.id}`);
}

// ── View: My automations (home) ───────────────────────────────────────────────

function viewAutomations() {
  const grid = h('div', { class: 'tpl-grid' });
  const fill = () => {
    const list = filterTemplates(ui.homeQuery, ui.homeCategory).slice(0, ui.homeQuery ? 6 : 3);
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

  const hasOwn = store.automations.length > 0;
  const discover = [
    h(
      'section',
      { class: ['hero', hasOwn && 'hero-compact'] },
      hasOwn
        ? h('h2', { class: 'section-title' }, t('home.titleMore'))
        : h('h1', { class: 'page-title' }, t('home.title')),
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
          hasOwn
            ? null
            : h(
                'button',
                { type: 'button', class: 'btn', onclick: createBlank },
                `＋ ${t('home.fromScratch')}`
              )
        )
      ),
      grid
    ),
  ];
  // Returning users come for their own automations: those go first.
  const mine = hasOwn
    ? h(
        'section',
        { class: 'block block-first' },
        h(
          'div',
          { class: 'block-head' },
          h('h1', { class: 'page-title' }, t('home.mine')),
          h(
            'button',
            { type: 'button', class: 'btn', onclick: createBlank },
            `＋ ${t('home.fromScratch')}`
          )
        ),
        h('ul', { class: 'auto-list' }, store.automations.map(automationRow))
      )
    : null;

  return h('div', { class: 'page' }, mine, discover);
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
  if (result === 'running') return t('hist.running');
  if (result === 'waiting') return t('hist.waiting');
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
  const visible = SERVICE_ORDER.filter(
    (id) =>
      store.settings.devMode || !SERVICES[id].dev || store.connections.some((c) => c.service === id)
  );
  // Cards only for services that take an account; the rest are one compact line each.
  const accounts = visible.filter((id) => SERVICES[id].auth && !SERVICES[id].planned);
  const free = visible.filter((id) => !SERVICES[id].auth && !SERVICES[id].planned);
  const planned = visible.filter((id) => SERVICES[id].planned);
  const compact = (ids) =>
    h(
      'ul',
      { class: 'svc-chips' },
      ids.map((id) => h('li', { class: 'svc-chip' }, serviceIcon(id, 'sm'), L(SERVICES[id].name)))
    );
  const cards = accounts.map((id) => {
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
      actions = [
        ...conns.map((c) =>
          h(
            'div',
            { class: 'conn-line' },
            h('span', { class: 'conn-name' }, c.name),
            h(
              'div',
              { class: 'row-gap' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-small',
                  'data-hint': 'connCheck',
                  onclick: () => (live.isLive ? checkLiveConnection(c) : toast(t('conn.checkOk'))),
                },
                t('conn.check')
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-ghost btn-small danger-text',
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
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => openConnect(id) },
          `＋ ${t('conn.addAnother')}`
        ),
      ];
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
    h('div', { class: 'conn-grid' }, cards),
    free.length
      ? h(
          'section',
          { class: 'block' },
          h('h2', {}, t('conn.freeTitle')),
          h('p', { class: 'muted small' }, t('conn.freeText')),
          compact(free)
        )
      : null,
    planned.length
      ? h(
          'section',
          { class: 'block' },
          h('h2', {}, t('conn.plannedTitle')),
          h('p', { class: 'muted small' }, t('conn.plannedText')),
          compact(planned)
        )
      : null
  );
}

function openConnect(serviceId, onDone) {
  if (live.isLive) return openLiveConnect(serviceId, onDone);
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
  // Live: runs keep arriving from schedules and bots; refresh when the page is shown.
  if (live.isLive && Date.now() - (ui.runsAt ?? 0) > 3000) {
    ui.runsAt = Date.now();
    live
      .reloadRuns(store)
      .then(() => ui.route.view === 'history' && render())
      .catch(() => {});
  }
  const runs = live.isLive ? store.runs.filter((r) => r.kind !== 'test') : store.runs;
  return h(
    'div',
    { class: 'page' },
    h('h1', { class: 'page-title' }, t('hist.title')),
    h('p', { class: 'muted' }, t('hist.subtitle')),
    runs.length
      ? h(
          'ul',
          { class: 'run-list' },
          runs.map((run) => h('li', {}, runCard(run, { showAutomation: true })))
        )
      : h('p', { class: 'empty' }, t('hist.empty'))
  );
}

function runHeadline(run) {
  if (run.result === 'running') return t('hist.running');
  if (run.result === 'waiting') return t('hist.waiting');
  if (run.result === 'ok') return t('hist.ok');
  if (run.result === 'stopped') return t('hist.okStopped');
  const failed = run.steps.find((s) => s.status === 'failed');
  return t('hist.failed', { n: failed?.n ?? '?' });
}

function runBadge(run) {
  if (!run.live) return t('run.simulated');
  return run.kind === 'test' ? t('run.test') : t(`run.trigger.${run.kind}`);
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
          h('span', { class: 'badge' }, runBadge(run)),
          ' ',
          inEditor
            ? run.result === 'running' || run.result === 'waiting'
              ? t('run.inProgress')
              : run.result === 'ok'
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
  const icon = {
    ok: '✓',
    stopped: '■',
    failed: '✕',
    skipped: '–',
    notReached: '·',
    running: '…',
    waiting: '⏸',
  }[s.status];
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

/** Where steps sit on the canvas is layout, not logic: saving it does not mark a change. */
function savePositions() {
  save();
}

// ── Undo / redo (per automation, this session) ────────────────────────────────

const snapshot = (a) => JSON.stringify({ nodes: a.nodes, edges: a.edges });

/** Call before changing the graph, so Cmd/Ctrl+Z can bring this state back. */
function checkpoint(a) {
  if (ui.history?.id !== a.id) ui.history = { id: a.id, past: [], future: [] };
  ui.history.past.push(snapshot(a));
  if (ui.history.past.length > 50) ui.history.past.shift();
  ui.history.future = [];
}

function restore(a, snap) {
  const { nodes, edges } = JSON.parse(snap);
  a.nodes = nodes;
  a.edges = edges;
  if (ui.panelNodeId && !a.nodes.some((n) => n.id === ui.panelNodeId)) ui.panelNodeId = null;
  ui.panelDirty = false;
  touch(a);
  render();
}

function undo(a) {
  const h = ui.history;
  if (h?.id !== a.id || !h.past.length) return;
  h.future.push(snapshot(a));
  restore(a, h.past.pop());
}

function redo(a) {
  const h = ui.history;
  if (h?.id !== a.id || !h.future.length) return;
  h.past.push(snapshot(a));
  restore(a, h.future.pop());
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

  // Sized to the name, so the status sits right next to it rather than mid-bar.
  const fitName = (el) => (el.size = Math.min(48, Math.max(12, el.value.length + 2)));
  const nameInput = h('input', {
    class: 'input name-input',
    value: a.name,
    size: Math.min(48, Math.max(12, a.name.length + 2)),
    'aria-label': t('ed.nameLabel'),
    placeholder: t('ed.namePlaceholder'),
    oninput: (e) => fitName(e.target),
    onchange: (e) => {
      a.name = e.target.value.trim() || a.name;
      touch(a);
    },
  });

  // Title on the left (it wraps as a unit), actions on the right (they stay in one row).
  const bar = h(
    'div',
    { class: 'editor-bar' },
    h(
      'div',
      { class: 'editor-title' },
      h('a', { class: 'back-link', href: '#/automations', 'aria-label': t('ed.back') }, '←'),
      h(
        'label',
        { class: 'name-field', 'data-hint': 'rename' },
        nameInput,
        h('span', { class: 'name-pencil', 'aria-hidden': 'true' }, '✎')
      ),
      h('span', { 'data-hint': 'status' }, statusPill(a))
    ),
    h(
      'div',
      { class: 'editor-actions' },
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
          'data-hint': 'version',
          onclick: (e) => openVersionMenu(e.currentTarget, a),
        },
        `${t('ed.version')} ▾`
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          'data-hint': 'check',
          disabled: !a.nodes.length || ui.busy,
          onclick: () => runCheck(a),
        },
        ui.busy ? `… ${t('ed.check')}` : `▶ ${t('ed.check')}`
      ),
      live.isLive && a.status === 'active' && triggerOf(a)?.action === 'manual.run'
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn',
              disabled: ui.busy,
              onclick: () => liveRunNow(a),
            },
            `⏵ ${t('ed.runNow')}`
          )
        : null,
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
              'data-hint': 'enable',
              onclick: () => requestActivate(a),
            },
            t('ed.enable')
          )
    )
  );

  const body = h(
    'div',
    { class: ['editor-body', ui.panelNodeId && 'with-panel'] },
    a.nodes.length ? canvasView(a) : h('div', { class: 'canvas canvas-empty' }, emptyCanvas(a)),
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
    live.isLive ? triggerStatusLine(a) : null,
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

// ── Canvas: free layout, pan/zoom, drag, connect, quick add ───────────────────

const GRID = 8;
const snap = (v) => Math.round(v / GRID) * GRID;

/** Steps without a saved position get the automatic layout once (old automations). */
function ensurePositions(a, cardH) {
  if (a.nodes.every((n) => n.position)) return;
  const { pos } = layout(a, cardH);
  for (const n of a.nodes) n.position ??= { ...(pos.get(n.id) ?? { x: 0, y: 0 }) };
  savePositions(a);
}

function graphBounds(a, cardH) {
  if (!a.nodes.length) return null;
  const xs = a.nodes.map((n) => n.position.x);
  const ys = a.nodes.map((n) => n.position.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs) + CARD_W,
    maxY: Math.max(...ys) + cardH + 56,
  };
}

const viewKey = (id) => `opennodes.view.${id}`;
function loadView(id) {
  try {
    const v = JSON.parse(localStorage.getItem(viewKey(id)) ?? 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.z) ? v : null;
  } catch {
    return null;
  }
}
function saveView(id, view) {
  try {
    localStorage.setItem(viewKey(id), JSON.stringify(view));
  } catch {
    /* private mode: the view is not remembered */
  }
}

function edgePath(a, cardH, e) {
  const s = a.nodes.find((n) => n.id === e.source)?.position;
  const d = a.nodes.find((n) => n.id === e.target)?.position;
  if (!s || !d) return null;
  const x1 = s.x + CARD_W / 2;
  const y1 = s.y + cardH;
  const x2 = d.x + CARD_W / 2;
  const y2 = d.y;
  const bend = Math.max(40, Math.abs(y2 - y1) / 2);
  return {
    d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`,
    mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
  };
}

function canvasView(a) {
  const cardH = store.settings.devMode ? CARD_H + 20 : CARD_H;
  ensurePositions(a, cardH);
  const nums = stepNumbers(a);
  const leaves = a.nodes.filter((n) => !a.edges.some((e) => e.source === n.id));

  const edgeGroup = svg('g');
  const preview = svg('path', { class: 'connect-preview' });
  const edgeLayer = svg(
    'svg',
    { class: 'edges', width: 1, height: 1, 'aria-hidden': 'true' },
    edgeGroup,
    preview
  );
  const edgePluses = h('div', { class: 'edge-pluses' });

  const drawEdges = () => {
    clear(edgeGroup);
    clear(edgePluses);
    for (const e of a.edges) {
      const p = edgePath(a, cardH, e);
      if (!p) continue;
      // A context step (a brand voice) gives settings, not data: a dashed line, no “insert”.
      const context = ACTIONS[a.nodes.find((n) => n.id === e.source)?.action]?.kind === 'context';
      edgeGroup.append(
        svg('path', { d: p.d, class: context ? 'edge edge-context' : 'edge' }),
        svg('path', {
          d: p.d,
          class: 'edge-hit',
          'data-edge-id': e.id,
          onclick: (ev) => openEdgeMenu(a, e, ev),
        })
      );
      if (context) continue;
      edgePluses.append(
        h(
          'button',
          {
            type: 'button',
            class: 'edge-plus',
            style: { left: `${p.mid.x - 11}px`, top: `${p.mid.y - 11}px` },
            'aria-label': t('cv.insertHere'),
            title: t('cv.insertHere'),
            'data-edge-id': e.id,
            onclick: () =>
              openPicker(a, e.source, {
                insertEdge: e,
                position: { x: snap(p.mid.x - CARD_W / 2), y: snap(p.mid.y - cardH / 2) },
              }),
          },
          '＋'
        )
      );
    }
    for (const n of leaves) {
      const p = n.position;
      edgeGroup.append(
        svg('path', {
          d: `M ${p.x + CARD_W / 2} ${p.y + cardH} L ${p.x + CARD_W / 2} ${p.y + cardH + 20}`,
          class: 'edge edge-dashed',
        })
      );
    }
  };

  const cardEls = new Map();
  const place = (n) => {
    const els = cardEls.get(n.id);
    if (!els) return;
    els.card.style.left = `${n.position.x}px`;
    els.card.style.top = `${n.position.y}px`;
    els.handle.style.left = `${n.position.x + CARD_W / 2 - 7}px`;
    els.handle.style.top = `${n.position.y + cardH - 7}px`;
    if (els.plus) {
      els.plus.style.left = `${n.position.x + CARD_W / 2 - 16}px`;
      els.plus.style.top = `${n.position.y + cardH + 20}px`;
    }
  };

  const world = h('div', { class: 'canvas-world' }, edgeLayer, edgePluses);
  for (const n of a.nodes) {
    const act = ACTIONS[n.action];
    const state = nodeState(a, n, store.connections);
    const card = h(
      'button',
      {
        type: 'button',
        class: [
          'node-card',
          ui.panelNodeId === n.id && 'selected',
          `ns-${state}`,
          act?.kind === 'context' && 'node-context',
        ],
        style: { width: `${CARD_W}px`, height: `${cardH}px` },
        'data-node-id': n.id,
        'aria-label': `${t('step.n', { n: nums.get(n.id) })}: ${nodeTitle(n)} — ${t(`step.${state}`)}`,
        'data-hint': 'node',
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
      h('span', { class: 'node-sub' }, nodeSubtitle(a, n)),
      store.settings.devMode ? h('span', { class: 'node-dev' }, `${act?.type} · ${n.id}`) : null
    );
    const handle = h('div', {
      class: 'out-handle',
      'data-out-handle': n.id,
      title: t('cv.dragToConnect'),
      'data-hint': 'connect',
    });
    const plus = leaves.includes(n)
      ? h(
          'button',
          {
            type: 'button',
            class: 'plus-btn',
            'aria-label': `${t('ed.addNext')} (${nodeTitle(n)})`,
            'data-hint': 'addStep',
            onclick: () => openPicker(a, n.id),
          },
          '＋'
        )
      : null;
    cardEls.set(n.id, { card, handle, plus });
    world.append(...[card, handle, plus].filter(Boolean));
    place(n);
  }
  drawEdges();

  const zoomLabel = h('span', {}, '100%');
  const toolbar = h(
    'div',
    {
      class: 'canvas-toolbar',
      role: 'toolbar',
      'aria-label': t('cv.toolbar'),
      'data-hint': 'canvasNav',
    },
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: t('cv.zoomOut'),
        'aria-label': t('cv.zoomOut'),
        onclick: () => ui.canvas?.zoomOut(),
      },
      '−'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'zoom-label',
        title: t('cv.reset'),
        onclick: () => ui.canvas?.reset(),
      },
      zoomLabel
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: t('cv.zoomIn'),
        'aria-label': t('cv.zoomIn'),
        onclick: () => ui.canvas?.zoomIn(),
      },
      '+'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: t('cv.fit'),
        'aria-label': t('cv.fit'),
        onclick: () => ui.canvas?.fit(),
      },
      '⤢'
    ),
    h('span', { class: 'toolbar-sep' }),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: t('cv.undo'),
        'aria-label': t('cv.undo'),
        disabled: !(ui.history?.id === a.id && ui.history.past.length),
        onclick: () => undo(a),
      },
      '↶'
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'icon-btn',
        title: t('cv.redo'),
        'aria-label': t('cv.redo'),
        disabled: !(ui.history?.id === a.id && ui.history.future.length),
        onclick: () => redo(a),
      },
      '↷'
    )
  );

  const viewport = h('div', { class: 'canvas', tabindex: '-1' }, world, toolbar);
  viewport.addEventListener('canvas:view', (e) => {
    zoomLabel.textContent = `${Math.round(e.detail.z * 100)}%`;
  });

  ui.afterRender = () => {
    ui.canvas = attachCanvas(viewport, world, {
      view: ui.views?.[a.id] ?? loadView(a.id),
      bounds: () => graphBounds(a, cardH),
      onView: (view) => {
        (ui.views ??= {})[a.id] = view;
        saveView(a.id, view);
      },
      onEmptyClick: (pt, client) => {
        if (ui.panelNodeId) return closePanel();
        openPicker(a, null, {
          at: client,
          position: { x: snap(pt.x - CARD_W / 2), y: snap(pt.y - 20) },
        });
      },
      onNodeDragStart: () => checkpoint(a),
      onNodeDrag: (id, dx, dy) => {
        const n = a.nodes.find((x) => x.id === id);
        if (!n) return;
        n.position = { x: n.position.x + dx, y: n.position.y + dy };
        place(n);
        drawEdges();
      },
      onNodeDragEnd: (id) => {
        const n = a.nodes.find((x) => x.id === id);
        if (n) n.position = { x: snap(n.position.x), y: snap(n.position.y) };
        savePositions(a);
        // After the click that ends the drag, which the old canvas still has to swallow.
        setTimeout(render);
      },
      connectPreview: (from, to) => {
        preview.setAttribute('d', from && to ? `M ${from.x} ${from.y} L ${to.x} ${to.y}` : '');
      },
      onConnect: (source, target) => connectSteps(a, source, target),
    });
  };
  return viewport;
}

/** A connection drawn from one step's dot to another step. */
function connectSteps(a, source, target) {
  if (!target || target === source) return;
  if (ACTIONS[a.nodes.find((n) => n.id === target)?.action]?.kind === 'trigger') {
    toast(t('cv.triggerNoInput'), 'error');
    return;
  }
  if (a.edges.some((e) => e.source === source && e.target === target)) return;
  const edges = [...a.edges, { id: uid('e'), source, target }];
  const check = validateDag(a.nodes, edges);
  if (!check.valid) {
    toast(
      check.code === 'ERR_CYCLIC_DEPENDENCY_DETECTED' ? t('cv.cycle') : t(check.messageKey),
      'error'
    );
    return;
  }
  checkpoint(a);
  a.edges = edges;
  linkContext(a, source, target);
  touch(a);
  render();
}

/** Which context step an AI step's field takes: its “voice” or its “prompt”. */
const CONTEXT_FIELD = { voice: 'context.voice', prompt: 'context.prompt' };

/** Context steps of one kind before this one, for the AI step's choice. */
function contextChoices(a, node, type) {
  const up = ancestorsOf(a, node.id);
  return a.nodes.filter((n) => up.has(n.id) && n.action === type);
}

const voiceExpr = (id) => `{{ $nodes.${id}.output }}`;

/**
 * A context step drawn to an AI step that has none of its kind yet becomes that step's
 * voice or template. A template whose data is per item makes the AI step go per item too.
 */
function linkContext(a, source, target) {
  const from = a.nodes.find((n) => n.id === source);
  const to = a.nodes.find((n) => n.id === target);
  const fieldKey = Object.keys(CONTEXT_FIELD).find((k) => CONTEXT_FIELD[k] === from?.action);
  const toAct = ACTIONS[to?.action];
  if (!fieldKey || !toAct?.fields?.some((f) => f.key === fieldKey && f.type === fieldKey)) return;
  if (to.config?.[fieldKey]) return;
  to.config = { ...to.config, [fieldKey]: voiceExpr(source) };
  if (fieldKey === 'prompt' && from.config?.forEach && toAct.forEach && !to.config.forEach)
    to.config.forEach = from.config.forEach;
}

function openEdgeMenu(a, edge, ev) {
  const anchor = h('span', {
    class: 'click-anchor',
    style: { left: `${ev.clientX}px`, top: `${ev.clientY}px` },
  });
  document.body.append(anchor);
  openPopover(anchor, [
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item',
        onclick: () => {
          closePopover();
          const s = a.nodes.find((n) => n.id === edge.source)?.position;
          const d = a.nodes.find((n) => n.id === edge.target)?.position;
          openPicker(a, edge.source, {
            insertEdge: edge,
            ...(s && d && { position: { x: snap((s.x + d.x) / 2), y: snap((s.y + d.y) / 2) } }),
          });
        },
      },
      t('cv.insertHere')
    ),
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item danger',
        onclick: () => {
          closePopover();
          checkpoint(a);
          a.edges = a.edges.filter((e) => e.id !== edge.id);
          touch(a);
          render();
        },
      },
      t('cv.deleteEdge')
    ),
  ]);
  anchor.remove();
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
  if (live.isLive) return liveCheck(a, { navigate });
  recordCheck(a, simulate(a, store.connections), { navigate });
}

function recordCheck(a, run, { navigate = false } = {}) {
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
      a.nodes.some((n) => n.action === 'webhook.receive') && live.isLive
        ? h('p', { class: 'small' }, `${t('ed.webhookUrl')}: `, h('code', {}, live.webhookUrl(a)))
        : null,
    ],
    actions: [
      { label: t('ed.cancel') },
      {
        label: a.status === 'active' ? t('ed.publish') : t('ed.activateConfirm'),
        primary: true,
        onClick: () => {
          if (live.isLive) return liveActivate(a);
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
  if (live.isLive) {
    live
      .setActive(store, a, false)
      .then(() => {
        toast(t('ed.paused'));
        render();
      })
      .catch(showApiError);
    return;
  }
  a.status = 'paused';
  save();
  toast(t('ed.paused'));
  render();
}

// ── Step picker ───────────────────────────────────────────────────────────────

/** Steps most people reach for first; shown above the catalog when nothing is typed. */
const FREQUENT_ACTIONS = [
  'telegram.sendMessage',
  'ai.process',
  'text.compose',
  'logic.filter',
  'logic.delay',
  'http.request',
];

/**
 * The step catalog: a dialog, or (`opts.at`) a compact menu at the click point.
 * `opts.position` places the new step there; `opts.insertEdge` puts it between two steps.
 */
function openPicker(a, parentId, opts = {}) {
  const hasTrigger = a.nodes.some((n) => ACTIONS[n.action]?.kind === 'trigger');
  const triggerMode = !hasTrigger && (!a.nodes.length || parentId === null);
  const list = h('div', { class: 'picker-list' });
  const choose = (id) => {
    if (opts.at) closePopover();
    else closeModal();
    addStep(a, parentId, id, opts);
  };
  const quickRow = (id) => {
    const act = ACTIONS[id];
    return h(
      'button',
      { type: 'button', class: 'picker-item', onclick: () => choose(id) },
      serviceIcon(act.service),
      h('span', { class: 'picker-text' }, h('span', { class: 'picker-name' }, L(act.name)))
    );
  };
  const fill = (query) => {
    clear(list);
    if (!query.trim() && !triggerMode) {
      const recent = (store.settings.recentActions ?? []).filter(
        (id) => ACTIONS[id] && !ACTIONS[id].planned && ACTIONS[id].kind !== 'trigger'
      );
      if (recent.length)
        list.append(
          h('h3', { class: 'picker-group' }, t('picker.recent')),
          ...recent.map(quickRow)
        );
      const frequent = FREQUENT_ACTIONS.filter(
        (id) => ACTIONS[id] && !ACTIONS[id].planned && !recent.includes(id)
      );
      if (frequent.length)
        list.append(
          h('h3', { class: 'picker-group' }, t('picker.frequent')),
          ...frequent.map(quickRow)
        );
    }
    const groups = PICKER_GROUPS.filter((g) =>
      triggerMode ? g.id === 'trigger' : g.id !== 'trigger'
    );
    const matches = bestMatches(
      Object.entries(ACTIONS)
        .filter(([, act]) => groups.some((g) => g.match(act)))
        .map(([id, act]) => ({
          id,
          act,
          // A word in the step's own name counts more than a synonym in its description.
          score:
            searchScore(
              query,
              `${bothLangs(act.name)} ${bothLangs(act.desc)} ${act.keywords ?? ''} ${bothLangs(SERVICES[act.service]?.name)}`
            ) + (query.trim() ? 0.5 * searchScore(query, bothLangs(act.name)) : 0),
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
            onclick: () => choose(id),
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
            ),
            // What the step needs and what it gives — to choose without adding it first.
            act.needs
              ? h(
                  'span',
                  { class: 'picker-io small' },
                  h('span', {}, h('b', {}, `${t('picker.needs')}: `), L(act.needs)),
                  h('span', {}, h('b', {}, `${t('picker.gives')}: `), L(act.gives))
                )
              : null
          )
        )
      );
      const sub = {
        trigger: 'kind.triggerSub',
        action: 'kind.actionSub',
        context: 'kind.contextSub',
        logic: 'kind.logicSub',
        dev: 'cat.devSub',
      }[g.id];
      const head = h(
        'h3',
        { class: 'picker-group' },
        t(g.label),
        sub ? h('span', { class: 'picker-group-sub' }, ` — ${t(sub)}`) : null
      );
      if (g.id === 'dev' && !query)
        list.append(h('details', { class: 'picker-dev' }, h('summary', {}, t('cat.dev')), rows));
      else list.append(head, ...rows);
    }
    if (!total) list.append(h('p', { class: 'empty' }, t('picker.empty')));
  };
  fill('');
  const search = h('input', {
    type: 'search',
    class: 'input search-input',
    placeholder: t('picker.search'),
    'aria-label': t('picker.title'),
    oninput: (e) => fill(e.target.value),
    onkeydown: (e) => {
      // Arrows walk the list, Enter takes the first match.
      const items = [...list.querySelectorAll('.picker-item:not(:disabled)')];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[0]?.click();
      }
    },
  });
  list.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll('.picker-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[Math.min(i + 1, items.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (i <= 0 ? search : items[i - 1]).focus();
    }
  });
  if (opts.at) {
    const anchor = h('span', {
      class: 'click-anchor',
      style: { left: `${opts.at.x}px`, top: `${opts.at.y}px` },
    });
    document.body.append(anchor);
    openPopover(anchor, [
      h(
        'div',
        { class: 'quick-add' },
        h(
          'div',
          { class: 'menu-label' },
          triggerMode ? t('picker.titleTrigger') : t('picker.title')
        ),
        search,
        list
      ),
    ]);
    anchor.remove();
    search.focus();
    return;
  }
  openModal({
    title: triggerMode ? t('picker.titleTrigger') : t('picker.title'),
    wide: true,
    body: [search, list],
    actions: [],
  });
}

function addStep(a, parentId, actionId, opts = {}) {
  checkpoint(a);
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
    position: opts.position ?? positionBelow(a, parentId),
  });
  if (opts.insertEdge) {
    // Between two steps: source → new → target, in one undoable change.
    const e = opts.insertEdge;
    a.edges = a.edges.filter((x) => x.id !== e.id);
    a.edges.push({ id: uid('e'), source: e.source, target: id });
    a.edges.push({ id: uid('e'), source: id, target: e.target });
    makeRoom(a, id, e.source, e.target);
  } else if (parentId) {
    a.edges.push({ id: uid('e'), source: parentId, target: id });
  } else if (act.kind !== 'trigger' && a.nodes.length > 1) {
    toast(t('cv.addedUnlinked'));
  }
  store.settings.recentActions = [
    actionId,
    ...(store.settings.recentActions ?? []).filter((x) => x !== actionId),
  ].slice(0, 5);
  touch(a);
  openPanel(a, id);
}

/**
 * A step inserted between two others gets its own row: it moves below the source, and
 * the target with everything after it moves down when they would overlap.
 */
function makeRoom(a, id, sourceId, targetId) {
  const gap = 48;
  const at = (nid) => a.nodes.find((n) => n.id === nid)?.position;
  const p = at(id);
  const src = at(sourceId);
  if (!p) return;
  if (src && p.y < src.y + CARD_H + gap) p.y = snap(src.y + CARD_H + gap);
  const tgt = at(targetId);
  const shift = tgt ? snap(p.y + CARD_H + gap - tgt.y) : 0;
  if (shift <= 0) return;
  const after = new Set([targetId]);
  for (const nid of after) {
    for (const e of a.edges) if (e.source === nid && e.target !== id) after.add(e.target);
  }
  for (const nid of after) {
    const q = at(nid);
    if (q) q.y += shift;
  }
}

/** A free spot under a step (or the top for a first step). */
function positionBelow(a, parentId) {
  const parent = a.nodes.find((n) => n.id === parentId)?.position;
  const base = parent ? { x: parent.x, y: parent.y + CARD_H + 96 } : { x: 0, y: 0 };
  const taken = (p) =>
    a.nodes.some(
      (n) =>
        n.position && Math.abs(n.position.x - p.x) < CARD_W && Math.abs(n.position.y - p.y) < CARD_H
    );
  const pos = { ...base };
  for (let i = 1; taken(pos) && i < 20; i++)
    pos.x = base.x + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (CARD_W + 32);
  return pos;
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

/**
 * What an RSS step remembers (“only new items”) and a button to forget it — after a series
 * of tests, to see the newest items again. The server keeps the memory; the demo has none.
 */
function rssMemoryBlock(a, node) {
  const line = h('span', { class: 'small muted' }, t('rss.memoryDemo'));
  const reset = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      disabled: !live.isLive,
      onclick: async () => {
        if (!confirm(t('rss.resetConfirm'))) return;
        try {
          await live.flushSync(store);
          await live.api(
            'DELETE',
            `/workflows/${a.id}/rss-memory?nodeId=${encodeURIComponent(node.id)}`
          );
          toast(t('rss.resetDone'));
          show(0);
        } catch (err) {
          showApiError(err);
        }
      },
    },
    t('rss.reset')
  );
  const show = (n) => {
    line.textContent = n ? t('rss.memoryCount', { n }) : t('rss.memoryEmpty');
  };
  if (live.isLive) {
    live
      .api('GET', `/workflows/${a.id}/rss-memory`)
      .then((r) => show(r.nodes?.[node.id] ?? 0))
      .catch(() => (line.textContent = ''));
  }
  return h(
    'div',
    { class: 'field rss-memory' },
    h('div', { class: 'field-label' }, t('rss.memory')),
    h('div', { class: 'row-gap', style: { flexWrap: 'wrap', alignItems: 'center' } }, line, reset)
  );
}

/** The voice library: load a saved voice, save this one (a new version), update to the latest. */
function presetBlock(a, node, saveNode) {
  const kind = PRESET_KINDS[node.action];
  const prefix = node.action === 'context.prompt' ? 'pt' : 'vp';
  const list = store[kind.store] ?? [];
  const status = presetStatus(list, node.config, kind.keys);
  const apply = (preset) => {
    checkpoint(a);
    node.config = applyPreset(node.config, preset, kind.keys);
    ui.panelDirty = false;
    touch(a);
    render();
  };
  const select = h(
    'select',
    { class: 'input', 'aria-label': t('vp.choose') },
    h('option', { value: '' }, list.length ? t('vp.choose') : t(`${prefix}.empty`)),
    list.map((p) =>
      h(
        'option',
        { value: p.id, selected: p.id === node.config?.presetId },
        `${p.name} · v${p.versions.at(-1).version}`
      )
    )
  );
  const load = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      disabled: !list.length,
      onclick: () => {
        const preset = list.find((p) => p.id === select.value);
        if (!preset) return;
        if (ui.panelDirty && !confirm(t('vp.loadConfirm'))) return;
        apply(preset);
      },
    },
    t('vp.load')
  );
  const saveBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-small',
      onclick: () => {
        if (!saveNode()) return;
        const res = savePreset(store[kind.store] ?? [], node.config, {
          id: node.config?.presetId ?? null,
          keys: kind.keys,
        });
        store[kind.store] = res.list;
        node.config = { ...node.config, ...res.link };
        touch(a);
        toast(t('vp.saved', { name: res.preset.name, v: res.link.presetVersion }));
        render();
      },
    },
    status.preset ? t('vp.saveVersion') : t('vp.save')
  );
  const line = status.preset
    ? h(
        'p',
        { class: 'small muted' },
        t('vp.linked', { name: status.preset.name, v: node.config.presetVersion }),
        status.edited ? ` ${t('vp.edited')}` : '',
        status.newer
          ? h(
              'span',
              { class: 'fe-nudge' },
              ` ${t('vp.newer', { v: status.latest })} `,
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn-small',
                  onclick: () => {
                    if (status.edited && !confirm(t('vp.loadConfirm'))) return;
                    apply(status.preset);
                  },
                },
                t('vp.update')
              )
            )
          : null
      )
    : h('p', { class: 'small muted' }, t(`${prefix}.help`));
  return h(
    'div',
    { class: 'field voice-presets' },
    h('div', { class: 'field-label' }, t(`${prefix}.title`)),
    line,
    h('div', { class: 'row-gap', style: { flexWrap: 'wrap' } }, select, load, saveBtn)
  );
}

/** “What the model gets”: the AI step's system and user messages, built as the server does. */
function modelPromptBlock(a, node, controls) {
  const warn = h('p', { class: 'small fe-nudge', hidden: true });
  const sys = h('pre', { class: 'prompt-preview' });
  const user = h('pre', { class: 'prompt-preview' });
  const update = () => {
    const voiceVal = controls.get('voice')?.value ?? node.config?.voice ?? '';
    const voiceNode = a.nodes.find((n) => voiceExpr(n.id) === voiceVal);
    const voice = voiceNode ? voiceText(voiceNode.config ?? {}) : '';
    const promptVal = controls.get('prompt')?.value ?? node.config?.prompt ?? '';
    const promptNode = a.nodes.find((n) => voiceExpr(n.id) === promptVal);
    const instruction = [
      promptNode ? previewTemplate(a, promptNode.config?.template ?? '').trim() : '',
      previewTemplate(a, controls.get('instruction')?.value ?? '').trim(),
    ]
      .filter(Boolean)
      .join('\n\n');
    const data = previewTemplate(a, controls.get('input')?.value ?? '').trim();
    sys.textContent = systemPrompt(voice);
    user.textContent = clipText(
      userPrompt(instruction || '…', data, '', Boolean(ui.panelForEach?.())),
      2000
    );
    const want = askedLanguage(instruction);
    const has = askedLanguage(voiceNode?.config?.language);
    warn.hidden = !(want && has && want !== has);
    warn.textContent = t('voice.conflict');
  };
  const holder = h('span', { hidden: true });
  holder._updatePreview = update;
  controls.set('__modelPrompt', holder);
  return h(
    'details',
    { class: 'panel-details model-prompt' },
    h('summary', {}, t('voice.preview')),
    warn,
    h('div', { class: 'field-label' }, t('voice.system')),
    sys,
    h('div', { class: 'field-label' }, t('voice.user')),
    user
  );
}

/** A step's fields, plus “for each item” on steps that can repeat and have a list before them. */
function stepFields(a, node, act) {
  const base = act?.fields ?? [];
  // A template's data may be per item: it says which list, the AI step fills it per item.
  if (act?.itemVars) {
    if (!listChoices(a, node).length && !node.config?.forEach) return base;
    return [
      {
        key: 'forEach',
        type: 'forEach',
        required: false,
        noOptionalMark: true,
        basic: true,
        label: t('pt.feLabel'),
        help: t('pt.feHelp'),
        onceKey: 'pt.feOnce',
        eachKey: 'pt.feEach',
        noNudge: true,
      },
      ...base,
    ];
  }
  if (!act?.forEach || (!listChoices(a, node).length && !node.config?.forEach)) return base;
  return [
    {
      key: 'forEach',
      type: 'forEach',
      required: false,
      noOptionalMark: true, // a choice with a default, not something to fill in
      basic: true,
      label: t('fe.label'),
      help: t('fe.help'),
    },
    ...base,
    {
      key: 'forEachLimit',
      type: 'number',
      required: false,
      basic: false,
      label: t('fe.limit'),
      help: t('fe.limitHelp'),
      placeholder: '10',
    },
  ];
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
  const refreshPreviews = () => controls.forEach((c) => c._updatePreview?.());
  // The data picker reads the step's unsaved state: which list it repeats for, other fields.
  ui.panelForEach = () => controls.get('forEach')?.value ?? node.config?.forEach ?? '';
  ui.panelControls = controls;
  ui.panelChanged = () => {
    markDirty();
    refreshPreviews();
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
        // Unset (a switch added after the step was made) means its default, not “off”.
        checked: (val ?? f.default) === true,
        onchange: markDirty,
      });
    } else if (f.type === 'forEach') {
      const choices = listChoices(a, node);
      // A saved raw list (RSS items) moves up to the output that also has what the steps in
      // between added (the AI's words) — the same items, nothing lost.
      const chosen = val ? choiceFor(a, node, val) : null;
      const current = chosen?.expr ?? val;
      if (chosen && chosen.expr !== val) queueMicrotask(markDirty);
      const known = !val || Boolean(chosen);
      control = h(
        'select',
        {
          id,
          class: 'input',
          onchange: () => {
            markDirty();
            refreshPreviews();
            forEachHelp();
          },
        },
        h('option', { value: '' }, t(f.onceKey ?? 'fe.once')),
        choices.map((c) =>
          h(
            'option',
            { value: c.expr, selected: current === c.expr },
            t(f.eachKey ?? 'fe.each', { list: L(c.label) })
          )
        ),
        known ? null : h('option', { value: val, selected: true }, t('tok.deleted'))
      );
    } else if (f.type === 'select') {
      control = h(
        'select',
        { id, class: 'input', onchange: markDirty },
        f.required ? null : h('option', { value: '' }, '—'),
        f.options.map((o) =>
          h('option', { value: o.value, selected: String(val ?? '') === o.value }, L(o.label))
        )
      );
    } else if (f.type === 'voice' || f.type === 'prompt') {
      const choices = contextChoices(a, node, CONTEXT_FIELD[f.type]);
      const known = !val || choices.some((n) => voiceExpr(n.id) === val);
      control = h(
        'select',
        {
          id,
          class: 'input',
          onchange: () => {
            markDirty();
            refreshPreviews();
          },
        },
        h(
          'option',
          { value: '' },
          choices.length ? t(`${f.type}.none`) : t(`${f.type}.noneLinked`)
        ),
        choices.map((n) =>
          h(
            'option',
            { value: voiceExpr(n.id), selected: val === voiceExpr(n.id) },
            n.config?.name || nodeTitle(n)
          )
        ),
        known ? null : h('option', { value: val, selected: true }, t('tok.deleted'))
      );
    } else if (f.type === 'connections') {
      // Several connections of one service, e.g. the MCP servers an agent may use.
      const chosen = new Set(Array.isArray(val) ? val : []);
      const conns = store.connections.filter((c) => c.service === f.service);
      control = h(
        'div',
        { id, class: 'conn-picks', role: 'group' },
        conns.length
          ? conns.map((c) =>
              h(
                'label',
                { class: 'conn-pick' },
                h('input', {
                  type: 'checkbox',
                  class: 'switch',
                  value: c.id,
                  checked: chosen.has(c.id),
                  onchange: markDirty,
                }),
                c.name
              )
            )
          : h('p', { class: 'small muted' }, t('panel.noConnectionsYet')),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost btn-small',
            onclick: () =>
              openConnect(f.service, (conn) => {
                node.config = {
                  ...node.config,
                  [f.key]: [...(Array.isArray(val) ? val : []), conn.id],
                };
                touch(a);
              }),
          },
          `＋ ${t('panel.connectNew', { service: L(SERVICES[f.service].name) })}`
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
    } else if (f.acceptsData) {
      // Data fields show tokens as chips; the value stays a plain template.
      control = tokenField({
        id,
        value: val === undefined ? '' : String(val),
        multiline: f.type === 'textarea',
        placeholder: L(f.placeholder) || '',
        describe: (expr) => describeToken(a, expr),
        onChange: () => {
          markDirty();
          refreshPreviews();
        },
        onChipClick: (chip, field) => openTokenMenu(a, node, chip, field),
        onOpenPicker: (field) => openDataPicker(a, node, field, { fieldKey: f.key }),
      });
      control._fieldKey = f.key;
      control._fieldLabel = L(f.label);
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
      const target = targetInfo(node, f.key);
      preview = h('div', { class: 'field-preview small muted' });
      const update = () => {
        const value = control.value;
        if (!target.rich) {
          preview.textContent = /\{\{/.test(value)
            ? t('panel.example', { text: clipText(previewTemplate(a, value), 300) })
            : '';
          return;
        }
        // Posts: how it will look, formatting and picture included.
        clear(preview);
        if (!value.trim()) return;
        const image = target.imageField
          ? previewTemplate(a, controls.get(target.imageField)?.value ?? '').trim()
          : '';
        preview.append(
          h(
            'div',
            { class: 'post-preview-label' },
            t(ui.panelForEach?.() ? 'post.previewEach' : 'post.preview')
          ),
          h(
            'div',
            { class: 'post-preview' },
            /^https?:\/\/\S+$/.test(image)
              ? h('img', {
                  class: 'post-preview-img',
                  src: image,
                  alt: t('post.previewImage'),
                  loading: 'lazy',
                  referrerpolicy: 'no-referrer',
                })
              : null,
            h(
              'div',
              { class: 'post-preview-text' },
              markdownNodes(clipText(previewTemplate(a, value), 1500))
            )
          )
        );
      };
      control._updatePreview = update;
    }

    const label = h(
      'label',
      { for: id, class: 'field-label' },
      L(f.label),
      f.required || f.noOptionalMark
        ? null
        : h('span', { class: 'muted small' }, ` (${t('panel.optional')})`)
    );
    const labelRow =
      f.acceptsData && hasUpstream
        ? h(
            'div',
            { class: 'field-label-row' },
            label,
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-small data-btn',
                'data-hint': 'addData',
                onmousedown: (e) => e.preventDefault(),
                onclick: () => openDataPicker(a, node, control, { fieldKey: f.key }),
              },
              t('panel.addData')
            )
          )
        : label;
    if (f.type === 'boolean')
      return h('div', { class: 'field field-inline', 'data-field': f.key }, control, label, err);
    const help = f.help ? h('div', { class: 'small muted' }, L(f.help)) : null;
    if (f.type === 'forEach' && !f.noNudge) {
      forEachHelp = () => {
        const src = listSource(a, control.value);
        const first = listChoices(a, node)[0];
        help.classList.toggle('fe-nudge', !src);
        help.textContent = src
          ? L(f.help)
          : t('fe.nudge', { n: listSource(a, first?.root)?.n ?? '?' });
      };
      forEachHelp();
    }
    return h('div', { class: 'field', 'data-field': f.key }, labelRow, control, help, preview, err);
  };
  let forEachHelp = () => {};
  const hasUpstream = ancestorsOf(a, node.id).size > 0;

  const fields = stepFields(a, node, act);
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

  // Data from earlier steps is inserted with "+ Data" on each field (or the { key).
  const dataBlock =
    fields.some((f) => f.acceptsData) && hasUpstream
      ? h('p', { class: 'small muted data-hint-line' }, t('panel.dataPickerHint'))
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
  queueMicrotask(refreshPreviews); // previews read other fields (the picture), so after all exist
  // Fields that matter only for some choices (“N characters” only for “Cut”) hide otherwise.
  const applyShowIf = () => {
    for (const f of fields) {
      if (!f.showIf) continue;
      const box = document.querySelector(`.panel [data-field="${f.key}"]`);
      if (!box) continue;
      box.hidden = !Object.entries(f.showIf).every(([dep, values]) => {
        const c = controls.get(dep);
        if (!c) return true;
        const v = c.type === 'checkbox' ? c.checked : c.value;
        return values.includes('*') ? Boolean(v) : values.includes(v);
      });
    }
  };
  queueMicrotask(applyShowIf);

  const saveNode = () => {
    const raw = {};
    let ok = true;
    errorEls.forEach((el) => {
      el.textContent = '';
    });
    for (const f of fields) {
      const c = controls.get(f.key);
      let v =
        f.type === 'boolean'
          ? c.checked
          : f.type === 'connections'
            ? [...c.querySelectorAll('input:checked')].map((i) => i.value)
            : c.value;
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
      // “What to do” is not needed when a Prompt Template gives the instruction.
      const field = f.requiredUnless && raw[f.requiredUnless] ? { ...f, required: false } : f;
      const res = parseFieldInput(field, raw[f.key]);
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
    // A brand voice remembers which library preset and version it was copied from.
    if (act?.kind === 'context')
      for (const k of ['presetId', 'presetVersion'])
        if (node.config?.[k] !== undefined) config[k] = node.config[k];
    checkpoint(a);
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
    node.action === 'webhook.receive'
      ? h(
          'div',
          { class: 'field' },
          h('div', { class: 'field-label' }, t('ed.webhookUrl')),
          live.isLive
            ? h('code', { class: 'small webhook-url' }, live.webhookUrl(a))
            : h('div', { class: 'small' }, t('ed.webhookUrlDemo')),
          h('div', { class: 'small muted' }, live.isLive ? t('ed.webhookUrlHint') : null),
          h('div', { class: 'small muted' }, t('ed.webhookFields'))
        )
      : null,
    basic.length ? h('h3', { class: 'panel-section' }, t('panel.basic')) : null,
    basic.map(fieldControl),
    act?.type === 'core.rss' ? rssMemoryBlock(a, node) : null,
    act?.type === 'ai.process' ? modelPromptBlock(a, node, controls) : null,
    PRESET_KINDS[act?.type] ? presetBlock(a, node, saveNode) : null,
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
          onclick: async () => {
            if (ui.panelDirty && !saveNode()) return;
            const run = live.isLive
              ? await live
                  .flushSync(store, showApiError)
                  .then(() => live.testRun(a, node.id))
                  .catch((err) => ({
                    steps: [],
                    error: { key: 'err.server', params: { message: err.message } },
                  }))
              : simulate(a, store.connections, { until: node.id });
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
  panel.addEventListener('change', applyShowIf);
  return h(
    'div',
    { class: 'panel-wrap' },
    h('div', { class: 'panel-scrim', onclick: closePanel }),
    panel
  );
}

// ── Data tokens: chips, picker, formats ───────────────────────────────────────

// No “first N characters”: a text is never cut mid-sentence. Old chips with it still work.
const FORMATS = ['', 'upper', 'lower', 'trim'];
const fmtLabel = (fmt) =>
  fmt.startsWith('first:') ? t('fmt.first', { n: fmt.slice(6) }) : t(`fmt.${fmt || 'none'}`);

const clipText = (s, n) => {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

const pad2 = (n) => String(n).padStart(2, '0');
function systemSample(key) {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return {
    dateTime: `${date} ${time}`,
    date,
    time,
    dateRu: `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`,
    weekday: new Intl.DateTimeFormat('ru', { weekday: 'long' }).format(d),
    dayMonth: new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(d),
    monthName: new Intl.DateTimeFormat('ru', { month: 'long' }).format(d),
    year: String(d.getFullYear()),
    id: 'a1b2c3d4-…',
    triggerType: 'cron',
  }[key];
}

/**
 * A sample of the item a step repeats for (“for each item”): the first item of the list
 * in the latest run, else the step's demo data, else the fields' examples.
 */
function itemSample(a, outputs = lastOutputs(a), expr = ui.panelForEach?.() ?? '') {
  const src = listSource(a, expr);
  if (!src) return null;
  const real = outputs.get(src.node.id)?.[src.key];
  if (Array.isArray(real) && real[0] && typeof real[0] === 'object') return real[0];
  const examples = Object.fromEntries(src.fields.map((f) => [f.key, L(f.example)]));
  const demo = (key) => {
    try {
      return ACTIONS[src.node.action]?.simulate?.(src.node.config ?? {})?.output?.[key];
    } catch {
      return undefined; // a sample is a nicety; never break the panel over it
    }
  };
  // Items of a step that itself repeats: the list it repeats for, plus what it added.
  if (src.key === 'items' && src.node.config?.forEach) {
    const inner = itemSample(a, outputs, src.node.config.forEach) ?? {};
    return postFields({ ...examples, ...inner }, String(demo('text') ?? examples.result ?? ''));
  }
  const list = demo(src.key);
  const base = Array.isArray(list) && list[0] && typeof list[0] === 'object' ? list[0] : {};
  return { ...examples, ...base };
}

/** Output of each step in the automation's latest run or test, by step id. */
function lastOutputs(a) {
  const run = store.runs.find((r) => r.automationId === a.id && r.steps?.some((s) => s.output));
  return new Map((run?.steps ?? []).map((s) => [s.nodeId, s.output]));
}

function applyFmt(value, fmt) {
  const s =
    typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  if (fmt === 'upper') return s.toUpperCase();
  if (fmt === 'lower') return s.toLowerCase();
  if (fmt === 'trim') return s.trim();
  if (fmt.startsWith('first:')) return s.slice(0, Number(fmt.slice(6)));
  return s;
}

/** A sample of what a token gives: from the latest run when there is one, else the catalog example. */
function tokenSample(a, p, outputs = lastOutputs(a)) {
  if (p.scope === 'now' || p.scope === 'run') return systemSample(p.key);
  if (p.scope === 'item') return itemSample(a, outputs)?.[p.key];
  const node =
    p.scope === 'trigger'
      ? a.nodes.find((n) => ACTIONS[n.action]?.kind === 'trigger')
      : a.nodes.find((n) => n.id === p.nodeId);
  if (!node) return undefined;
  const out = outputs.get(node.id);
  const real = p.scope === 'trigger' ? (out?.payload?.[p.key] ?? out?.[p.key]) : out?.[p.key];
  if (real !== undefined) return real;
  const ex = ACTIONS[node.action]?.outputs?.find((o) => o.key === p.key)?.example;
  return ex === undefined ? undefined : L(ex);
}

function previewTemplate(a, template) {
  const outputs = lastOutputs(a);
  return String(template).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, expr) => {
    const p = parseExpr(expr);
    if (!p) return m;
    const v = tokenSample(a, p, outputs);
    return v === undefined ? '' : applyFmt(v, p.fmt);
  });
}

function tokenSourceNode(a, p) {
  if (p.scope === 'trigger') return a.nodes.find((n) => ACTIONS[n.action]?.kind === 'trigger');
  if (p.scope === 'nodes') return a.nodes.find((n) => n.id === p.nodeId);
  return null;
}

/** How a chip looks: icon, step number, name; broken when its step is gone. */
/** A chip: its look, plus a color for pictures and links so they stand out in the text. */
function describeToken(a, expr) {
  const d = describeTokenBase(a, expr);
  const kind = d.broken ? '' : valueKind(expr);
  if (!kind) return d;
  return { ...d, kind, icon: h('span', { class: 'token-sys' }, kind === 'image' ? '🖼' : '🔗') };
}

function describeTokenBase(a, expr) {
  const p = parseExpr(expr);
  if (!p) {
    return {
      icon: h('span', { class: 'token-sys' }, '{ }'),
      step: null,
      label: clipText(expr, 40),
      title: expr,
    };
  }
  const suffix = p.fmt ? ` · ${fmtLabel(p.fmt)}` : '';
  if (p.scope === 'now' || p.scope === 'run') {
    return {
      icon: h('span', { class: 'token-sys' }, p.scope === 'now' ? '◷' : '▶'),
      step: null,
      label: t(`tok.${p.scope}.${p.key}`) + suffix,
      title: `${t(`tok.${p.scope}.${p.key}`)}\n${t('panel.example', { text: systemSample(p.key) })}`,
    };
  }
  if (p.scope === 'item') {
    const field = listSource(a, ui.panelForEach?.() ?? '')?.fields.find((f) => f.key === p.key);
    const name = field ? L(field.label) : p.key;
    const sample = tokenSample(a, p);
    return {
      icon: h('span', { class: 'token-sys' }, '◆'),
      step: null,
      label: `${t('tok.item')}: ${name}${suffix}`,
      title:
        `${t('tok.item')} · ${name}` +
        (sample !== undefined
          ? `\n${t('panel.example', { text: clipText(applyFmt(sample, p.fmt), 200) })}`
          : ''),
    };
  }
  const node = tokenSourceNode(a, p);
  const nums = stepNumbers(a);
  const out = node && ACTIONS[node.action]?.outputs?.find((o) => o.key === p.key);
  if (!node || !nums.has(node.id)) {
    return {
      icon: h('span', { class: 'token-sys' }, '⚠'),
      step: null,
      label: t('tok.deleted'),
      title: t('tok.deletedHint'),
      broken: true,
    };
  }
  const name = out ? L(out.label) : t('tok.field', { key: p.key });
  const sample = tokenSample(a, p);
  return {
    icon: serviceIcon(ACTIONS[node.action]?.service, 'xs'),
    step: nums.get(node.id),
    label: name + suffix,
    title:
      `${t('step.n', { n: nums.get(node.id) })} · ${nodeTitle(node)} · ${name}` +
      (sample !== undefined
        ? `\n${t('panel.example', { text: clipText(applyFmt(sample, p.fmt), 200) })}`
        : ''),
  };
}

/**
 * The data picker: a large window with categories on the left — ready-made posts, the
 * current item, each earlier step, date and time, the run, formatting — and cards with a
 * live preview on the right. `opts.replace` (a chip) swaps that chip for one value.
 */
function openDataPicker(a, node, field, opts = {}) {
  const fieldKey = opts.fieldKey ?? field._fieldKey;
  const replace = opts.replace ?? null;
  const target = targetInfo(node, fieldKey);
  const outputs = lastOutputs(a);
  // Keys the steps really gave in the latest run: a form's own fields, for instance.
  const seenKeys = {};
  for (const [id, out] of outputs) {
    const n = a.nodes.find((x) => x.id === id);
    const data = ACTIONS[n?.action]?.kind === 'trigger' ? (out?.payload ?? out) : out;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      seenKeys[id] = Object.keys(data).filter((k) => /^\w+$/.test(k) && k !== 'simulated');
    }
  }
  const build = () =>
    tagCategories(a, node, {
      fieldKey,
      forEach: ui.panelForEach?.() ?? '',
      seenKeys,
      useAi: ui.pickerUseAi !== false,
      short: ui.pickerShort === true,
      dev: Boolean(store.settings.devMode),
    }).map((c) => ({
      ...c,
      entries: replace
        ? c.entries.filter((e) => e.kind === 'data' || e.kind === 'custom')
        : c.entries,
    }));
  let cats = build();
  const howto = { id: 'howto', title: { ru: t('dpick.howto'), en: t('dpick.howto') }, icon: '?' };
  // Favourites (★ on a card) are kept for every automation; shown first when there are some.
  const favs = new Set(store.settings.favoriteTags ?? []);
  const favCat = () => {
    const seen = new Set();
    const entries = cats
      .flatMap((c) => c.entries)
      .filter((e) => favs.has(e.fav) && !seen.has(e.fav) && seen.add(e.fav))
      .map((e) => ({ ...e, group: 'fav' }));
    return {
      id: 'fav',
      title: { ru: t('dpick.favorites'), en: t('dpick.favorites') },
      icon: '★',
      entries,
    };
  };
  const toggleFav = (e) => {
    if (favs.has(e.fav)) favs.delete(e.fav);
    else favs.add(e.fav);
    store.settings.favoriteTags = [...favs];
    save();
    rebuild();
  };
  let all = [];
  const rebuild = () => {
    const fav = favCat();
    const fit = cats.filter((c) => c.id === 'fit' && c.entries.length);
    all = [
      ...fit,
      ...(fav.entries.length ? [fav] : []),
      ...cats.filter((c) => c.id !== 'fit' && c.entries.length),
      howto,
    ];
    if (!all.some((c) => c.id === current)) current = all[0]?.id ?? 'howto';
    renderNav();
    renderMain();
  };
  // Open on what fits this field, else the current item, else favourites, else the first.
  let current =
    ['fit', 'item'].find((id) => cats.some((c) => c.id === id && c.entries.length)) ??
    (favs.size ? 'fav' : (cats.find((c) => c.entries.length)?.id ?? 'howto'));
  let query = '';

  const entryTitle = (e) => (e.i18nKey ? t(e.i18nKey) : L(e.title));
  const sampleOf = (e) => {
    if (e.kind === 'snippet') return e.template;
    if (e.kind === 'custom') return L(e.hint);
    if (e.kind === 'data') {
      const p = parseExpr(e.expr);
      const v = p ? tokenSample(a, p, outputs) : undefined;
      return v === undefined ? (e.sample ? L(e.sample) : undefined) : v;
    }
    return previewTemplate(a, e.template);
  };

  const pick = (e) => {
    if (e.kind === 'custom') {
      // A field the form sends that the editor does not know: by its name.
      askText(
        {
          title: entryTitle(e),
          label: t('tok.fieldName'),
          help: t('tok.fieldNameHelp'),
          value: '',
        },
        (name) => {
          if (!/^\w+$/.test(name)) return false;
          const expr = buildExpr({ scope: 'trigger', nodeId: null, key: name });
          if (replace) field.replaceToken(replace, expr);
          else field.insertToken(expr);
          ui.panelChanged?.();
        }
      );
      return;
    }
    closeModal();
    if (replace) {
      field.replaceToken(replace, e.expr);
      return;
    }
    // A picture in a message's text would only be its address: it goes to the picture field.
    const pictureField = target.imageField && ui.panelControls?.get(target.imageField);
    if (
      e.kind === 'data' &&
      valueKind(e.expr) === 'image' &&
      pictureField &&
      fieldKey !== target.imageField
    ) {
      pictureField.value = `{{ ${e.expr} }}`;
      ui.panelChanged?.();
      toast(t('dpick.toPicture'));
      return;
    }
    if (e.kind === 'data') field.insertToken(e.expr);
    else field.insertTemplate(e.template);
    for (const [key, value] of Object.entries(e.extra ?? {})) {
      const other = ui.panelControls?.get(key);
      if (other) other.value = value;
    }
    ui.panelChanged?.();
  };

  const card = (e) => {
    if (e.group === 'emoji') return cardButton(e);
    const on = favs.has(e.fav);
    return h(
      'div',
      { class: 'tag-cell' },
      cardButton(e),
      h(
        'button',
        {
          type: 'button',
          class: ['tag-star', on && 'on'],
          'aria-pressed': String(on),
          title: t(on ? 'dpick.unfavorite' : 'dpick.favorite'),
          'aria-label': t(on ? 'dpick.unfavorite' : 'dpick.favorite'),
          onclick: () => toggleFav(e),
        },
        on ? '★' : '☆'
      )
    );
  };
  const cardButton = (e) => {
    const sample = sampleOf(e);
    const text = typeof sample === 'object' && sample !== null ? JSON.stringify(sample) : sample;
    const imageKey = Object.keys(e.extra ?? {})[0];
    // A block that fills the picture, or a value that is a picture: show it.
    const image = imageKey
      ? previewTemplate(a, e.extra[imageKey]).trim()
      : e.kind === 'data' && /\.(image|postImage)$/.test(e.expr ?? '') && typeof text === 'string'
        ? text.trim()
        : '';
    const imageLabel = imageKey
      ? (ACTIONS[node.action]?.fields ?? []).find((f) => f.key === imageKey)?.label
      : null;
    return h(
      'button',
      {
        type: 'button',
        class: [
          'tag-card',
          `tag-${e.kind}`,
          e.group === 'emoji' && 'tag-emoji',
          e.kind === 'data' && valueKind(e.expr) && `tag-kind-${valueKind(e.expr)}`,
        ],
        title: imageKey ? t('dpick.fillsImage', { field: L(imageLabel) }) : entryTitle(e),
        onclick: () => pick(e),
      },
      e.group === 'emoji'
        ? e.template
        : [
            h(
              'span',
              { class: 'tag-card-head' },
              h('span', { class: 'tag-card-title' }, entryTitle(e)),
              imageKey ? h('span', { class: 'tag-badge' }, t('dpick.withImage')) : null
            ),
            h(
              'span',
              { class: 'tag-card-preview' },
              /^https?:\/\/\S+$/.test(image)
                ? h('img', {
                    class: 'tag-card-img',
                    src: image,
                    alt: '',
                    loading: 'lazy',
                    referrerpolicy: 'no-referrer',
                  })
                : null,
              text === undefined || text === ''
                ? h('span', { class: 'muted' }, t('dpick.noSample'))
                : target.rich
                  ? markdownNodes(clipText(text, 260))
                  : clipText(text, 160)
            ),
          ]
    );
  };

  // Whose words the posts take after an AI step, and how much of the item's text.
  const aiSwitch = ({ on, step }) =>
    segSwitch(
      t('dpick.aiSwitch'),
      on,
      [
        [true, t('dpick.fromAi', { n: step })],
        [false, t('dpick.fromItem')],
      ],
      (v) => (ui.pickerUseAi = v)
    );
  const shortSwitch = ({ on }) =>
    segSwitch(
      t('dpick.textSwitch'),
      on,
      [
        [false, t('dpick.textFull')],
        [true, t('dpick.textShort')],
      ],
      (v) => (ui.pickerShort = v)
    );
  const segSwitch = (title, on, options, set) =>
    h(
      'div',
      { class: 'seg', role: 'radiogroup', 'aria-label': title },
      h('span', { class: 'seg-label' }, title),
      options.map(([value, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(on === value),
            class: ['seg-btn', on === value && 'active'],
            onclick: () => {
              set(value);
              cats = build();
              rebuild();
            },
          },
          label
        )
      )
    );

  const nav = h('nav', { class: 'tag-nav', 'aria-label': t('dpick.howto') });
  const main = h('div', { class: 'tag-main' });
  const catIcon = (c) =>
    c.service ? serviceIcon(c.service, 'xs') : h('span', { class: 'token-sys' }, c.icon ?? '•');

  const renderNav = () => {
    clear(nav);
    for (const c of all) {
      const n = c.entries ? c.entries.filter((e) => matches(c, e)).length : null;
      if (query && c.entries && !n) continue;
      nav.append(
        h(
          'button',
          {
            type: 'button',
            class: ['tag-nav-item', c.id === current && 'active'],
            'aria-current': c.id === current ? 'true' : null,
            onclick: () => {
              current = c.id;
              renderNav();
              renderMain();
              main.scrollTop = 0;
            },
          },
          catIcon(c),
          h('span', { class: 'tag-nav-title' }, L(c.title)),
          n !== null ? h('span', { class: 'tag-nav-count' }, String(n)) : null
        )
      );
    }
  };
  const matches = (c, e) =>
    !query || `${L(c.title)} ${entryTitle(e)} ${e.template}`.toLowerCase().includes(query);

  const renderMain = () => {
    clear(main);
    if (current === 'howto' && !query) {
      // Element.append prints null and arrays as text: hand it nodes only.
      main.append(
        ...[
          h('h3', { class: 'tag-main-title' }, t('dpick.howto')),
          ['dpick.howto1', 'dpick.howto2', 'dpick.howto3', 'dpick.howto4'].map((k) =>
            h('p', { class: 'tag-howto' }, markdownNodes(t(k)))
          ),
          replace ? h('p', { class: 'alert info' }, t('dpick.replaceOnly')) : null,
        ]
          .flat()
          .filter(Boolean)
      );
      return;
    }
    // A search looks through every category; otherwise the chosen one.
    const shown = query ? all.filter((c) => c.entries) : all.filter((c) => c.id === current);
    let any = false;
    for (const c of shown) {
      const entries = c.entries.filter((e) => matches(c, e));
      if (!entries.length) continue;
      any = true;
      main.append(
        ...[
          h('h3', { class: 'tag-main-title' }, catIcon(c), L(c.title)),
          c.aiToggle && !query ? aiSwitch(c.aiToggle) : null,
          c.shortToggle && !query ? shortSwitch(c.shortToggle) : null,
          c.hint && !query
            ? h('p', { class: ['small tag-main-hint', c.warn ? 'fe-nudge' : 'muted'] }, L(c.hint))
            : null,
        ].filter(Boolean)
      );
      const groups = [...new Set(entries.map((e) => e.group))];
      for (const g of groups) {
        const list = entries.filter((e) => e.group === g);
        if (groups.length > 1 && GROUPS[g] && g !== 'fav') {
          main.append(h('div', { class: 'tag-group-title' }, L(GROUPS[g]), ` · ${list.length}`));
        }
        main.append(
          h('div', { class: ['tag-grid', g === 'emoji' && 'tag-grid-emoji'] }, list.map(card))
        );
      }
    }
    if (!any) main.append(h('p', { class: 'muted pick-empty' }, t('home.noResults')));
  };

  const search = h('input', {
    type: 'search',
    class: 'input tag-search',
    placeholder: t('dpick.search'),
    'aria-label': t('dpick.search'),
    oninput: (e) => {
      query = e.target.value.trim().toLowerCase();
      renderNav();
      renderMain();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        main.querySelector('.tag-card')?.click();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        main.querySelector('.tag-card')?.focus();
      }
    },
  });
  main.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const cards = [...main.querySelectorAll('.tag-card')];
    const i = cards.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    (cards[i + step] ?? (step < 0 ? search : cards[i]))?.focus();
  });

  rebuild();
  openModal({
    title: t('dpick.title', { field: field._fieldLabel ?? '' }),
    wide: true,
    size: 'xl',
    body: [search, h('div', { class: 'tag-layout' }, nav, main)],
    actions: [],
  });
  search.focus();
}

/** A small question window: one text field, OK and Cancel. `onOk` returns false to stay open. */
function askText({ title, label, help, value = '', quick = [] }, onOk) {
  const input = h('input', { class: 'input', value, 'aria-label': label });
  const ok = () => {
    const v = input.value.trim();
    if (!v) return false;
    return onOk(v);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && ok() !== false) closeModal();
  });
  openModal({
    title,
    body: [
      help ? h('p', { class: 'small muted' }, help) : null,
      h('label', { class: 'field-label' }, label),
      input,
      quick.length
        ? h(
            'div',
            { class: 'row-gap', style: { flexWrap: 'wrap' } },
            quick.map((w) =>
              h(
                'button',
                { type: 'button', class: 'btn btn-small', onclick: () => (input.value = w) },
                w
              )
            )
          )
        : null,
    ],
    actions: [{ label: t('common.cancel') }, { label: t('common.ok'), primary: true, onClick: ok }],
  });
  input.select();
}

/** Asks for the words a link shows: “Read more”, “Source”… */
function askLinkText(onOk, current = '') {
  askText(
    {
      title: current ? t('tok.linkEdit') : t('tok.asLink'),
      label: t('tok.linkWords'),
      help: t('tok.asLinkHelp'),
      value: current || t('tok.linkDefault'),
      quick: [t('tok.linkDefault'), t('tok.linkMore'), t('tok.linkSource'), '🔗'],
    },
    (v) => {
      const words = v.replace(/[[\]]/g, '').trim();
      if (!words) return false;
      onOk(words);
    }
  );
}

/** Click on a chip: format it, replace it with other data, or remove it. */
function openTokenMenu(a, node, chip, field) {
  const expr = chip.dataset.expr;
  const p = parseExpr(expr);
  const items = [];
  const kind = chip.dataset.linkText ? 'link' : valueKind(expr);
  // Bold: on/off, for text tags (not a picture, not a link with words).
  if (kind !== 'image' && !chip.dataset.linkText) {
    const bold = Boolean(chip.dataset.bold);
    items.push(
      h(
        'button',
        {
          type: 'button',
          role: 'menuitemcheckbox',
          class: 'menu-item',
          'aria-checked': String(bold),
          onclick: () => {
            closePopover();
            field.replaceWithTemplate(chip, bold ? `{{ ${expr} }}` : `**{{ ${expr} }}**`);
          },
        },
        `${bold ? '☑' : '☐'} ${t('tok.bold')}`
      ),
      h('div', { class: 'menu-sep', role: 'separator' })
    );
  }
  // Upper/lower case and length make sense for text, not for a link or a picture.
  if (p && !kind) {
    items.push(h('div', { class: 'menu-label' }, t('tok.format')));
    for (const fmt of FORMATS) {
      items.push(
        h(
          'button',
          {
            type: 'button',
            role: 'menuitemradio',
            class: 'menu-item',
            'aria-checked': String(p.fmt === fmt),
            onclick: () => {
              closePopover();
              field.replaceToken(chip, buildExpr({ ...p, fmt }));
            },
          },
          `${p.fmt === fmt ? '● ' : '○ '}${fmtLabel(fmt)}`
        )
      );
    }
    items.push(h('div', { class: 'menu-sep', role: 'separator' }));
  }
  items.push(
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item',
        onclick: () => {
          closePopover();
          openDataPicker(a, node, field, { replace: chip });
        },
      },
      t('tok.replace')
    ),
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item',
        onclick: () => {
          closePopover();
          // A link chip keeps its address and gets new words; any other chip becomes one.
          askLinkText(
            (words) => field.replaceWithTemplate(chip, `[${words}]({{ ${expr} }})`),
            chip.dataset.linkText
          );
        },
      },
      chip.dataset.linkText ? t('tok.linkEdit') : t('tok.asLink')
    ),
    chip.dataset.linkText
      ? h(
          'button',
          {
            type: 'button',
            role: 'menuitem',
            class: 'menu-item',
            onclick: () => {
              closePopover();
              field.replaceWithTemplate(chip, `{{ ${expr} }}`);
            },
          },
          t('tok.linkPlain')
        )
      : null,
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'menu-item danger',
        onclick: () => {
          closePopover();
          field.removeToken(chip);
        },
      },
      t('tok.remove')
    )
  );
  openPopover(chip, items);
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
  checkpoint(a);
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

// ── First-time hints ──────────────────────────────────────────────────────────
// The first time the pointer rests on (or the keyboard focuses) a control marked
// `data-hint`, a short explanation appears next to it — once per control, ever.

const HINT_DELAY_MS = 450;
const canHover = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
let hintTimer = null;
let hintEl = null;

const hintSeen = (key) => Boolean(store.hints[`hover.${key}`]);

function hideHint() {
  clearTimeout(hintTimer);
  hintEl?.remove();
  hintEl = null;
}

function showHint(target, key) {
  if (!target.isConnected || document.querySelector('.modal-backdrop, .popover')) return;
  hideHint();
  store.hints[`hover.${key}`] = true;
  save();
  const bubble = h(
    'div',
    { class: 'coach', role: 'tooltip', id: 'coach' },
    h('p', {}, t(`hint.${key}`)),
    h('button', { type: 'button', class: 'coach-ok', onclick: hideHint }, t('hint.ok'))
  );
  document.body.append(bubble);
  const r = target.getBoundingClientRect();
  const below = r.bottom + bubble.offsetHeight + 12 < window.innerHeight;
  bubble.dataset.side = below ? 'bottom' : 'top';
  const left = Math.min(
    Math.max(8, r.left + r.width / 2 - bubble.offsetWidth / 2),
    window.innerWidth - bubble.offsetWidth - 8
  );
  Object.assign(bubble.style, {
    left: `${left}px`,
    top: `${below ? r.bottom + 10 : r.top - bubble.offsetHeight - 10}px`,
  });
  bubble.style.setProperty('--arrow-x', `${r.left + r.width / 2 - left}px`);
  target.setAttribute('aria-describedby', 'coach');
  hintEl = bubble;
  const away = () =>
    setTimeout(() => {
      if (hintEl === bubble && !bubble.matches(':hover') && !target.matches(':hover, :focus')) {
        target.removeAttribute('aria-describedby');
        hideHint();
      }
    }, 250);
  target.addEventListener('mouseleave', away);
  target.addEventListener('blur', away);
  bubble.addEventListener('mouseleave', away);
}

function armHint(target) {
  const key = target?.dataset.hint;
  if (!key || hintSeen(key) || hintEl) return;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    if (target.matches(':hover, :focus-visible')) showHint(target, key);
  }, HINT_DELAY_MS);
}

if (canHover) {
  document.addEventListener('mouseover', (e) => armHint(e.target.closest?.('[data-hint]')));
}
document.addEventListener('focusin', (e) => {
  const target = e.target.closest?.('[data-hint]');
  if (target?.matches(':focus-visible')) armHint(target);
});
document.addEventListener('scroll', hideHint, true);

// ── Live mode: sign-in, real tests and runs, connections ──────────────────────

function triggerOf(a) {
  return a.nodes.find((n) => ACTIONS[n.action]?.kind === 'trigger');
}

function liveCheck(a, { navigate = false } = {}) {
  const nums = stepNumbers(a);
  const external = stepOrder(a)
    .map((id) => a.nodes.find((n) => n.id === id))
    .filter((n) => n && !n.disabled && ACTIONS[n.action]?.external);
  const start = async () => {
    ui.busy = true;
    render();
    try {
      await live.flushSync(store, showApiError);
      recordCheck(a, await live.testRun(a), { navigate });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      ui.busy = false;
      render();
    }
  };
  if (!external.length) return void start();
  // A real test sends real messages: say which, before it happens.
  openModal({
    title: t('ed.testExternalTitle'),
    body: [
      h('p', {}, t('ed.testExternal')),
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
    ],
    actions: [
      { label: t('ed.cancel') },
      { label: t('ed.testConfirm'), primary: true, onClick: () => void start() },
    ],
  });
}

async function liveRunNow(a) {
  ui.busy = true;
  render();
  try {
    const run = await live.runNow(a);
    store.runs.unshift(run);
    a.lastRunAt = run.at;
    a.lastRunResult = run.result;
    ui.lastRunId = run.id;
    ui.runPanelOpen = true;
    toast(t('ed.runDone'));
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    ui.busy = false;
    render();
  }
}

async function liveActivate(a) {
  const wasActive = a.status === 'active';
  try {
    if (a.status === 'paused' && a.published && !a.dirty) await live.setActive(store, a, true);
    else await live.publish(store, a);
  } catch (err) {
    openModal({ title: t('ed.publishFailed'), body: h('p', {}, err.message) });
    return;
  }
  const ob = store.onboarding;
  if (ob.status === 'in_progress' && ob.step === 4 && ob.automationId === a.id) {
    ob.status = 'finishing';
    ob.hidden = false;
  }
  ui.triggerInfo = null;
  save();
  toast(wasActive ? t('ed.published', { v: a.publishedVersion }) : t('ed.activated'));
  render();
}

/** "Next run …" / bot polling error under the editor bar of an active automation. */
function triggerStatusLine(a) {
  const trigger = triggerOf(a);
  if (
    a.status !== 'active' ||
    !['schedule.every', 'telegram.newMessage'].includes(trigger?.action)
  ) {
    return null;
  }
  if (ui.triggerInfo?.id !== a.id) {
    ui.triggerInfo = { id: a.id, data: null };
    live
      .triggerStatus(a)
      .then((data) => {
        if (ui.triggerInfo?.id !== a.id) return;
        ui.triggerInfo.data = data;
        render();
      })
      .catch(() => {});
    return null;
  }
  const info = ui.triggerInfo.data;
  if (!info) return null;
  const parts = [];
  if (info.telegram?.lastError) {
    return h(
      'div',
      { class: 'alert error trigger-status' },
      t('ed.triggerError', { message: info.telegram.lastError })
    );
  }
  if (info.nextRunAt)
    parts.push(t('ed.triggerNext', { when: formatDateTime(Date.parse(info.nextRunAt)) }));
  if (info.lastRunAt)
    parts.push(t('ed.triggerLast', { when: formatRelative(Date.parse(info.lastRunAt)) }));
  return parts.length ? h('div', { class: 'muted small trigger-status' }, parts.join(' · ')) : null;
}

async function checkLiveConnection(c) {
  toast(t('conn.checking'));
  try {
    const res = await live.checkConnection(c.id);
    toast(
      res.ok
        ? t('conn.checkOkLive', { message: res.message })
        : t('conn.checkFail', { message: res.message }),
      res.ok ? 'ok' : 'error'
    );
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openLiveConnect(serviceId, onDone) {
  const s = SERVICES[serviceId];
  const fields = live.CONNECT_FIELDS[serviceId] ?? [];
  const nameInput = h('input', { class: 'input', id: 'conn_name', value: L(s.name) });
  const controls = fields.map((f) => ({
    f,
    input: h('input', {
      class: 'input',
      id: `conn_${f.key}`,
      type: f.secret ? 'password' : 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: f.placeholder ?? '',
    }),
    error: h('div', { class: 'field-error' }),
  }));
  const formError = h('p', { class: 'error-text', role: 'alert' });
  let sending = false;
  const submit = async () => {
    const values = Object.fromEntries(controls.map((c) => [c.f.key, c.input.value]));
    let valid = true;
    for (const c of controls) {
      const missing = c.f.required && !c.input.value.trim();
      c.error.textContent = missing ? t('conn.required') : '';
      if (missing) valid = false;
    }
    formError.textContent = '';
    if (serviceId === 'ai' && !values.apiKey?.trim() && !values.baseUrl?.trim()) {
      formError.textContent = t('conn.needKey');
      valid = false;
    }
    if (!valid || sending) return;
    sending = true;
    try {
      const conn = await live.createConnection(
        serviceId,
        nameInput.value.trim() || L(s.name),
        values
      );
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
      closeModal();
      toast(t('conn.saved'));
      onDone?.(conn);
      render();
      checkLiveConnection(conn);
    } catch (err) {
      formError.textContent = err.message;
    } finally {
      sending = false;
    }
  };
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
      h(
        'form',
        {
          class: 'connect-form',
          onsubmit: (e) => {
            e.preventDefault();
            submit();
          },
        },
        h(
          'div',
          { class: 'field' },
          h('label', { class: 'field-label', for: 'conn_name' }, t('conn.fieldName')),
          nameInput
        ),
        controls.map((c) =>
          h(
            'div',
            { class: 'field' },
            h('label', { class: 'field-label', for: `conn_${c.f.key}` }, t(c.f.label)),
            c.input,
            c.f.help ? h('div', { class: 'small muted' }, t(c.f.help)) : null,
            c.error
          )
        ),
        h('button', { type: 'submit', hidden: true })
      ),
      formError,
      h('p', { class: 'note' }, t('conn.subtitle')),
    ],
    actions: [
      { label: t('ed.cancel') },
      {
        label: t('conn.save'),
        primary: true,
        onClick: () => {
          submit();
          return false; // the form closes itself once the server saved it
        },
      },
    ],
  });
}

function renderAuth() {
  clear($('appHeader')).append(
    h(
      'span',
      { class: 'brand' },
      h('img', { src: './logo-mark.svg', alt: '', class: 'brand-logo' }),
      h('span', { class: 'brand-title' }, 'OpenNodes')
    ),
    h('div', { class: 'header-right' }, langSwitch())
  );
  $('demoBanner').hidden = true;
  const view = clear($('view'));
  if (ui.auth === 'loading') {
    view.append(h('div', { class: 'page auth-page' }, h('p', { class: 'muted' }, '…')));
    return;
  }
  if (ui.auth === 'offline') {
    view.append(
      h(
        'div',
        { class: 'page auth-page' },
        h(
          'section',
          { class: 'auth-card' },
          h('h1', { class: 'page-title' }, t('auth.offline')),
          h('p', { class: 'muted' }, t('auth.offlineText')),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: boot }, t('auth.retry'))
        )
      )
    );
    return;
  }
  const setup = ui.auth === 'setup';
  const field = (id, label, input, hint) =>
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field-label', for: id }, label),
      input,
      hint ? h('div', { class: 'small muted' }, hint) : null
    );
  const email = h('input', {
    class: 'input',
    id: 'auth_email',
    type: 'email',
    autocomplete: 'username',
    required: true,
  });
  const password = h('input', {
    class: 'input',
    id: 'auth_password',
    type: 'password',
    autocomplete: setup ? 'new-password' : 'current-password',
    required: true,
    minlength: setup ? '8' : null,
  });
  const team = setup
    ? h('input', { class: 'input', id: 'auth_team', value: t('auth.workspaceDefault') })
    : null;
  const error = h('p', { class: 'error-text', role: 'alert' }, ui.authError ?? '');
  const submitBtn = h(
    'button',
    { type: 'submit', class: 'btn btn-primary' },
    setup ? t('auth.create') : t('auth.login')
  );
  view.append(
    h(
      'div',
      { class: 'page auth-page' },
      h(
        'form',
        {
          class: 'auth-card',
          onsubmit: async (e) => {
            e.preventDefault();
            submitBtn.disabled = true;
            error.textContent = '';
            try {
              if (setup)
                await live.createOwner(email.value.trim(), password.value, team.value.trim());
              else await live.signIn(email.value.trim(), password.value);
              ui.authError = null;
              await enterWorkspace();
            } catch (err) {
              error.textContent = err.status === 401 ? t('auth.bad') : err.message;
              submitBtn.disabled = false;
            }
          },
        },
        h('h1', { class: 'page-title' }, setup ? t('auth.setupTitle') : t('auth.loginTitle')),
        setup ? h('p', { class: 'muted' }, t('auth.setupText')) : null,
        field('auth_email', t('auth.email'), email),
        field('auth_password', t('auth.password'), password, setup ? t('auth.passwordHint') : null),
        setup ? field('auth_team', t('auth.workspace'), team) : null,
        error,
        submitBtn
      )
    )
  );
  email.focus();
}

async function enterWorkspace() {
  await live.loadWorkspace(store);
  ui.auth = null;
  if (!location.hash) location.hash = '#/automations';
  parseRoute();
  render();
}

function signedOut() {
  store.automations = [];
  store.connections = [];
  store.runs = [];
  live.session.user = null;
  live.session.workspace = null;
  closeModal();
  ui.auth = 'login';
  render();
}

window.addEventListener('opennodes:signed-out', signedOut);

/** Demo: render at once. Live: find out whether to set up, sign in or load. */
async function boot() {
  if (!live.isLive) return render();
  ui.auth = 'loading';
  render();
  try {
    const status = await live.setupStatus();
    if (!status.bootstrapped) ui.auth = 'setup';
    else return await enterWorkspace(); // 401 without a session cookie → sign in
  } catch (err) {
    ui.auth = err.status === 401 ? 'login' : 'offline';
    // The API may still be starting: keep trying while this screen is shown.
    if (ui.auth === 'offline') setTimeout(() => ui.auth === 'offline' && boot(), 3000);
  }
  render();
}

// ── Start ─────────────────────────────────────────────────────────────────────

parseRoute();
boot();
