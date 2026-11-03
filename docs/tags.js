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
import { ACTIONS, LIST_FIELDS, RESULT_FIELD, SERVICES } from './catalog.js';
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

/** Output keys that are not text for a message (ids, counters, lists). */
const NOT_TEXT = new Set([
  'count',
  'status',
  'messageId',
  'rowCount',
  'length',
  'chatId',
  'firedAt',
  'items',
  'outputs',
  'total',
  'skipped',
]);

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
      fields: [
        { ...RESULT_FIELD, label: resultLabel(a, node) },
        ...inner.fields.filter((f) => f.key !== 'result'),
      ],
      label: inner.label,
    };
  }
  return null;
}

const resultLabel = (a, node) =>
  tr(
    `Результат шага ${stepNumbers(a).get(node.id)} (${L(ACTIONS[node.action]?.name)})`,
    `Result of step ${stepNumbers(a).get(node.id)} (${L(ACTIONS[node.action]?.name)})`
  );

/** Lists of earlier steps a step can repeat for: `[{ expr, label }]`, nearest first. */
export function listChoices(a, node) {
  const up = ancestorsOf(a, node.id);
  const nums = stepNumbers(a);
  const choices = [];
  for (const id of [...stepOrder(a)].reverse()) {
    if (!up.has(id)) continue;
    const u = a.nodes.find((n) => n.id === id);
    const act = ACTIONS[u.action];
    for (const o of act?.outputs ?? []) {
      if (!o.list) continue;
      choices.push({
        expr: `{{ $nodes.${u.id}.output.${o.key} }}`,
        label: tr(
          `Шаг ${nums.get(id)} · ${nodeTitle(u)}: ${L(o.label)}`,
          `Step ${nums.get(id)} · ${nodeTitle(u)}: ${L(o.label)}`
        ),
      });
    }
    if (act?.forEach && u.config?.forEach && listSource(a, u.config.forEach)) {
      choices.push({
        expr: `{{ $nodes.${u.id}.output.items }}`,
        label: tr(
          `Шаг ${nums.get(id)} · ${nodeTitle(u)}: записи с результатом`,
          `Step ${nums.get(id)} · ${nodeTitle(u)}: items with the result`
        ),
      });
    }
  }
  return choices;
}

// ── Ready-made posts from the fields of one item ────────────────────────────────

const BODY_NAMES = {
  result: tr('результат', 'result'),
  summary: tr('кратко', 'summary'),
  text: tr('текст', 'text'),
};

/**
 * Layouts of a post. `{T}` title, `{B}` body (text / summary / AI result), `{L}` link,
 * `{D}` date. The body-less ones come once; the others once per body.
 */
