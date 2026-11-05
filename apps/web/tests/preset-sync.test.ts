import { describe, it, expect } from 'vitest';
// @ts-expect-error browser module
import { createPresetSync } from '../../../docs/preset-sync.js';

const preset = { id: 'vp_legacy', name: 'Voice', versions: [{ version: 1, config: { name: 'Voice', tone: 'warm' }, savedAt: 1 }] };
const library = (voicePresets: any[] = []) => ({ revision: 0, voicePresets, promptPresets: [] });
const conflict = () => Object.assign(new Error('Changed in another window'), { status: 409 });

describe('preset library synchronization', () => {
  it('imports browser presets once and reads the same data in another editor', async () => {
    let db = library(); let writes = 0;
    const request = async (method: string, _path: string, body: any) => {
      if (method === 'GET') return structuredClone(db);
      writes++; expect(body.expectedRevision).toBe(db.revision);
      db = { ...structuredClone(body), revision: db.revision + 1 };
      return structuredClone(db);
    };
    const local: any = { voicePresets: [preset], promptPresets: [] };
    await createPresetSync(request, 'w').load(local);
    expect(writes).toBe(1); expect(local.presetWorkspaceId).toBe('w');
    const second: any = {};
    await createPresetSync(request, 'w').load(second);
    expect(second.voicePresets).toEqual([preset]); expect(writes).toBe(1);
  });

  it('preserves edits and reports errors after three conflicting writes', async () => {
    const states: string[] = []; let writes = 0;
    const sync = createPresetSync(async (method: string) => {
      if (method === 'GET') return library();
      writes++; throw conflict();
    }, 'w', (status: string) => states.push(status));
    const store: any = {}; await sync.load(store); store.voicePresets = [structuredClone(preset)];
    await expect(sync.flush(store)).rejects.toThrow('Changed');
    expect(writes).toBe(3); expect(store.voicePresets).toEqual([preset]); expect(states.at(-1)).toBe('error');
  });

  it('never imports cached presets belonging to another workspace', async () => {
    const store: any = { presetWorkspaceId: 'other', voicePresets: [preset] };
    await createPresetSync(async (method: string) => { expect(method).toBe('GET'); return library(); }, 'w').load(store);
    expect(store.voicePresets).toEqual([]); expect(store.presetWorkspaceId).toBe('w');
  });

  it('merges a competing append without replacing either version history', async () => {
    let db = library([structuredClone(preset)]);
    const request = async (method: string, _path: string, body: any) => {
      if (method === 'GET') return structuredClone(db);
      if (body.expectedRevision !== db.revision) throw conflict();
      db = { ...structuredClone(body), revision: db.revision + 1 };
      return structuredClone(db);
    };
    const store: any = {}; const sync = createPresetSync(request, 'w'); await sync.load(store);
    store.voicePresets[0].versions.push({ version: 2, config: { tone: 'local' }, savedAt: 2 });
    db.voicePresets[0].versions.push({ version: 2, config: { tone: 'remote' }, savedAt: 3 }); db.revision++;
    await sync.flush(store);
    expect(store.voicePresets).toHaveLength(2);
    expect(store.voicePresets.find((p: any) => p.id === preset.id).versions[1].config.tone).toBe('remote');
    expect(store.voicePresets.find((p: any) => p.id !== preset.id).versions[1].config.tone).toBe('local');
    expect(store.voicePresets).toEqual(db.voicePresets);
  });

  it('serializes flushes and saves an edit made while an earlier write is in flight', async () => {
    let release!: () => void; let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const writing = new Promise<void>((resolve) => { started = resolve; });
    let db = library(); let writes = 0; const states: string[] = [];
    const request = async (method: string, _path: string, body: any) => {
      if (method === 'GET') return structuredClone(db);
      writes++;
      if (writes === 1) { started(); await blocked; }
      expect(body.expectedRevision).toBe(db.revision);
      db = { ...structuredClone(body), revision: db.revision + 1 }; return structuredClone(db);
    };
    const store: any = {}; const sync = createPresetSync(request, 'w', (state: string) => states.push(state));
    await sync.load(store); store.voicePresets = [structuredClone(preset)];
    const first = sync.flush(store); await writing;
    store.voicePresets[0].versions.push({ version: 2, config: { tone: 'later' }, savedAt: 2 });
    const second = sync.flush(store); expect(writes).toBe(1); release();
    await Promise.all([first, second]);
    expect(writes).toBe(2); expect(store.voicePresets[0].versions).toHaveLength(2);
    expect(db.voicePresets).toEqual(store.voicePresets); expect(states.at(-1)).toBe('saved');
  });

  it('reports a failed load without changing the cached library and permits retry', async () => {
    let offline = true; const states: string[] = [];
    const sync = createPresetSync(async (method: string) => {
      if (offline) throw new Error('Offline');
      expect(method).toBe('GET'); return library([structuredClone(preset)]);
    }, 'w', (status: string) => states.push(status));
    const store: any = { presetWorkspaceId: 'w', voicePresets: [structuredClone(preset)] };
    await expect(sync.load(store)).rejects.toThrow('Offline');
    expect(store.voicePresets).toEqual([preset]); expect(states.at(-1)).toBe('error');
    offline = false; await sync.load(store); expect(states.at(-1)).toBe('saved');
  });

  it('retries a failed initial load on flush and preserves edits made during cache import', async () => {
    let offline = true; let writes = 0; let release!: () => void; let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const importing = new Promise<void>((resolve) => { started = resolve; });
    let db = library(); const states: string[] = [];
    const request = async (method: string, _path: string, body: any) => {
      if (offline) throw new Error('Offline');
      if (method === 'GET') return structuredClone(db);
      writes++;
      if (writes === 1) { started(); await blocked; }
      expect(body.expectedRevision).toBe(db.revision);
      db = { ...structuredClone(body), revision: db.revision + 1 };
      return structuredClone(db);
    };
    const store: any = { presetWorkspaceId: 'w', voicePresets: [structuredClone(preset)] };
    const sync = createPresetSync(request, 'w', (state: string) => states.push(state));
    await expect(sync.load(store)).rejects.toThrow('Offline');
    offline = false;
    const saving = sync.flush(store); await importing;
    store.voicePresets[0].versions.push({ version: 2, config: { tone: 'edited during retry' }, savedAt: 2 });
    release(); await saving;
    expect(writes).toBe(2);
    expect(store.voicePresets[0].versions[1].config.tone).toBe('edited during retry');
    expect(db.voicePresets).toEqual(store.voicePresets); expect(states.at(-1)).toBe('saved');
  });
});
