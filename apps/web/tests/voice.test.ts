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

describe('brand voice — size limit', () => {
  it('drops examples from the end above the limit, keeps the rules, and matches the server', async () => {
    const { fitVoice, MAX_VOICE_CHARS } = await import('../../../docs/catalog.js');
    const { fitVoice: serverFit } =
      await import('../../../packages/execution-runtime/src/context.ts');
    const long = Array.from(
      { length: 6 },
      (_, i) => `Пример ${i + 1}. ${'слово '.repeat(250)}`
    ).join('\n---\n');
    const config = { ...VOICE, examples: long };
    const fit = fitVoice(config);
    expect(fit).toEqual(serverFit(config));
    expect(fit.text.length).toBeLessThanOrEqual(MAX_VOICE_CHARS);
    expect(fit.dropped).toBeGreaterThan(0);
    expect(fit.examples).toBe(6);
    expect(fit.text).toContain('Пример 1.');
    expect(fit.text).not.toContain('Пример 6.');
    expect(fit.text).toContain('- Never use: канцелярит');
    expect(fitVoice(VOICE).dropped).toBe(0);
  });
});

describe('context steps — link rules in the editor', () => {
  const a = {
    nodes: [
      { id: 't', action: 'manual.run', config: {} },
      { id: 'rss', action: 'rss.read', config: {} },
      { id: 'voice', action: 'context.voice', config: {} },
      { id: 'tpl', action: 'context.prompt', config: {} },
      { id: 'ai', action: 'ai.process', config: {} },
      { id: 'tg', action: 'telegram.sendMessage', config: {} },
    ],
    edges: [],
  };

  it('allows what the server allows and names the reason otherwise', async () => {
    const { linkProblem } = await import('../../../docs/engine.js');
    const key = (s, t) => linkProblem(a, s, t)?.key ?? null;
    expect(key('voice', 'ai')).toBe(null);
    expect(key('rss', 'tpl')).toBe(null);
    expect(key('tpl', 'ai')).toBe(null);
    expect(key('rss', 'ai')).toBe(null);
    expect(key('t', 'voice')).toBe('cv.ctxNoInput');
    expect(key('voice', 'tg')).toBe('cv.ctxTarget');
    expect(key('voice', 'tpl')).toBe('cv.ctxFromCtx');
    expect(key('ai', 't')).toBe('cv.triggerNoInput');
    expect(linkProblem(a, 'voice', 'tg').params.list).toMatch(
      /Process text with AI|Обработать текст с помощью ИИ/
    );
  });

  it('derives the same rules as the server’s list', async () => {
    const { contextConsumers } = await import('../../../docs/engine.js');
    const { CONTEXT_LINKS } =
      await import('../../../packages/workflow-schema/src/validation/graph-validator.ts');
    const { ACTIONS: A } = await import('../../../docs/catalog.js');
    const contextIds = Object.keys(A).filter((id) => A[id].kind === 'context');
    expect(contextIds.map((id) => A[id].type).sort()).toEqual(Object.keys(CONTEXT_LINKS).sort());
    for (const id of contextIds) {
      const rule = CONTEXT_LINKS[A[id].type];
      expect(contextConsumers(id).map((c) => A[c].type)).toEqual(rule.consumers);
      expect(!A[id].noInputs).toBe(rule.inputs);
    }
  });
});