const LAYOUTS = [
  { id: 'tb', group: 'main', name: tr('Заголовок + {b}', 'Title + {b}'), tpl: '**{T}**\n\n{B}' },
  {
    id: 'tbl',
    group: 'main',
    name: tr('Заголовок + {b} + ссылка', 'Title + {b} + link'),
    tpl: '**{T}**\n\n{B}\n\n{L}',
  },
  {
    id: 'tlb',
    group: 'main',
    name: tr('Заголовок-ссылка + {b}', 'Linked title + {b}'),
    tpl: '**[{T}]({L})**\n\n{B}',
  },
  {
    id: 'more',
    group: 'main',
    name: tr('Заголовок + {b} + «Читать полностью →»', 'Title + {b} + “Read more →”'),
    tpl: tr('**{T}**\n\n{B}\n\n[Читать полностью →]({L})', '**{T}**\n\n{B}\n\n[Read more →]({L})'),
  },
  {
    id: 'dated',
    group: 'main',
    name: tr('Заголовок + дата + {b} + ссылка', 'Title + date + {b} + link'),
    tpl: '**{T}**\n_{D}_\n\n{B}\n\n{L}',
    needs: ['date'],
  },
  {
    id: 'emoji',
    group: 'styled',
    name: tr('📰 Заголовок + {b} + 🔗 ссылка', '📰 Title + {b} + 🔗 link'),
    tpl: '📰 **{T}**\n\n{B}\n\n🔗 {L}',
  },
  {
    id: 'announce',
    group: 'styled',
    name: tr('🔥 Анонс: заголовок + {b} + 👉 Подробнее', '🔥 Teaser: title + {b} + 👉 More'),
    tpl: tr('🔥 **{T}**\n\n{B}\n\n👉 [Подробнее]({L})', '🔥 **{T}**\n\n{B}\n\n👉 [More]({L})'),
  },
  {
    id: 'quote',
    group: 'styled',
    name: tr('Цитата: {b} — заголовок-ссылка', 'Quote: {b} — linked title'),
    tpl: '> {B}\n\n— [{T}]({L})',
  },
  { id: 'body', group: 'short', name: tr('Только {b}', '{b} only'), tpl: '{B}' },
  {
    id: 't',
    group: 'short',
    name: tr('Только заголовок', 'Title only'),
    tpl: '**{T}**',
    bodyless: true,
  },
  {
    id: 'tl',
    group: 'short',
    name: tr('Заголовок + ссылка', 'Title + link'),
    tpl: '**{T}**\n{L}',
    bodyless: true,
  },
  {
    id: 'dash',
    group: 'short',
    name: tr('Заголовок — ссылка (одной строкой)', 'Title — link (one line)'),
    tpl: '{T} — {L}',
    bodyless: true,
  },
  {
    id: 'bullet',
    group: 'short',
    name: tr('• Заголовок-ссылка (строка списка)', '• Linked title (a list line)'),
    tpl: '• [{T}]({L})',
    bodyless: true,
  },
  {
    id: 'td',
    group: 'short',
    name: tr('Заголовок + дата', 'Title + date'),
    tpl: '**{T}**\n_{D}_',
    bodyless: true,
    needs: ['date'],
  },
  { id: 'l', group: 'short', name: tr('Только ссылка', 'Link only'), tpl: '{L}', bodyless: true },
];

export const GROUPS = {
  top: tr('Популярные', 'Popular'),
  main: tr('Заголовок, текст, ссылка', 'Title, text, link'),
  image: tr('С картинкой', 'With a picture'),
  styled: tr('Оформленные', 'Styled'),
  short: tr('Короткие', 'Short'),
  all: tr('Все записи одним сообщением', 'All items in one message'),
  data: tr('Данные', 'Data'),
  blocks: tr('Готовые блоки', 'Ready-made blocks'),
};

/**
 * Posts made of an item's fields. `field(key)` gives the token of a field (or null when
 * the list has no such field). With a picture field on the step, each layout also comes
 * “+ picture”: the block fills that field with the item's picture.
 */
