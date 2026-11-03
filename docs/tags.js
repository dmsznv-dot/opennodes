/**
 * Ready-made data for text fields — what the data picker offers, by category.
 *
 * - **Data**: one value of an earlier step (a title, an AI answer, today's date).
 * - **Ready-made posts**: whole blocks of text with data in place — “title + text + link”,
 *   with a picture, with emoji… A block may also fill the step's picture field.
 * - **Current item**: with “for each item” on, the fields of the item being sent.
 *
 * Everything is plain template text (`**{{ $item.title }}**\n{{ $item.link }}`), so what a
 * block inserts can be edited like anything typed by hand. Pure data: no DOM here.
 */
import { ACTIONS, LIST_FIELDS, POST_FIELDS, RESULT_FIELD, SERVICES } from './catalog.js';
import { ancestorsOf, nodeTitle, stepNumbers, stepOrder } from './engine.js';
import { L } from './i18n.js';
import { buildExpr } from './tokens.js';

const tr = (ru, en) => ({ ru, en });
const tok = (p) => `{{ ${buildExpr(p)} }}`;

/** Fields whose text supports formatting: posts and messages (Markdown → each service's own). */
const RICH_TEXT = {
  'telegram.sendMessage': ['text'],
  'telegram.sendFile': ['caption'],
  'discord.sendMessage': ['text'],
  'slack.sendMessage': ['text'],
  'email.send': ['body', 'text'],
};
/** The field a block with a picture fills, per step. */
const IMAGE_FIELD = {
  'telegram.sendMessage': 'imageUrl',
  'telegram.sendFile': 'fileUrl',
  'discord.sendMessage': 'imageUrl',
  'slack.sendMessage': 'imageUrl',
};

/** Data that fits a field by its kind: `.image` (not `.images`), a chat, an email… */
const FITS = {
  imageUrl: /\.(image|postImage)$/,
  fileUrl: /\.(image|link|url)$/,
  chatId: /\.chatId$/,
  to: /\.email$/,
};

/** What a value is, for its chip's color: a picture, a link, or plain data. */
export function valueKind(expr) {
  const key = String(expr ?? '').match(/\.(\w+)(?:\.\w+\(.*\))?$/)?.[1] ?? '';
  if (/^(image|images|postImage|photo)$/.test(key)) return 'image';
  if (/^(link|links|url|fileUrl)$/.test(key)) return 'link';
  return '';
}

export function targetInfo(node, fieldKey) {
  const fields = ACTIONS[node.action]?.fields ?? [];
  const image = IMAGE_FIELD[node.action];
  return {
    rich: (RICH_TEXT[node.action] ?? []).includes(fieldKey),
    imageField: image && image !== fieldKey && fields.some((f) => f.key === image) ? image : null,
  };
}

// ── Lists: what “for each item” can go over, and the fields of one item ─────────

const LIST_RE = /^\s*\{\{\s*\$nodes\.([\w-]+)\.output\.(\w+)\s*\}\}\s*$/;

/**
 * The list a `forEach` value points at: its step, a title and the fields of one item.
 * The items of a step that itself repeats carry that step's `result` too.
 */
export function listSource(a, expr, seen = new Set()) {
  const m = String(expr ?? '').match(LIST_RE);
  if (!m) return null;
  const node = a.nodes.find((n) => n.id === m[1]);
  if (!node || seen.has(node.id)) return null;
  const act = ACTIONS[node.action];
  const n = stepNumbers(a).get(node.id);
  const out = act?.outputs?.find((o) => o.key === m[2] && o.list);
  if (out) {
    return { node, key: m[2], n, fields: LIST_FIELDS[out.list] ?? [], label: out.label };
  }
  if (m[2] === 'items' && act?.forEach && node.config?.forEach) {
    const inner = listSource(a, node.config.forEach, new Set([...seen, node.id]));
    if (!inner) return null;
    return {
      node,
      key: 'items',
      n,
      // The post's title and text first, then the item's own fields, then the raw answer.
      fields: [
        ...POST_FIELDS,
        ...inner.fields.filter((f) => !['result', 'postTitle', 'postText'].includes(f.key)),
        { ...RESULT_FIELD, label: resultLabel(a, node) },
      ],
      processedBy: [...(inner.processedBy ?? []), node],
      rootN: inner.rootN ?? inner.n,
      label: inner.label,
    };
  }
  return null;
}

