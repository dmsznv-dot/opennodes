/**
 * Presets of context steps (brand voices, prompt templates): a library with versions. A step keeps its own copy of the
 * voice plus the preset id and version it came from, so editing the library never changes a
 * working scenario by itself — the step shows “a newer version is available” and the person
 * decides. Pure functions over plain data (the editor stores the list in store.voicePresets).
 */

/** The voice's own fields (not the step's bookkeeping). */
export const VOICE_KEYS = [
  'name',
  'language',
  'audience',
  'tone',
  'writeLike',
  'avoid',
  'examples',
  'length',
  'terms',
  'cta',
  'emoji',
];

/** A Prompt Template's own fields. */
export const PROMPT_KEYS = ['name', 'template', 'description'];

/** Which fields a preset of each context step keeps, and where the editor stores the library. */
export const PRESET_KINDS = {
  'context.voice': { keys: VOICE_KEYS, store: 'voicePresets' },
  'context.prompt': { keys: PROMPT_KEYS, store: 'promptPresets' },
};

const pick = (config = {}, keys = VOICE_KEYS) =>
  Object.fromEntries(
    keys.filter((k) => config[k] !== undefined && config[k] !== '').map((k) => [k, config[k]])
  );

const same = (x, y, keys) => JSON.stringify(pick(x, keys)) === JSON.stringify(pick(y, keys));

/**
 * Save the step's voice to the library. A step linked to a preset adds a new version of it
 * (only when something changed); any other step creates a preset at version 1.
 * Returns the new list, the preset, and the fields to put on the step.
 */
export function savePreset(
  list = [],
  config = {},
  { id = null, now = Date.now(), newId, keys = VOICE_KEYS } = {}
) {
  const existing = id ? list.find((p) => p.id === id) : null;
  if (existing) {
    const latest = existing.versions.at(-1);
    if (same(latest.config, config, keys))
      return {
        list,
        preset: existing,
        link: { presetId: existing.id, presetVersion: latest.version },
      };
    const version = latest.version + 1;
    const preset = {
      ...existing,
      name: config.name || existing.name,
      versions: [...existing.versions, { version, config: pick(config, keys), savedAt: now }],
    };
    return {
      list: list.map((p) => (p.id === existing.id ? preset : p)),
      preset,
      link: { presetId: preset.id, presetVersion: version },
    };
  }
  const preset = {
    id: newId ?? `vp_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: config.name || 'Preset',
    versions: [{ version: 1, config: pick(config, keys), savedAt: now }],
  };
  return { list: [...list, preset], preset, link: { presetId: preset.id, presetVersion: 1 } };
}

/** The step's config after loading a preset's latest version (the step's other settings stay). */
export function applyPreset(config = {}, preset, keys = VOICE_KEYS) {
  const latest = preset.versions.at(-1);
  const rest = Object.fromEntries(Object.entries(config).filter(([k]) => !keys.includes(k)));
  return { ...rest, ...latest.config, presetId: preset.id, presetVersion: latest.version };
}

/** Where the step stands against the library: its preset, and whether a newer version exists. */
export function presetStatus(list = [], config = {}, keys = VOICE_KEYS) {
  const preset = config.presetId ? list.find((p) => p.id === config.presetId) : null;
  if (!preset) return { preset: null, latest: null, newer: false, edited: false };
  const latest = preset.versions.at(-1);
  const own = preset.versions.find((v) => v.version === config.presetVersion);
  return {
    preset,
    latest: latest.version,
    newer: latest.version > (config.presetVersion ?? 0),
    edited: own ? !same(own.config, config, keys) : true,
  };
}