export function postPresets({ field, keys, imageField, rich = true, prefix = 'p' }) {
  const has = (k) => keys.includes(k) && field(k);
  const bodies = ['result', 'summary', 'text'].filter(has);
  const out = [];
  const add = (layout, body) => {
    if ((layout.needs ?? []).some((k) => !has(k))) return;
    if (!has('title') && /\{T\}/.test(L(layout.tpl))) return;
    if (!has('link') && /\{L\}/.test(L(layout.tpl))) return;
    const fill = (s) =>
      s
        .replace(/\{T\}/g, field('title'))
        .replace(/\{B\}/g, body ? field(body) : '')
        .replace(/\{L\}/g, field('link') ?? '')
        .replace(/\{D\}/g, field('date') ?? '');
    const template = (rich ? (s) => s : plain)(fill(L(layout.tpl)));
    const name = (lang) => layout.name[lang].replace('{b}', body ? BODY_NAMES[body][lang] : '');
    const base = {
      id: `${prefix}.${layout.id}${body ? `.${body}` : ''}`,
      kind: 'preset',
      title: tr(name('ru'), name('en')),
      template,
    };
    out.push({ ...base, group: layout.group });
    if (imageField && has('image') && layout.id !== 'l') {
      out.push({
        ...base,
        id: `${base.id}.img`,
        group: 'image',
        title: tr(`${base.title.ru} + картинка`, `${base.title.en} + picture`),
        extra: { [imageField]: field('image') },
      });
    }
  };
  for (const layout of LAYOUTS) {
    if (layout.bodyless) add(layout, null);
    else for (const body of bodies) add(layout, body);
  }
  if (imageField && has('image')) {
    out.push({
      id: `${prefix}.photo`,
      kind: 'preset',
      group: 'image',
      title: tr('Картинка + заголовок подписью', 'Picture + title as the caption'),
      template: rich ? `**${field('title')}**` : field('title'),
      extra: { [imageField]: field('image') },
    });
  }
  // The ladder people reach for first: title + text, + link, + picture — at the top.
  const body = bodies[0];
  const top = [
    `tb.${body}`,
    `tbl.${body}`,
    `tbl.${body}.img`,
    `more.${body}.img`,
    'tb.text',
    'tbl.text',
    'tbl.text.img',
  ]
    .map((id) => out.find((x) => x.id === `${prefix}.${id}`))
    .filter((x, i, arr) => x && arr.indexOf(x) === i);
  for (const x of top) x.group = 'top';
  const order = ['top', 'main', 'image', 'styled', 'short'];
  const rank = (x) => (x.group === 'top' ? top.indexOf(x) : 0);
  return out.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group) || rank(x) - rank(y));
}

/** Markdown markers out, for fields that do not format text (prompts, webhooks…). */
const plain = (s) =>
  s
    .replace(/\*\*\[([^\]]+)\]\(([^)]+)\)\*\*/g, '$1 — $2')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 — $2')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\n)_([^_\n]+)_(?=\n|$)/g, '$1$2')
    .replace(/(^|\n)> /g, '$1');

// ── Text values of a step: as is, bold, quoted… ─────────────────────────────────