const resultLabel = (a, node) =>
  tr(
    `Ответ шага ${stepNumbers(a).get(node.id)} целиком`,
    `Step ${stepNumbers(a).get(node.id)}’s whole answer`
  );

/**
 * Lists of earlier steps a step can repeat for: `[{ expr, label }]`, nearest first — one
 * per list. When steps in between already went through the same list item by item (an AI
 * translating each article), the choice is their output: the same items, with everything
 * those steps added. So a post per item has the AI's words and the item's picture at once.
 */
export function listChoices(a, node) {
  const up = ancestorsOf(a, node.id);
  const nums = stepNumbers(a);
  const order = stepOrder(a);
  const choices = [];
  for (const id of [...order].reverse()) {
    if (!up.has(id)) continue;
    const u = a.nodes.find((n) => n.id === id);
    for (const o of ACTIONS[u.action]?.outputs ?? []) {
      if (!o.list) continue;
      const root = `{{ $nodes.${u.id}.output.${o.key} }}`;
      const best = furthest(a, node, root);
      const via = best === root ? null : (listSource(a, best)?.processedBy ?? []);
      const steps = (via ?? []).map((p) => nums.get(p.id)).join(', ');
      choices.push({
        expr: best,
        root,
        // “For each item from step 2 (RSS feed) + the result of step 3”.
        label: tr(
          `из шага ${nums.get(id)} (${L(SERVICES[ACTIONS[u.action]?.service]?.name)})${via ? ` + результат шага ${steps}` : ''}`,
          `from step ${nums.get(id)} (${L(SERVICES[ACTIONS[u.action]?.service]?.name)})${via ? ` + the result of step ${steps}` : ''}`
        ),
      });
    }
  }
  return choices;
}

/** The furthest output, upstream of `node`, that carries the items of the list `root`. */
export function furthest(a, node, root) {
  const up = ancestorsOf(a, node.id);
  let current = root;
  for (let changed = true; changed;) {
    changed = false;
    for (const id of stepOrder(a)) {
      const u = a.nodes.find((n) => n.id === id);
      if (!up.has(id) || !ACTIONS[u.action]?.forEach || u.config?.forEach !== current) continue;
      current = `{{ $nodes.${u.id}.output.items }}`;
      changed = true;
      break;
    }
  }
  return current;
}

/** The choice a saved `forEach` belongs to: a raw list moves up to its furthest output. */
export function choiceFor(a, node, expr) {
  return listChoices(a, node).find((c) => c.expr === expr || c.root === expr) ?? null;
}

// ── Ready-made posts from the fields of one item ────────────────────────────────

/**
 * Layouts of a post — words only. The picture and the link are separate colored tags the
 * person puts where they want (the picture goes to the step's picture field), so a
 * layout never decides them. `{T}` title, `{B}` text, `{D}` date.
 */
const LAYOUTS = [
  { id: 'tb', name: tr('Заголовок + текст', 'Title + text'), tpl: '**{T}**\n\n{B}' },
  {
    id: 'dated',
    name: tr('Заголовок + дата + текст', 'Title + date + text'),
    tpl: '**{T}**\n_{D}_\n\n{B}',
    needs: ['date'],
  },
  // Bold title alone; without formatting it would be the plain title field itself.
  { id: 't', name: tr('Заголовок жирным', 'Title in bold'), tpl: '**{T}**', richOnly: true },
];

export const GROUPS = {
  posts: tr('Готовые посты', 'Ready-made posts'),
  all: tr('Все записи одним сообщением', 'All items in one message'),
  links: tr('Ссылка с вашим текстом', 'A link with your own words'),
  data: tr('Данные', 'Data'),
  blocks: tr('Готовые блоки', 'Ready-made blocks'),
};

