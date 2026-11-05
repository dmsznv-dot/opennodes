import { h, clear } from './dom.js';
import { t } from './i18n.js';

const STATUSES = new Set([
  'idle',
  'checking',
  'available',
  'downloading',
  'ready',
  'installing',
  'error',
]);
const BUSY = new Set(['checking', 'downloading', 'ready', 'installing']);
const CHECK_INTERVAL = 60 * 60 * 1000;

/** Native updates stay outside the editor's render cycle, including on the sign-in screen. */
export function createDesktopUpdates({ openModal, flush, onState = () => {} }) {
  const desktop = window.OPENNODES_DESKTOP;
  const bridge = window.webkit?.messageHandlers?.openNodesUpdates;
  if (desktop?.platform !== 'macos' || typeof bridge?.postMessage !== 'function') {
    return { button: () => null, open() {} };
  }

  let state = { status: 'idle', currentVersion: desktop.version };
  let panel = null;
  let headerButton = null;
  let preparing = false;
  let finalizing = false;
  let generation = 0;
  let previousInert = null;
  let lastCheck = null;

  function restoreEditing() {
    if (previousInert === null) return;
    document.body.inert = previousInert;
    previousInert = null;
  }

  function publish() {
    renderButton();
    renderPanel();
    onState({ ...state });
  }

  function fail(error, save = false) {
    generation++;
    preparing = false;
    finalizing = false;
    restoreEditing();
    state = {
      ...state,
      status: 'error',
      error: save ? t('update.saveError') : String(error?.message ?? error),
    };
    publish();
  }

  function send(action) {
    bridge.postMessage({ action });
  }

  function cancelAfterSaveFailure(error) {
    // Mark the attempt invalid before cancellation: the native response can be synchronous.
    fail(error, true);
    try {
      send('cancelInstall');
    } catch {
      // Keep the save error visible; installation is never confirmed.
    }
  }

  async function confirmInstallation() {
    if (finalizing) return;
    finalizing = true;
    const attempt = generation;
    previousInert = document.body.inert;
    document.body.inert = true;
    try {
      // Edits made during the download must also reach disk before the native replacement.
      await flush();
    } catch (error) {
      if (attempt === generation) cancelAfterSaveFailure(error);
      return;
    }
    if (attempt !== generation || state.status !== 'ready') return;
    try {
      send('confirmInstall');
    } catch (error) {
      fail(error);
      try {
        send('cancelInstall');
      } catch {
        /* the bridge is unavailable */
      }
    }
  }

  function receive(detail) {
    if (!detail || !STATUSES.has(detail.status)) return;
    if (detail.status === 'error') {
      generation++;
      preparing = false;
      finalizing = false;
      restoreEditing();
    }
    state = {
      ...state,
      ...detail,
      currentVersion: detail.currentVersion ?? desktop.version,
      error: detail.status === 'error' ? detail.error : undefined,
    };
    publish();
    if (state.status === 'ready') void confirmInstallation();
  }

  function check() {
    if (preparing || BUSY.has(state.status)) return;
    lastCheck = Date.now();
    state = { ...state, status: 'checking', error: undefined };
    publish();
    try {
      send('check');
    } catch (error) {
      fail(error);
    }
  }

  async function install() {
    if (preparing || state.status !== 'available') return;
    preparing = true;
    const attempt = ++generation;
    publish();
    try {
      await flush();
    } catch (error) {
      if (attempt === generation) cancelAfterSaveFailure(error);
      return;
    }
    if (attempt !== generation) return;
    preparing = false;
    if (state.status !== 'available') {
      publish();
      return;
    }
    state = { ...state, status: 'downloading', progress: 0, error: undefined };
    publish();
    try {
      send('install');
    } catch (error) {
      fail(error);
    }
  }

  function renderButton() {
    if (!headerButton) return;
    const available = ['available', 'downloading', 'ready', 'installing'].includes(state.status);
    headerButton.className = `btn desktop-update-button update-button${available ? ' has-update' : ''}`;
    headerButton.setAttribute('aria-label', t('update.open'));
    clear(headerButton).append(
      document.createTextNode('Update'),
      ...(available
        ? [h('span', { class: 'desktop-update-badge update-indicator', 'aria-hidden': 'true' })]
        : [])
    );
  }

  function renderPanel() {
    if (!panel) return;
    const busy = preparing || BUSY.has(state.status);
    const statusKey = preparing || state.status === 'ready' ? 'installing' : state.status;
    const nodes = [
      h('p', { class: 'muted' }, t('update.current', { v: state.currentVersion })),
      h(
        'p',
        { class: 'desktop-update-status update-heading', role: 'status', 'aria-live': 'polite' },
        t(`update.${statusKey}`, { v: state.version ?? '' })
      ),
    ];
    if (state.releaseNotes) {
      nodes.push(h('div', { class: 'desktop-update-notes update-notes' }, state.releaseNotes));
    }
    if (state.status === 'downloading') {
      const progress = Number.isFinite(state.progress)
        ? Math.max(0, Math.min(1, state.progress))
        : null;
      nodes.push(
        h('progress', {
          class: 'desktop-update-progress',
          max: 1,
          value: progress,
          'aria-label': t('update.downloading'),
        })
      );
      if (progress !== null)
        nodes.push(h('p', { class: 'muted' }, `${Math.round(progress * 100)}%`));
    }
    if (state.status === 'error' && state.error) {
      nodes.push(h('p', { class: 'desktop-update-error', role: 'alert' }, state.error));
    }
    nodes.push(
      h('p', { class: 'muted' }, t('update.data')),
      h(
        'div',
        { class: 'desktop-update-actions update-actions row-gap' },
        h(
          'button',
          { type: 'button', class: 'btn', disabled: busy, onclick: check },
          t('update.check')
        ),
        state.status === 'available'
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn-primary',
                disabled: busy,
                onclick: () => {
                  void install();
                },
              },
              t('update.install')
            )
          : null
      )
    );
    clear(panel).append(...nodes);
  }

  function open() {
    const body = h('div', { class: 'desktop-update-panel' });
    panel = body;
    renderPanel();
    openModal({
      title: t('update.title'),
      body: panel,
      onClose: () => {
        if (panel === body) panel = null;
      },
    });
  }

  window.addEventListener('opennodes:update', (event) => receive(event.detail));
  window.addEventListener('opennodes:show-updates', open);
  window.addEventListener('focus', () => {
    if (lastCheck !== null && Date.now() - lastCheck >= CHECK_INTERVAL) check();
  });
  window.setTimeout(() => {
    if (lastCheck === null) check();
  }, 1500);
  receive(window.OPENNODES_UPDATE);

  return {
    button() {
      if (!headerButton) headerButton = h('button', { type: 'button', onclick: open });
      renderButton();
      return headerButton;
    },
    open,
  };
}