describe('text review, approval, and rules from examples', () => {
  it('the reviewer takes a voice, judges without rewriting, and can stop the scenario', async () => {
    const { ACTIONS: A } = await import('../../../docs/catalog.js');
    const { contextConsumers } = await import('../../../docs/engine.js');
    const r = A['ai.review'];
    expect(r.type).toBe('ai.review');
    expect(r.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['text', 'voice', 'stopIfFails', 'criteria', 'passScore'])
    );
    expect(contextConsumers('context.voice')).toEqual(['ai.process', 'ai.review']);
    expect(contextConsumers('context.prompt')).toEqual(['ai.process']);
    const ap = A['logic.approval'];
    expect(ap.type).toBe('core.approval');
    expect(ap.fields.find((f) => f.key === 'content')).toMatchObject({
      required: true,
      acceptsData: true,
    });
  });

  it('reads the AI’s draft of rules: known keys only, emoji from the list only', async () => {
    const { parseVoiceDraft, splitExamples } = await import('../../../docs/catalog.js');
    expect(
      parseVoiceDraft(
        'Вот: {"language": "русский", "tone": ["тёплый", "простой"], "emoji": "many", "secret": "x", "cta": ""}'
      )
    ).toEqual({ language: 'русский', tone: 'тёплый, простой' });
    expect(parseVoiceDraft('нет JSON')).toBe(null);
    expect(parseVoiceDraft('{"emoji": "lots"}')).toBe(null);
    // Split the same way as the server's voice.
    const text = 'Один.\n---\nДва.\n\n\n\nТри.';
    expect(splitExamples(text)).toEqual(['Один.', 'Два.', 'Три.']);
    const { fitVoice } = await import('../../../packages/execution-runtime/src/context.ts');
    expect(fitVoice({ examples: text }).examples).toBe(3);
  });

  it('a run waiting for approval shows what to decide on', async () => {
    const { toRun } = await import('../../../docs/live.js');
    const a = {
      id: 'wf',
      name: 'x',
      nodes: [
        { id: 'trigger', action: 'manual.run', config: {} },
        { id: 'ok', action: 'logic.approval', config: { content: 'x' } },
      ],
      edges: [{ id: 'e', source: 'trigger', target: 'ok' }],
    };
    const run = toRun(
      {
        id: 'r1',
        workflowId: 'wf',
        status: 'WAITING',
        createdAt: new Date().toISOString(),
        steps: [
          {
            nodeId: 'ok',
            status: 'PENDING',
            outputPayload: {
              approval: true,
              title: 'Пост',
              content: 'Текст поста',
              waitingUntil: new Date(Date.now() + 3600_000).toISOString(),
            },
          },
        ],
      },
      [a]
    );
    expect(run.result).toBe('waiting');
    const step = run.steps.find((s) => s.nodeId === 'ok');
    expect(step.status).toBe('approval');
    expect(step.output.content).toBe('Текст поста');
  });
});

describe('library versions — compare and roll back', () => {
  it('compares a version with the step and loads a chosen version into it', async () => {
    const { diffConfigs } = await import('../../../docs/presets.js');
    const one = savePreset([], VOICE, { newId: 'vp_a' });
    const two = savePreset(one.list, { ...VOICE, tone: 'дружелюбный', avoid: '' }, { id: 'vp_a' });
    const step = applyPreset({ other: 1 }, two.preset);
    expect(diffConfigs(step, two.preset.versions[0].config)).toEqual([
      { key: 'tone', from: 'дружелюбный', to: 'экспертный' },
      { key: 'avoid', from: '', to: 'канцелярит' },
    ]);
    const back = applyPreset(step, two.preset, undefined, 1);
    expect(back).toMatchObject({
      tone: 'экспертный',
      avoid: 'канцелярит',
      presetVersion: 1,
      other: 1,
    });
    expect(presetStatus(two.list, back)).toMatchObject({ newer: true, edited: false, latest: 2 });
  });

  it('a rollback adds a version and keeps the history', async () => {
    const { restoreVersion } = await import('../../../docs/presets.js');
    const one = savePreset([], VOICE, { newId: 'vp_a' });
    const two = savePreset(one.list, { ...VOICE, tone: 'дружелюбный' }, { id: 'vp_a' });
    const r = restoreVersion(two.list, 'vp_a', 1);
    expect(r.link).toEqual({ presetId: 'vp_a', presetVersion: 3 });
    expect(r.preset.versions.map((v) => [v.version, v.config.tone])).toEqual([
      [1, 'экспертный'],
      [2, 'дружелюбный'],
      [3, 'экспертный'],
    ]);
    expect(restoreVersion(two.list, 'vp_a', 9).link).toBe(null);
  });
});

describe('text review in run history', () => {
  it('says how many items passed, or the score and the problems', async () => {
    const { toRun } = await import('../../../docs/live.js');
    const a = {
      id: 'wf',
      name: 'x',
      nodes: [{ id: 'rv', action: 'ai.review', config: {} }],
      edges: [],
    };
    const run = (out) =>
      toRun(
        {
          id: 'r',
          workflowId: 'wf',
          status: 'SUCCEEDED',
          steps: [{ nodeId: 'rv', status: 'SUCCEEDED', outputPayload: out }],
        },
        [a]
      ).steps[0].summary;
    expect(run({ count: 1, held: 2, items: [] })).toMatch(/1 (из|of) 3/);
    expect(run({ score: 4, passed: false, issues: ['канцелярит'], text: 'x' })).toMatch(
      /4\/10.*канцелярит/
    );
  });
});