/**
 * Posts made of an item's fields. `field(key)` gives the token of a field (or null when
 * the list has no such field). After an AI step the posts take its title and text
 * (`useAi`), else the item's own — its full text, or its summary (`short`).
 */
export function postPresets({
  field,
  keys,
  imageField,
  rich = true,
  prefix = 'p',
  useAi = true,
  short = false,
}) {
  const has = (k) => keys.includes(k) && field(k);
  const ai = useAi && has('postTitle') && has('postText');
  const titleKey = ai ? 'postTitle' : 'title';
  const bodyKey = ai
    ? 'postText'
    : short && has('summary')
      ? 'summary'
      : has('text')
        ? 'text'
        : 'summary';
  if (!has(titleKey)) return [];
  const out = [];
  for (const layout of LAYOUTS) {
    const tpl = L(layout.tpl);
    if ((layout.needs ?? []).some((k) => !has(k))) continue;
    if (layout.richOnly && !rich) continue;
    if (/\{B\}/.test(tpl) && !has(bodyKey)) continue;
    const template = (rich ? (x) => x : plain)(
      tpl
        .replace(/\{T\}/g, field(titleKey))
        .replace(/\{B\}/g, field(bodyKey) ?? '')
        .replace(/\{D\}/g, field('date') ?? '')
    );
    out.push({
      id: `${prefix}.${layout.id}`,
      kind: 'preset',
      group: 'posts',
      title: layout.name,
      template,
    });
  }
  return out;
}

/** Markdown markers out, for fields that do not format text (prompts, webhooks…). */
const plain = (s) =>
  s
    .replace(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g, '$1 — $2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 — $2')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\n)_([^_\n]+)_(?=\n|$)/g, '$1$2')
    .replace(/(^|\n)> /g, '$1');

const firstTokens = (nodeId) => {
  const map = {
    title: 'firstTitle',
    summary: 'firstSummary',
    text: 'firstText',
    link: 'link',
    image: 'image',
    date: 'firstDate',
  };
  return (k) => (map[k] ? tok({ scope: 'nodes', nodeId, key: map[k] }) : null);
};

function allItemsPresets(nodeId, { rich, imageField }) {
  const k = (key) => tok({ scope: 'nodes', nodeId, key });
  const md = (s) => (rich ? s : plain(s));
  const day = tok({ scope: 'now', key: 'dayMonth' });
  return [
    {
      id: 'all.digest',
      title: tr(
        'Дайджест: «Главное за 3 ноября» + заголовок — ссылка',
        'Digest: “Top for Nov 3” + title — link'
      ),
      template: tr(
        md(`**Главное за ${day}**\n\n${k('digest')}`),
        md(`**Top for ${day}**\n\n${k('digest')}`)
      ),
    },
    {
      id: 'all.numbered',
      title: tr('Нумерованный список с заголовком', 'Numbered list with a heading'),
      template: tr(
        md(`**Новое в ленте**\n\n${k('numbered')}`),
        md(`**New in the feed**\n\n${k('numbered')}`)
      ),
    },
    {
      id: 'all.forAi',
      title: tr('Для ИИ: заголовки и тексты со ссылками', 'For AI: titles and texts with links'),
      template: `${k('posts')}\n\n${k('links')}`,
    },
  ]
    .filter((x) => !x.needsImage || imageField)
    .map((x) => ({ ...x, kind: 'preset', group: 'all' }));
}

// ── Links with your own words: [Read more →](link) ────────────────────────────

const LINK_WORDS = [
  tr('Читать далее', 'Read more'),
  tr('Читать полностью →', 'Read the full story →'),
  tr('Подробнее', 'Details'),
  tr('Источник', 'Source'),
  tr('ваш текст', 'your text'),
];

function linkEntries(links) {
  const out = [];
  for (const l of links) {
    for (const w of LINK_WORDS) {
      out.push({
        id: `link.${l.id}.${w.en}`,
        kind: 'preset',
        group: 'links',
        title: tr(`«${w.ru}» → ${l.title.ru}`, `“${w.en}” → ${l.title.en}`),
        template: tr(`[${w.ru}](${l.token})`, `[${w.en}](${l.token})`),
      });
    }
  }
  return out;
}