function textPresets(token, label, { rich, prefix }) {
  const r = (md, txt) => (rich ? md : txt);
  return [
    { id: `${prefix}.bold`, title: tr('Жирным', 'Bold'), template: r(`**${token}**`, token) },
    {
      id: `${prefix}.titled`,
      title: tr(`С заголовком «${label.ru}»`, `With a heading “${label.en}”`),
      template: tr(
        r(`**${label.ru}**\n\n${token}`, `${label.ru}:\n${token}`),
        r(`**${label.en}**\n\n${token}`, `${label.en}:\n${token}`)
      ),
    },
    {
      id: `${prefix}.quote`,
      title: tr('Цитатой', 'As a quote'),
      template: r(`> ${token}`, `«${token}»`),
    },
    {
      id: `${prefix}.dated`,
      title: tr('С датой сверху', 'With the date on top'),
      template: `📅 ${tok({ scope: 'now', key: 'dateRu' })}\n\n${token}`,
    },
    {
      id: `${prefix}.code`,
      title: tr('Моноширинным блоком', 'As a code block'),
      template: r(`\`\`\`\n${token}\n\`\`\``, token),
    },
  ].map((x) => ({ ...x, kind: 'preset', group: 'blocks', title: x.title }));
}

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
      id: 'all.postsWithLinks',
      title: tr('Все записи: заголовок + кратко + ссылка', 'All items: title + summary + link'),
      template: k('postsWithLinks'),
    },
    {
      id: 'all.postsWithLinks.img',
      title: tr(
        'Все записи: заголовок + кратко + ссылка + картинка первой',
        'All items: title + summary + link + first picture'
      ),
      template: k('postsWithLinks'),
      extra: imageField ? { [imageField]: k('image') } : null,
      needsImage: true,
    },
    {
      id: 'all.postsShort',
      title: tr('Все записи: заголовок + кратко', 'All items: title + summary'),
      template: k('postsShort'),
    },
    {
      id: 'all.posts',
      title: tr('Все записи: заголовок + текст', 'All items: title + text'),
      template: k('posts'),
    },
    {
      id: 'all.titleLinks',
      title: tr('Список заголовков-ссылок', 'List of linked titles'),
      template: k('titleLinks'),
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
      id: 'all.count',
      title: tr('«🆕 Новых записей: 3» + список', '“🆕 New items: 3” + list'),
      template: tr(
        `🆕 Новых записей: ${k('count')}\n\n${k('bullets')}`,
        `🆕 New items: ${k('count')}\n\n${k('bullets')}`
      ),
    },
    {
      id: 'all.bullets',
      title: tr('Заголовки с точками •', 'Titles with bullets •'),
      template: k('bullets'),
    },
    { id: 'all.links', title: tr('Только ссылки', 'Links only'), template: k('links') },
    {
      id: 'all.forAi',
      title: tr('Для ИИ: заголовки и тексты со ссылками', 'For AI: titles and texts with links'),
      template: `${k('posts')}\n\n${k('links')}`,
    },
  ]
    .filter((x) => !x.needsImage || imageField)
    .map((x) => ({ ...x, kind: 'preset', group: 'all' }));
}

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
export function tagCategories(a, node, { fieldKey, forEach } = {}) {
  const target = targetInfo(node, fieldKey);
  const rich = target.rich;
  const nums = stepNumbers(a);
  const up = ancestorsOf(a, node.id);
  const upstream = stepOrder(a)
    .filter((id) => up.has(id))
    .map((id) => a.nodes.find((n) => n.id === id))
    .reverse();
  const cats = [];

  // 1. With “for each item”: the item's fields and posts made of them.
  const source = forEach ? listSource(a, forEach) : null;
  if (source) {
    const keys = source.fields.map((f) => f.key);
    const field = (k) => (keys.includes(k) ? tok({ scope: 'item', key: k }) : null);
    cats.push({
      id: 'posts.item',
      title: tr('Готовые посты — для каждой записи', 'Ready-made posts — for each item'),
      icon: '✦',
      hint: tr(
        `Шаг выполнится для каждой записи из шага ${source.n}; блок соберёт пост из её полей.`,
        `The step runs for each item of step ${source.n}; a block builds the post from its fields.`
      ),
      entries: postPresets({ field, keys, imageField: target.imageField, rich, prefix: 'item' }),
    });
    cats.push({
      id: 'item',
      title: tr('Текущая запись', 'Current item'),
      icon: '◆',
      hint: tr(
        'Поля той записи, для которой сейчас выполняется шаг.',
        'Fields of the item the step is running for.'
      ),
      entries: source.fields.map((f) => ({
        id: `item.${f.key}`,
        kind: 'data',
        group: 'data',
        title: f.label,
        template: tok({ scope: 'item', key: f.key }),
        expr: buildExpr({ scope: 'item', key: f.key }),
        sample: f.example,
      })),
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
    const data = outs
      .filter((o) => !o.list)
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
          }).map((x) => ({
            ...x,
            title: tr(`Первая запись: ${x.title.ru}`, `First item: ${x.title.en}`),
          }))
        );
      }
      blocks.push(...allItemsPresets(u.id, { rich, imageField: target.imageField }));
    }
    const texts = data.filter((d) => !NOT_TEXT.has(d.ref.key) && !listOut);
    for (const d of texts.slice(0, 4)) {
      blocks.push(
        ...textPresets(d.template, d.title, { rich, prefix: d.id }).map((x) => ({
          ...x,
          title: tr(
            `${d.title.ru}: ${x.title.ru.toLowerCase()}`,
            `${d.title.en}: ${x.title.en.toLowerCase()}`
          ),
        }))
      );
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
    cats.push({
      id: `step.${u.id}`,
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
  // Blocks are written per language; the field gets the one for the interface language.
  return cats
    .map((c) => ({ ...c, entries: c.entries.map((e) => ({ ...e, template: L(e.template) })) }))
    .filter((c) => c.entries.length);
}

export { SERVICES };
