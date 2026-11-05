/** Workspace library synchronization. A failed write never replaces local edits. */
const copy = (value) => JSON.parse(JSON.stringify(value));
const empty = () => ({ voicePresets: [], promptPresets: [] });
const snapshot = (store) => copy({ voicePresets: store.voicePresets ?? [], promptPresets: store.promptPresets ?? [] });
const libraries = (value) => ({ voicePresets: value.voicePresets, promptPresets: value.promptPresets });
const stable = (value) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

function merge(remote, local) {
  const result = copy(remote);
  for (const kind of ['voicePresets', 'promptPresets']) {
    result[kind] ??= [];
    for (const preset of local[kind] ?? []) {
      const current = result[kind].find((saved) => saved.id === preset.id);
      if (!current) { result[kind].push(copy(preset)); continue; }
      const conflict = preset.versions.some((version) => {
        const saved = current.versions.find((item) => item.version === version.version);
        return saved && stable(saved) !== stable(version);
      });
      if (conflict) {
        // Preserve both histories. Never silently rewrite a server version.
        result[kind].push({
          ...copy(preset),
          id: `import_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
          name: `${preset.name} (local copy)`,
        });
      } else if (preset.versions.length > current.versions.length) {
        current.versions = copy(preset.versions);
        current.name = preset.name;
      }
    }
  }
  return libraries(result);
}

export function createPresetSync(request, workspaceId, onState = () => {}) {
  let revision = 0, accepted = '', loaded = false;
  let chain = Promise.resolve();
  const endpoint = `/workspaces/${workspaceId}/presets`;

  const publish = async (pending, initial) => {
    let remote = initial;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (remote) revision = remote.revision;
      // Reconcile each retry against the original edits, so rejected writes do
      // not carry forward copies created for an earlier server revision.
      const candidate = remote ? merge(remote, pending) : pending;
      if (remote && stable(candidate) === stable(libraries(remote))) return remote;
      try { return await request('PUT', endpoint, { expectedRevision: revision, ...candidate }); }
      catch (error) {
        if (error.status !== 409 || attempt === 2) throw error;
        remote = await request('GET', endpoint);
      }
    }
  };

  async function load(store) {
      onState('loading');
      try {
        const remote = await request('GET', endpoint);
        revision = remote.revision;
        const belongsHere = !store.presetWorkspaceId || store.presetWorkspaceId === workspaceId;
        const local = belongsHere ? snapshot(store) : empty();
        const saved = await publish(local, remote);
        revision = saved.revision;
        // A retry can happen while the editor is open. Preserve edits made while
        // importing the cache, and let the enclosing flush publish them next.
        const result = belongsHere && stable(snapshot(store)) !== stable(local)
          ? merge(saved, snapshot(store)) : libraries(saved);
        store.voicePresets = copy(result.voicePresets);
        store.promptPresets = copy(result.promptPresets);
        store.presetWorkspaceId = workspaceId;
        accepted = stable(libraries(saved)); loaded = true;
        onState(stable(snapshot(store)) === accepted ? 'saved' : 'saving');
      } catch (error) { onState('error', error); throw error; }
  }

  return {
    load,
    flush(store) {
      const operation = chain.catch(() => {}).then(async () => {
        // An unavailable library at first launch must not disable future saves.
        if (!loaded) await load(store);
        try {
          const pending = snapshot(store);
          if (stable(pending) === accepted) return;
          onState('saving');
          const saved = await publish(pending);
          revision = saved.revision;
          accepted = stable(libraries(saved));
          // A later edit stays pending; the response must not replace it.
          const result = stable(snapshot(store)) === stable(pending) ? libraries(saved) : merge(saved, snapshot(store));
          store.voicePresets = copy(result.voicePresets);
          store.promptPresets = copy(result.promptPresets);
          onState(stable(snapshot(store)) === accepted ? 'saved' : 'saving');
        } catch (error) { onState('error', error); throw error; }
      });
      chain = operation;
      return operation;
    },
  };
}