/**
 * When a step repeats for a list (say RSS items) while an earlier step already did the same
 * for each item (an AI translating them), that step's result is not in `$item` — the post
 * would go out untranslated. Returns that step and the list that carries its result.
 */
export function processedBy(a, node, forEach) {
  const src = listSource(a, forEach);
  if (!src) return null;
  const up = ancestorsOf(a, node.id);
  for (const id of [...stepOrder(a)].reverse()) {
    if (!up.has(id)) continue;
    const u = a.nodes.find((n) => n.id === id);
    if (u.id === src.node.id) continue;
    if (ACTIONS[u.action]?.forEach && u.config?.forEach === forEach) {
      return { node: u, n: stepNumbers(a).get(u.id), expr: `{{ $nodes.${u.id}.output.items }}` };
    }
  }
  return null;
}

const listOut0 = (act) => (act?.outputs ?? []).some((o) => o.list);

// ── Date, run, formatting ─────────────────────────────────────────────────────

const NOW_KEYS = ['dateTime', 'dateRu', 'date', 'dayMonth', 'weekday', 'time', 'monthName', 'year'];

function datePresets(rich) {
  const n = (key) => tok({ scope: 'now', key });
  return [
    {
      id: 'now.today',
      title: tr('«Сегодня, 3 ноября, понедельник»', '“Today, 3 November, Monday”'),
      template: tr(
        `Сегодня, ${n('dayMonth')}, ${n('weekday')}`,
        `Today, ${n('dayMonth')}, ${n('weekday')}`
      ),
    },
    {
      id: 'now.digestHead',
      title: tr('Заголовок «Главное за 3 ноября»', 'Heading “Top for 3 November”'),
      template: tr(
        rich ? `**Главное за ${n('dayMonth')}**` : `Главное за ${n('dayMonth')}`,
        rich ? `**Top for ${n('dayMonth')}**` : `Top for ${n('dayMonth')}`
      ),
    },
    {
      id: 'now.stamp',
      title: tr('«🕒 03.11.2026, 10:15»', '“🕒 03.11.2026, 10:15”'),
      template: `🕒 ${n('dateRu')}, ${n('time')}`,
    },
    {
      id: 'now.weekdayDate',
      title: tr('«понедельник, 03.11.2026»', '“Monday, 03.11.2026”'),
      template: `${n('weekday')}, ${n('dateRu')}`,
    },
  ].map((x) => ({ ...x, kind: 'preset', group: 'blocks' }));
}

const SNIPPETS = [
  ['bold', tr('**Жирный**', '**Bold**'), tr('**жирный текст**', '**bold text**')],
  ['italic', tr('*Курсив*', '*Italic*'), tr('*курсив*', '*italic*')],
  ['strike', tr('~~Зачёркнутый~~', '~~Struck~~'), tr('~~зачёркнуто~~', '~~struck~~')],
  ['code', tr('`Код`', '`Code`'), '`code`'],
  [
    'link',
    tr('[Ссылка](адрес)', '[Link](url)'),
    tr('[текст ссылки](https://)', '[link text](https://)'),
  ],
  ['quote', tr('> Цитата', '> Quote'), tr('> цитата', '> quote')],
  ['bullet', tr('• Пункт списка', '• List item'), '• '],
  ['numbered', tr('1. Нумерованный пункт', '1. Numbered item'), '1. '],
  ['divider', tr('Разделитель ———', 'Divider ———'), '\n———\n'],
  [
    'heading',
    tr('# Заголовок (станет жирным)', '# Heading (shown bold)'),
    tr('# Заголовок', '# Heading'),
  ],
];
const EMOJI = [
  '📰',
  '🔥',
  '👉',
  '🔗',
  '✅',
  '⚠️',
  '📌',
  '💡',
  '🆕',
  '⭐',
  '📅',
  '🕒',
  '📣',
  '🚀',
  '❗',
  '🎯',
];

// ── The picker's categories ───────────────────────────────────────────────────