describe('overlaps between steps — warnings that light up the steps involved', () => {
  const base = () => ({
    id: 'wf',
    name: 'A',
    nodes: [
      { id: 'trigger', action: 'manual.run', config: {} },
      { id: 'rss', action: 'rss.read', config: {} },
      { id: 'v1', action: 'context.voice', config: { name: 'Канал', language: 'русский' } },
      { id: 'v2', action: 'context.voice', config: { name: 'Второй' } },
      {
        id: 'tpl',
        action: 'context.prompt',
        config: {
          name: 'Пересказ',
          template: 'Перескажи {{ $item.title }}',
          forEach: '{{ $nodes.rss.output.items }}',
        },
      },
      { id: 'ai', action: 'ai.process', config: { input: 'x' } },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'rss' },
      { id: 'e2', source: 'rss', target: 'ai' },
      { id: 'e3', source: 'rss', target: 'tpl' },
    ],
  });
  const warn = async (a, id = 'ai', opts) => {
    const { stepWarnings } = await import('../../../docs/engine.js');
    return stepWarnings(
      a,
      a.nodes.find((n) => n.id === id),
      opts
    ).map((w) => [w.key, w.related]);
  };

  it('a clean AI step has none', async () => {
    expect(await warn(base())).toEqual([]);
  });

  it('two voices linked: the one not used is lit up; one linked but not chosen too', async () => {
    const a = base();
    a.edges.push(
      { id: 'ev1', source: 'v1', target: 'ai' },
      { id: 'ev2', source: 'v2', target: 'ai' }
    );
    a.nodes[5].config.voice = '{{ $nodes.v1.output }}';
    expect(await warn(a)).toEqual([['warn.several.voice', ['v2']]]);
    a.edges.pop();
    delete a.nodes[5].config.voice;
    expect(await warn(a)).toEqual([['warn.notChosen.voice', ['v1']]]);
  });

  it('template plus “What to do”, a per-item template on a once-only step, languages that differ', async () => {
    const a = base();
    a.edges.push(
      { id: 'et', source: 'tpl', target: 'ai' },
      { id: 'ev', source: 'v1', target: 'ai' }
    );
    Object.assign(a.nodes[5].config, {
      prompt: '{{ $nodes.tpl.output }}',
      voice: '{{ $nodes.v1.output }}',
      instruction: 'Переведи на английский',
    });
    expect(await warn(a)).toEqual([
      ['warn.twoSources', ['tpl']],
      ['warn.templatePerItem', ['tpl']],
      ['warn.language', ['v1', 'tpl']],
    ]);
    a.nodes[5].config.forEach = '{{ $nodes.rss.output.items }}';
    expect((await warn(a)).map((w) => w[0])).not.toContain('warn.templatePerItem');
  });

  it('the approvals bot must not be a bot that starts scenarios — here or in another one', async () => {
    const a = {
      id: 'wf',
      name: 'A',
      nodes: [
        { id: 'tg', action: 'telegram.newMessage', config: {}, connectionId: 'bot1' },
        { id: 'ap', action: 'telegram.approval', config: {}, connectionId: 'bot1' },
      ],
      edges: [{ id: 'e', source: 'tg', target: 'ap' }],
    };
    expect(await warn(a, 'ap')).toEqual([['warn.sameBot', ['tg']]]);
    a.nodes[0].connectionId = 'bot2';
    const other = {
      id: 'wf2',
      name: 'Другой',
      nodes: [{ id: 't', action: 'telegram.newMessage', connectionId: 'bot1' }],
      edges: [],
    };
    expect(await warn(a, 'ap', { automations: [a, other] })).toEqual([['warn.sameBotOther', []]]);
  });

  it('every warning has a text and a short text in both languages', async () => {
    const { __DICT_FOR_TESTS } = await import('../../../docs/i18n.js');
    const keys = [
      'twoSources',
      'several.voice',
      'several.prompt',
      'notChosen.voice',
      'notChosen.prompt',
      'templatePerItem',
      'language',
      'sameBot',
      'sameBotOther',
    ];
    for (const lang of ['ru', 'en'])
      for (const k of keys) {
        expect(__DICT_FOR_TESTS[lang][`warn.${k}`], `${lang} warn.${k}`).toBeTruthy();
        expect(__DICT_FOR_TESTS[lang][`warn.${k}.short`], `${lang} warn.${k}.short`).toBeTruthy();
      }
  });
});
