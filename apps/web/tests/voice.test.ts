import { describe, it, expect } from 'vitest';
import {
  ACTIONS,
  PICKER_GROUPS,
  voiceText,
  systemPrompt,
  userPrompt,
  askedLanguage,
} from '../../../docs/catalog.js';
import { savePreset, applyPreset, presetStatus } from '../../../docs/presets.js';
import { voiceText as serverVoiceText } from '../../../packages/execution-runtime/src/context.ts';
import {
  systemPrompt as serverSystemPrompt,
  userPrompt as serverUserPrompt,
} from '../../../packages/execution-runtime/src/process.ts';

const VOICE = {
  name: 'Канал о дизайне',
  language: 'русский',
  audience: 'дизайнеры',
  tone: 'экспертный',
  writeLike: 'Коротко.',
  avoid: 'канцелярит',
  examples: 'Первый.\n---\nВторой.\n\n\n\nТретий.',
  length: '2–3 предложения',
  terms: 'айдентика',
  cta: 'без призывов',
  emoji: 'few',
};

describe('brand voice — the editor shows what the model gets', () => {
  it('builds the same voice, system and task text as the server', () => {
    expect(voiceText(VOICE)).toBe(serverVoiceText(VOICE));
    expect(voiceText({})).toBe(serverVoiceText({}));
    expect(systemPrompt(voiceText(VOICE))).toBe(serverSystemPrompt(serverVoiceText(VOICE)));
    expect(systemPrompt('')).toBe(serverSystemPrompt(undefined));
    for (const perItem of [false, true])
      expect(userPrompt('Перескажи', 'данные', '', perItem)).toBe(
        serverUserPrompt('Перескажи', 'данные', '', perItem)
      );
  });

  it('puts the voice after the rules and the “instruction wins” line, examples split by ---', () => {
    const sys = systemPrompt(voiceText(VOICE));
    expect(sys.indexOf('You process data')).toBe(0);
    expect(sys.indexOf('follow the instruction')).toBeLessThan(sys.indexOf('Brand voice'));
    expect(voiceText(VOICE)).toContain('---\nПервый.\n---\nВторой.\n---\nТретий.\n---');
  });

  it('is a context step in its own menu group, and the AI step can take a voice', () => {
    const act = ACTIONS['context.voice'];
    expect(act.kind).toBe('context');
    expect(act.name.ru).toBe('Голос бренда');
    expect(act.needs.ru).toBeTruthy();
    expect(act.gives.ru).toBeTruthy();
    const group = PICKER_GROUPS.find((g) => g.id === 'context');
    expect(group?.match(act)).toBe(true);
    expect(PICKER_GROUPS.filter((g) => g.match(act))).toHaveLength(1);
    const voice = ACTIONS['ai.process'].fields.find((f) => f.key === 'voice');
    expect(voice).toMatchObject({ type: 'voice', required: false });
    const sim = act.simulate({ ...VOICE, presetVersion: 2 });
    expect(sim.output).toMatchObject({ voice: voiceText(VOICE), name: VOICE.name, version: 2 });
  });

  it('notices when the instruction and the voice ask for different languages', () => {
    expect(askedLanguage('Переведи на английский')).toBe('en');
    expect(askedLanguage('русский')).toBe('ru');
    expect(askedLanguage('Сделай саммари')).toBe(null);
  });
});