/**
 * Categories for a field: `[{ id, title, icon, hint, entries }]`. Entries:
 * `{ id, kind: 'data'|'preset'|'snippet', group, title, template, extra?, hint? }` —
 * `template` goes into the field, `extra` fills other fields (the picture).
 */
export function tagCategories(
  a,
  node,
  { fieldKey, forEach, seenKeys = {}, useAi = true, short = false } = {}
) {
  const target = targetInfo(node, fieldKey);
  const rich = target.rich;
  const nums = stepNumbers(a);
  const up = ancestorsOf(a, node.id);
  const upstream = stepOrder(a)
    .filter((id) => up.has(id))
    .map((id) => a.nodes.find((n) => n.id === id))
    .reverse();
  const cats = [];

  // 1. With “for each item”: the item's own fields first — like a mapping panel — then
  // a few ready-made posts made of them.
  const source = forEach ? listSource(a, forEach) : null;
  if (source) {
    const keys = source.fields.map((f) => f.key);
    const field = (k) => (keys.includes(k) ? tok({ scope: 'item', key: k }) : null);
    const hasAi = keys.includes('postTitle');
    const by = (source.processedBy ?? []).map((p) => nums.get(p.id)).join(', ');
    const FIELD_ORDER = [
      'postTitle',
      'postText',
      'title',
      'image',
      'text',
      'summary',
      'link',
      'date',
    ];
    const rank = (k) => (FIELD_ORDER.includes(k) ? FIELD_ORDER.indexOf(k) : 99);
    cats.push({
      id: 'item',
      title: tr('Текущая запись', 'Current item'),
      icon: '◆',
      hint: tr(
        `Поля записи, для которой выполняется шаг (из шага ${source.rootN ?? source.n}${by ? `, с результатом шага ${by}` : ''}). Вставляйте по одному и пишите текст между ними.`,
        `Fields of the item the step runs for (from step ${source.rootN ?? source.n}${by ? `, with the result of step ${by}` : ''}). Insert them one by one and type text in between.`
      ),
      entries: [...source.fields]
        .sort((x, y) => rank(x.key) - rank(y.key))
        .map((f) => ({
          id: `item.${f.key}`,
          kind: 'data',
          group: 'data',
          title: f.label,
          template: tok({ scope: 'item', key: f.key }),
          expr: buildExpr({ scope: 'item', key: f.key }),
          sample: f.example,
        })),
    });
    const ai = hasAi && useAi;
    cats.push({
      id: 'posts.item',
      title: tr('Готовые посты', 'Ready-made posts'),
      icon: '✦',
      // Whose words the posts take after an AI step, and how much of the item's text.
      aiToggle: hasAi ? { on: useAi, step: by } : null,
      shortToggle: !ai && keys.includes('summary') ? { on: short } : null,
      hint: ai
        ? tr(
            `Заголовок и текст — от ИИ (шаг ${by}), картинка и ссылка — из записи.`,
            `Title and text from the AI (step ${by}); picture and link from the item.`
          )
        : tr(
            'Целый пост из полей записи. Вставленное можно править как обычный текст.',
            'A whole post from the item’s fields. Edit what it inserts like any text.'
          ),
      entries: postPresets({
        field,
        keys,
        imageField: target.imageField,
        rich,
        prefix: 'item',
        useAi,
        short,
      }),
    });
  }

  // Links with your own words: the item's link, a step's link.
  const links = [];
  if (source?.fields.some((f) => f.key === 'link')) {
    links.push({
      id: 'item',
      title: tr('ссылка записи', 'the item’s link'),
      token: tok({ scope: 'item', key: 'link' }),
    });
  }
  for (const u of upstream) {
    // Per item, a list step's “first item” link would be the same in every post.
    if (source && listOut0(ACTIONS[u.action])) continue;
    for (const o of ACTIONS[u.action]?.outputs ?? []) {
      if (!['link', 'url'].includes(o.key)) continue;
      const isTrigger = ACTIONS[u.action]?.kind === 'trigger';
      links.push({
        id: `${u.action}.${o.key}`,
        title: tr(`шаг ${nums.get(u.id)}: ${o.label.ru}`, `step ${nums.get(u.id)}: ${o.label.en}`),
        token: tok(
          isTrigger
            ? { scope: 'trigger', key: o.key }
            : { scope: 'nodes', nodeId: u.id, key: o.key }
        ),
      });
    }
  }
  if (links.length && rich) {
    cats.push({
      id: 'links',
      title: tr('Ссылки с вашим текстом', 'Links with your own words'),
      icon: '🔗',
      hint: tr(
        'Текст в квадратных скобках станет ссылкой, сам адрес спрячется. Слова можно поменять прямо в поле. Любой тег-ссылку можно превратить в такую — нажмите на него в поле.',
        'The words in brackets become the link, the address itself is hidden. Change the words right in the field. Any link chip can become one — click it in the field.'
      ),
      entries: linkEntries(links),
    });
  }

  // 2. Earlier steps: their data, plus blocks made of it.
  for (const u of upstream) {
    const act = ACTIONS[u.action];
    const isTrigger = act?.kind === 'trigger';
    const ref = (key) =>
      isTrigger ? { scope: 'trigger', nodeId: null, key } : { scope: 'nodes', nodeId: u.id, key };
    const outs = [...(act?.outputs ?? [])];
    if (act?.forEach && u.config?.forEach) {
      outs.unshift(
        {
          key: 'results',
          label: tr('Все результаты одним текстом', 'All results as one text'),
          example: '…',
        },
        { key: 'count', label: tr('Сколько раз выполнен', 'How many times it ran'), example: '3' }
      );
    }
    // Fields the step really gave in the latest run (a form's own fields), after the known ones.
    for (const key of seenKeys[u.id] ?? []) {
      if (!outs.some((o) => o.key === key)) {
        outs.push({ key, label: tr(`Поле «${key}»`, `Field “${key}”`), example: '' });
      }
    }
    // Per item, “first item: …” would put the same first article into every post.
    const FIRST = ['firstTitle', 'firstText', 'firstSummary', 'firstDate', 'link', 'image'];
    const data = outs
      .filter((o) => !o.list && !(source && listOut0(act) && FIRST.includes(o.key)))
      .map((o) => ({
        id: `${u.id}.${o.key}`,
        kind: 'data',
        group: 'data',
        title: o.label,
        template: tok(ref(o.key)),
        expr: buildExpr(ref(o.key)),
        sample: o.example,
        ref: ref(o.key),
      }));
    const blocks = [];
    const listOut = outs.find((o) => o.list);
    if (listOut && !isTrigger) {
      if (!source) {
        blocks.push(
          ...postPresets({
            field: firstTokens(u.id),
            keys: ['title', 'summary', 'text', 'link', 'image', 'date'],
            imageField: target.imageField,
            rich,
            prefix: `${u.id}.first`,
            short,
          }).map((x) => ({
            ...x,
            title: tr(`Первая запись: ${x.title.ru}`, `First item: ${x.title.en}`),
          }))
        );
      }
      blocks.push(...allItemsPresets(u.id, { rich, imageField: target.imageField }));
    }
    if (data.length >= 2 && !listOut) {
      blocks.push({
        id: `${u.id}.all`,
        kind: 'preset',
        group: 'blocks',
        title: tr(
          'Все данные шага списком «Название: значение»',
          'All of the step’s data as “Name: value”'
        ),
        template: tr(
          data
            .map((d) => `${rich ? `**${d.title.ru}:**` : `${d.title.ru}:`} ${d.template}`)
            .join('\n'),
          data
            .map((d) => `${rich ? `**${d.title.en}:**` : `${d.title.en}:`} ${d.template}`)
            .join('\n')
        ),
      });
    }
    if (act?.customFields) {
      data.push({
        id: `${u.id}.custom`,
        kind: 'custom',
        group: 'data',
        title: tr('Другое поле формы…', 'Another form field…'),
        template: '',
        hint: tr(
          'Впишите название поля, как его присылает форма',
          'Type the field name as the form sends it'
        ),
      });
    }
    cats.push({
      id: `step.${u.id}`,
      nodeId: u.id,
      action: u.action,
      title: tr(
        `Шаг ${nums.get(u.id)} · ${nodeTitle(u)}`,
        `Step ${nums.get(u.id)} · ${nodeTitle(u)}`
      ),
      service: act?.service,
      hint: listOut
        ? source
          ? tr(
              'Данные всех записей сразу. Для поста о каждой — «Готовые посты — для каждой записи».',
              'Data of all items at once. For a post per item see “Ready-made posts — for each item”.'
            )
          : tr(
              'Здесь несколько записей. Чтобы отправить каждую отдельным постом, выберите «Для каждой записи» в настройках шага.',
              'There are several items here. To send each as its own post, pick “For each item” in the step’s settings.'
            )
        : null,
      entries: [...data.map(({ ref: _r, ...d }) => d), ...blocks],
    });
  }

  // 3. Date and time, the run.
  cats.push({
    id: 'now',
    title: tr('Дата и время', 'Date and time'),
    icon: '◷',
    hint: tr('Момент, когда шаг выполняется.', 'The moment the step runs.'),
    entries: [
      ...NOW_KEYS.map((key) => ({
        id: `now.${key}`,
        kind: 'data',
        group: 'data',
        title: { ru: `tok.now.${key}`, en: `tok.now.${key}` },
        i18nKey: `tok.now.${key}`,
        template: tok({ scope: 'now', key }),
        expr: buildExpr({ scope: 'now', key }),
        sys: key,
      })),
      ...datePresets(rich),
    ],
  });
  cats.push({
    id: 'run',
    title: tr('Запуск', 'Run'),
    icon: '▶',
    entries: ['id', 'triggerType'].map((key) => ({
      id: `run.${key}`,
      kind: 'data',
      group: 'data',
      title: { ru: `tok.run.${key}`, en: `tok.run.${key}` },
      i18nKey: `tok.run.${key}`,
      template: tok({ scope: 'run', key }),
      expr: buildExpr({ scope: 'run', key }),
      sys: key,
    })),
  });

  // 4. Formatting (only where the text is formatted).
  if (rich) {
    cats.push({
      id: 'format',
      title: tr('Оформление', 'Formatting'),
      icon: 'Aa',
      hint: tr(
        'Разметка станет оформлением в посте: **жирный**, *курсив*, [ссылка](адрес).',
        'Markup becomes formatting in the post: **bold**, *italic*, [link](url).'
      ),
      entries: [
        ...SNIPPETS.map(([id, title, text]) => ({
          id: `fmt.${id}`,
          kind: 'snippet',
          group: 'blocks',
          title,
          template: L(text),
        })),
        ...EMOJI.map((e) => ({
          id: `emoji.${e}`,
          kind: 'snippet',
          group: 'emoji',
          title: e,
          template: e,
        })),
      ],
    });
  }
  // What fits this very field first: for the picture, only pictures (one each — the list of
  // all pictures is not one picture); for the chat, the chat; for “To”, the email.
  const fits = FITS[fieldKey];
  if (fits) {
    const seen = new Set();
    const entries = cats
      .flatMap((c) => c.entries)
      .filter(
        (e) => e.kind === 'data' && fits.test(e.expr ?? '') && !seen.has(e.expr) && seen.add(e.expr)
      )
      .map((e) => ({ ...e, group: 'data' }));
    if (entries.length) {
      cats.unshift({
        id: 'fit',
        title: tr('Подходит для этого поля', 'Fits this field'),
        icon: '✓',
        entries,
      });
    }
  }
  // Blocks are written per language; the field gets the one for the interface language.
  return cats
    .map((c) => ({
      ...c,
      entries: c.entries.map((e) => ({
        ...e,
        template: L(e.template),
        // Favourites are kept across automations: a step's blocks by its kind, not its id.
        fav: c.nodeId ? e.id.split(c.nodeId).join(c.action) : e.id,
      })),
    }))
    .filter((c) => c.entries.length);
}

export { SERVICES };
