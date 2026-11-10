import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopUpdates } from '../../../docs/desktop-updates.js';

// Keep these bridge tests independent of a browser installation. The real DOM builder
// runs against a small tree, so event ordering and rendered controls are exercised.
class TestNode extends EventTarget {
  children = [];
  attributes = {};
  style = {};
  dataset = {};
  inert = false;
  constructor(tag = '', text = '') {
    super();
    this.tagName = tag;
    this.text = text;
  }
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }
  removeChild(node) {
    this.children.splice(this.children.indexOf(node), 1);
  }
  get firstChild() {
    return this.children[0];
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  get textContent() {
    return this.text + this.children.map((node) => node.textContent).join('');
  }
  click() {
    if (!('disabled' in this.attributes)) this.dispatchEvent(new Event('click'));
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function elements(node, tag) {
  return [node, ...node.children.flatMap((child) => elements(child, tag))].filter(
    (child) => child.tagName === tag
  );
}

function setup({ native = true, initial, flush = async () => {} } = {}) {
  const window = new EventTarget();
  const requests = [];
  const timers = [];
  const states = [];
  const modals = [];
  window.setTimeout = (callback, delay) => {
    timers.push({ callback, delay });
  };
  if (native) {
    window.OPENNODES_DESKTOP = { platform: 'macos', version: '0.2.0' };
    window.webkit = {
      messageHandlers: {
        openNodesUpdates: {
          postMessage: (request) => requests.push(request.action),
        },
      },
    };
  }
  window.OPENNODES_UPDATE = initial;
  globalThis.window = window;
  globalThis.Node = TestNode;
  globalThis.document = {
    body: new TestNode('body'),
    createElement: (tag) => new TestNode(tag),
    createTextNode: (text) => new TestNode('', text),
  };
  const api = createDesktopUpdates({
    flush,
    openModal: (options) => {
      // Mirror app.js, which closes the previous modal before mounting the next.
      modals.at(-1)?.onClose();
      modals.push(options);
    },
    onState: (state) => states.push(state),
  });
  function update(detail) {
    window.dispatchEvent(new CustomEvent('opennodes:update', { detail }));
  }
  const installButton = () => elements(modals.at(-1).body, 'button').at(-1);
  return { api, window, requests, timers, states, modals, update, installButton };
}

test('web demo has no update button, timers or native controls', () => {
  const env = setup({ native: false });
  assert.equal(env.api.button(), null);
  env.api.open();
  assert.deepEqual(env.modals, []);
  assert.deepEqual(env.timers, []);
});

test('checks after 1.5 seconds and throttles checks on focus to one hour', () => {
  const env = setup();
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    assert.equal(env.timers[0].delay, 1500);
    env.timers[0].callback();
    assert.deepEqual(env.requests, ['check']);
    env.update({ status: 'idle' });
    env.window.dispatchEvent(new Event('focus'));
    assert.equal(env.requests.length, 1);
    now += 60 * 60 * 1000;
    env.window.dispatchEvent(new Event('focus'));
    assert.deepEqual(env.requests, ['check', 'check']);
    now += 60 * 60 * 1000;
    env.window.dispatchEvent(new Event('focus'));
    assert.equal(env.requests.length, 2); // an in-flight check cannot be duplicated
  } finally {
    Date.now = originalNow;
  }
});

test('initial availability updates the persistent header button and native menu opens its modal', () => {
  const env = setup({ initial: { status: 'available', version: '0.3.0' } });
  const button = env.api.button();
  assert.match(button.textContent, /^Update/);
  assert.match(button.className, /has-update/);
  env.window.dispatchEvent(new Event('opennodes:show-updates'));
  assert.equal(env.modals.length, 1);
  assert.equal(elements(env.modals[0].body, 'button').length, 2);
  env.update({ status: 'idle' });
  assert.equal(env.api.button(), button);
  assert.doesNotMatch(button.className, /has-update/);
});

test('flushes before download, then blocks edits and flushes again before the final confirmation', async () => {
  const first = deferred();
  const final = deferred();
  let calls = 0;
  const env = setup({
    initial: { status: 'available', version: '0.3.0' },
    flush: () => (++calls === 1 ? first.promise : final.promise),
  });
  env.api.open();
  env.installButton().click();
  env.installButton().click();
  assert.equal(calls, 1);
  assert.deepEqual(env.requests, []);
  assert.equal(document.body.inert, false);
  first.resolve();
  await first.promise;
  assert.deepEqual(env.requests, ['install']);
  env.update({ status: 'ready' });
  env.update({ status: 'ready' });
  assert.equal(calls, 2);
  assert.equal(document.body.inert, true);
  assert.deepEqual(env.requests, ['install']);
  final.resolve();
  await final.promise;
  assert.deepEqual(env.requests, ['install', 'confirmInstall']);
  assert.equal(document.body.inert, true);
});

test('failed final save restores editing, cancels staging and never confirms replacement', async () => {
  const final = deferred();
  const env = setup({ flush: () => final.promise });
  env.update({ status: 'ready', version: '0.3.0' });
  assert.equal(document.body.inert, true);
  final.reject(new Error('disk full'));
  await final.promise.catch(() => {});
  assert.equal(document.body.inert, false);
  assert.deepEqual(env.requests, ['cancelInstall']);
  assert.equal(env.states.at(-1).status, 'error');
});

test('failed initial save prevents download and cancels the native install attempt', async () => {
  const env = setup({
    initial: { status: 'available', version: '0.3.0' },
    flush: async () => {
      throw new Error('not saved');
    },
  });
  env.api.open();
  env.installButton().click();
  await Promise.resolve();
  assert.deepEqual(env.requests, ['cancelInstall']);
  assert.equal(document.body.inert, false);
  assert.equal(env.states.at(-1).status, 'error');
});

test('native error invalidates a pending final save and restores editing', async () => {
  const final = deferred();
  const env = setup({ flush: () => final.promise });
  env.update({ status: 'ready' });
  env.update({ status: 'error', error: 'signature mismatch' });
  assert.equal(document.body.inert, false);
  final.resolve();
  await final.promise;
  assert.deepEqual(env.requests, []);
  assert.equal(env.states.at(-1).error, 'signature mismatch');
});

test('updates only its own modal content, renders notes as text and clamps progress', () => {
  const env = setup();
  env.api.open();
  env.api.open(); // exercising the old modal's onClose must retain the new panel
  const panel = env.modals.at(-1).body;
  const notes = '<script>stealTokens()</script>';
  env.update({ status: 'downloading', releaseNotes: notes, progress: 2 });
  assert.equal(env.modals.length, 2);
  assert.equal(env.modals.at(-1).body, panel);
  assert.ok(panel.textContent.includes(notes));
  assert.equal(elements(panel, 'script').length, 0);
  assert.equal(elements(panel, 'progress')[0].value, 1);
  env.update({ status: 'downloading', progress: NaN });
  assert.equal('value' in elements(panel, 'progress')[0], false);
});
