import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS } from '../../../docs/catalog.js';
import { loadWorkspace, flushSync, presetState } from '../../../docs/live.js';

const emptyStore = () => ({
  automations: [],
  connections: [],
  runs: [],
  voicePresets: [],
  promptPresets: [],
});
function server() {
  const writes: Array<{ path: string; body: any }> = [];
  let presetFailure = false,
    draftFailure = false;
  let remote = { revision: 0, voicePresets: [], promptPresets: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const path = String(url).replace(/^null/, '');
      const method = options.method;
      const body = options.body ? JSON.parse(options.body) : undefined;
      const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
      if (path === '/me') return response({ user: { id: 'u' }, workspaces: [{ id: 'ws' }] });
      if (path === '/catalog')
        return response({
          nodeTypes: Object.values(ACTIONS)
            .map((a) => a.type)
            .filter(Boolean),
        });
      if (path.endsWith('/presets')) {
        if (presetFailure) return response({ message: 'Preset write fails' }, 503);
        if (method === 'PUT') {
          writes.push({ path, body });
          remote = {
            revision: remote.revision + 1,
            voicePresets: body.voicePresets,
            promptPresets: body.promptPresets,
          };
        }
        return response(remote);
      }
      if (method === 'GET' && path.endsWith('/workflows')) return response({ workflows: [] });
      if (method === 'GET' && path.endsWith('/credentials')) return response({ credentials: [] });
      if (path.includes('/executions')) return response({ executions: [] });
      if (path.includes('/workflows') && method !== 'GET') {
        writes.push({ path, body });
        if (draftFailure) return response({ message: 'Draft write fails' }, 503);
        return response({});
      }
      throw new Error(`Unexpected ${method} ${path}`);
    })
  );
  return {
    writes,
    presetsFail: (value) => {
      presetFailure = value;
    },
    draftsFail: (value) => {
      draftFailure = value;
    },
  };
}
const addWorkflow = (store) =>
  store.automations.push({ id: 'wf', name: 'Draft', nodes: [], edges: [] });
const addPreset = (store) =>
  store.voicePresets.push({
    id: 'voice',
    name: 'Voice',
    versions: [{ version: 1, config: { name: 'Voice' } }],
  });

afterEach(() => vi.unstubAllGlobals());

describe('workspace save barriers', () => {
  it('saves drafts independently when preset saving fails and recovers the next flush', async () => {
    const api = server();
    const store = emptyStore();
    await loadWorkspace(store);
    expect(presetState.status).toBe('saved');
    addWorkflow(store);
    addPreset(store);
    api.presetsFail(true);
    await expect(flushSync(store)).rejects.toThrow('Preset write fails');
    expect(api.writes.some((r) => r.path === '/workspaces/ws/workflows')).toBe(true);
    expect(store.voicePresets).toHaveLength(1);
    expect(presetState.status).toBe('error');
    api.presetsFail(false);
    await expect(flushSync(store)).resolves.toBeUndefined();
    expect(presetState.status).toBe('saved');
    expect(api.writes.filter((r) => r.path.endsWith('/workflows'))).toHaveLength(1);
    expect(api.writes.at(-1).body.voicePresets).toEqual(store.voicePresets);
  });

  it('propagates workflow save failures and retries without a rejected chain blocking future saves', async () => {
    const api = server();
    const store = emptyStore();
    await loadWorkspace(store);
    addWorkflow(store);
    const onError = vi.fn();
    api.draftsFail(true);
    await expect(flushSync(store, onError)).rejects.toThrow('Draft write fails');
    expect(onError).toHaveBeenCalledOnce();
    api.draftsFail(false);
    await expect(flushSync(store)).resolves.toBeUndefined();
    expect(api.writes.filter((r) => r.path.endsWith('/workflows'))).toHaveLength(2);
  });

  it('opens workflows during a preset outage and retries loading on the next flush', async () => {
    const api = server();
    api.presetsFail(true);
    const store = emptyStore();
    await expect(loadWorkspace(store)).resolves.toBeUndefined();
    expect(presetState.status).toBe('error');
    api.presetsFail(false);
    await expect(flushSync(store)).resolves.toBeUndefined();
    expect(presetState.status).toBe('saved');
  });
});