describe('brand voice presets — versions', () => {
  it('saves a new preset at version 1 and links the step to it', () => {
    const r = savePreset([], VOICE, { now: 1, newId: 'vp_a' });
    expect(r.list).toHaveLength(1);
    expect(r.preset).toMatchObject({ id: 'vp_a', name: 'Канал о дизайне' });
    expect(r.link).toEqual({ presetId: 'vp_a', presetVersion: 1 });
  });

  it('adds a version only when the voice changed', () => {
    const one = savePreset([], VOICE, { newId: 'vp_a' });
    const again = savePreset(one.list, { ...VOICE, ...one.link }, { id: 'vp_a' });
    expect(again.link.presetVersion).toBe(1);
    expect(again.list).toBe(one.list);
    const two = savePreset(one.list, { ...VOICE, tone: 'дружелюбный' }, { id: 'vp_a' });
    expect(two.link.presetVersion).toBe(2);
    expect(two.preset.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(two.list).toHaveLength(1);
  });

  it('a step on an older version sees the newer one, and updating copies it in', () => {
    const one = savePreset([], VOICE, { newId: 'vp_a' });
    const step = { ...VOICE, ...one.link, other: 'kept' };
    const two = savePreset(one.list, { ...VOICE, tone: 'дружелюбный' }, { id: 'vp_a' });
    // The library changed; the step did not.
    expect(step.tone).toBe('экспертный');
    expect(presetStatus(two.list, step)).toMatchObject({ latest: 2, newer: true, edited: false });
    const updated = applyPreset(step, two.preset);
    expect(updated).toMatchObject({ tone: 'дружелюбный', presetVersion: 2, other: 'kept' });
    expect(presetStatus(two.list, updated)).toMatchObject({ newer: false, edited: false });
    expect(presetStatus(two.list, { ...updated, avoid: 'ничего' }).edited).toBe(true);
  });

  it('loading a preset clears voice fields the preset does not have', () => {
    const r = savePreset([], { name: 'Коротко' }, { newId: 'vp_b' });
    const out = applyPreset({ ...VOICE }, r.preset);
    expect(out.name).toBe('Коротко');
    expect(out.tone).toBeUndefined();
  });

  it('a step without a preset or with a deleted one has no status', () => {
    expect(presetStatus([], VOICE)).toMatchObject({ preset: null, newer: false });
    expect(presetStatus([], { ...VOICE, presetId: 'gone' }).preset).toBe(null);
  });
});

describe('prompt template — a context step the AI step fills in', () => {
  it('is a context step with data from each item, and the AI step can take a template', async () => {
    const { ACTIONS: A } = await import('../../../docs/catalog.js');
    const act = A['context.prompt'];
    expect(act.kind).toBe('context');
    expect(act.itemVars).toBe(true);
    // Not a list processor: steps after it never repeat “for each item of the template”.
    expect(act.forEach).toBeFalsy();
    expect(act.fields.find((f) => f.key === 'template')).toMatchObject({
      acceptsData: true,
      required: true,
    });
    const ai = A['ai.process'].fields;
    expect(ai.find((f) => f.key === 'prompt')).toMatchObject({ type: 'prompt', required: false });
    expect(ai.find((f) => f.key === 'instruction')).toMatchObject({ requiredUnless: 'prompt' });
  });

  it('“What to do” is needed only when no template is linked', async () => {
    const { nodeIssues } = await import('../../../docs/engine.js');
    const a = {
      nodes: [
        { id: 'trigger', action: 'manual.run', config: {} },
        { id: 'ai', action: 'ai.process', config: { input: 'x' } },
      ],
      edges: [{ id: 'e', source: 'trigger', target: 'ai' }],
    };
    const fieldsMissing = (cfg) =>
      nodeIssues(
        { ...a, nodes: [a.nodes[0], { ...a.nodes[1], config: cfg }] },
        { ...a.nodes[1], config: cfg },
        []
      )
        .map((i) => i.field)
        .filter(Boolean);
    expect(fieldsMissing({ input: 'x' })).toContain('instruction');
    expect(fieldsMissing({ input: 'x', prompt: '{{ $nodes.tpl.output }}' })).not.toContain(
      'instruction'
    );
  });

  it('template presets keep only the template’s own fields and get versions', () => {
    const keys = ['name', 'template', 'description'];
    const one = savePreset(
      [],
      { name: 'Пересказ', template: 'A {{ $item.title }}', forEach: 'x' },
      { newId: 'pt_a', keys }
    );
    expect(one.preset.versions[0].config).toEqual({
      name: 'Пересказ',
      template: 'A {{ $item.title }}',
    });
    const two = savePreset(one.list, { name: 'Пересказ', template: 'B' }, { id: 'pt_a', keys });
    expect(two.link.presetVersion).toBe(2);
    const step = applyPreset(
      { template: 'A', forEach: 'x', presetId: 'pt_a', presetVersion: 1 },
      two.preset,
      keys
    );
    expect(step).toMatchObject({ template: 'B', forEach: 'x', presetVersion: 2 });
    expect(presetStatus(two.list, step, keys)).toMatchObject({ newer: false, edited: false });
  });
});
