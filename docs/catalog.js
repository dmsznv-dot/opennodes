/**
 * OpenNodes demo — service, action and template catalog.
 *
 * Users see *actions* ("Send a message"), not low-level primitives. Each action maps to a
 * real backend node type (`type`) from packages/connectors-core, connectors-ai or the
 * workflow-engine primitives; actions without a backend implementation are marked
 * `planned: true` and cannot be added.
 *
 * Field schema: { key, type: text|textarea|number|boolean|select|json, required, basic,
 *   label, placeholder?, help?, default?, options?: [{ value, label }], acceptsData? }
 */

import { L } from './i18n.js';

const tr = (ru, en) => ({ ru, en });
const clip = (s, n = 80) => {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

/** Fields of one item of a list output (`list: 'feedItem'`), for “each item” data. */
export const LIST_FIELDS = {
  feedItem: [
    {
      key: 'title',
      label: tr('Заголовок', 'Title'),
      example: tr('Новость дня', 'Story of the day'),
    },
    {
      key: 'summary',
      label: tr('Кратко (до 280 знаков)', 'Summary (up to 280 chars)'),
      example: tr('О чём запись — в двух строках…', 'What it is about, in two lines…'),
    },
    {
      key: 'text',
      label: tr('Текст целиком', 'Full text'),
      example: tr('Полный текст записи из ленты…', 'The item’s full text from the feed…'),
    },
    { key: 'link', label: tr('Ссылка', 'Link'), example: 'https://example.com/1' },
    {
      key: 'image',
      label: tr('Картинка (ссылка)', 'Picture (link)'),
      example: 'https://example.com/1.jpg',
    },
    { key: 'date', label: tr('Дата публикации', 'Published'), example: '03.11.2026 10:15' },
  ],
};

/** The result field each repeated step adds to its items. */
export const RESULT_FIELD = {
  key: 'result',
  label: tr('Результат шага для этой записи', 'The step’s result for this item'),
  example: tr('Заголовок от ИИ\nОтвет для этой записи…', 'AI title\nThe answer for this item…'),
};

/** The result split in two: an AI step asked to translate or rewrite puts the title first. */
export const RESULT_PARTS = [
  {
    key: 'resultTitle',
    label: tr('Результат: первая строка (заголовок от ИИ)', 'Result: first line (AI title)'),
    example: tr('Заголовок от ИИ', 'AI title'),
  },
  {
    key: 'resultBody',
    label: tr(
      'Результат без первой строки (текст от ИИ)',
      'Result without the first line (AI text)'
    ),
    example: tr('Ответ для этой записи…', 'The answer for this item…'),
  },
];

/** The same split the server does (execution-runtime splitResult). */
export function splitResult(text) {
  const lines = String(text ?? '').split('\n');
  const i = lines.findIndex((l) => l.trim());
  const rest =
    i < 0
      ? ''
      : lines
          .slice(i + 1)
          .join('\n')
          .trim();
  const first = i < 0 ? '' : lines[i].trim();
  if (!rest || first.length > 200)
    return { resultTitle: '', resultBody: String(text ?? '').trim() };
  const title = first
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^__(.+)__$/, '$1')
    .replace(/^(заголовок|title)\s*:\s*/i, '')
    .trim();
  return { resultTitle: title, resultBody: rest };
}

const SAMPLE_FEED = tr(
  [1, 2, 3].map((n) => ({
    title: `Пример заголовка ${n}`,
    text: `Текст записи ${n}: что произошло, кто участвовал и почему это важно. Подробности — по ссылке.`,
    link: `https://example.com/${n}`,
    image: `https://picsum.photos/seed/opennodes${n}/800/450`,
    pubDate: `2026-11-0${n}T10:15:00Z`,
  })),
  [1, 2, 3].map((n) => ({
    title: `Sample title ${n}`,
    text: `Text of item ${n}: what happened, who took part and why it matters. Details at the link.`,
    link: `https://example.com/${n}`,
    image: `https://picsum.photos/seed/opennodes${n}/800/450`,
    pubDate: `2026-11-0${n}T10:15:00Z`,
  }))
);

const pad2 = (n) => String(n).padStart(2, '0');
const shortText = (text, max = 280) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
};

/** The same fields the server's RSS step gives (execution-runtime summarizeFeed). */
export function feedSummary(raw) {
  const items = raw.map((i) => {
    const d = new Date(i.pubDate ?? '');
    const text = String(i.text ?? i.description ?? '').trim();
    return {
      ...i,
      title: String(i.title ?? '').trim(),
      text,
      summary: shortText(text),
      link: String(i.link ?? ''),
      image: String(i.image ?? ''),
      date: Number.isNaN(d.getTime())
        ? ''
        : `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    };
  });
  const each = (fn, sep = '\n') =>
    items
      .map(fn)
      .filter((x) => x.trim())
      .join(sep);
  const block = (...parts) => parts.filter(Boolean).join('\n');
  const first = items[0] ?? {};
  return {
    items,
    count: items.length,
    titles: each((i) => i.title),
    numbered: each((i, n) => (i.title ? `${n + 1}. ${i.title}` : '')),
    bullets: each((i) => (i.title ? `• ${i.title}` : '')),
    digest: each((i) => [i.title, i.link].filter(Boolean).join(' — ')),
    titleLinks: each((i) => (i.title && i.link ? `[${i.title}](${i.link})` : i.title)),
    posts: each((i) => block(i.title && `**${i.title}**`, i.text), '\n\n'),
    postsShort: each((i) => block(i.title && `**${i.title}**`, i.summary), '\n\n'),
    postsWithLinks: each((i) => block(i.title && `**${i.title}**`, i.summary, i.link), '\n\n'),
    texts: each((i) => i.text, '\n\n'),
    links: each((i) => i.link),
    images: each((i) => i.image),
    firstTitle: first.title ?? '',
    firstText: first.text ?? '',
    firstSummary: first.summary ?? '',
    firstDate: first.date ?? '',
    link: first.link ?? '',
    image: items.find((i) => i.image)?.image ?? '',
  };
}

export const SERVICES = {
  manual: { name: tr('Тестовый запуск', 'Test run'), icon: '▶', color: '#64748b', auth: false },
  schedule: { name: tr('Расписание', 'Schedule'), icon: '⏱', color: '#0ea5e9', auth: false },
  telegram: {
    name: tr('Telegram', 'Telegram'),
    icon: 'TG',
    color: '#229ed9',
    auth: true,
    needs: tr(
      [
        'Создайте бота у @BotFather и скопируйте токен.',
        'Добавьте бота в нужный чат или канал.',
        'Нажмите «Проверить подключение» — OpenNodes вызовет getMe.',
      ],
      [
        'Create a bot with @BotFather and copy its token.',
        'Add the bot to the chat or channel.',
        'Press “Check connection” — OpenNodes will call getMe.',
      ]
    ),
  },
  ai: {
    name: tr('AI (OpenAI-совместимый)', 'AI (OpenAI-compatible)'),
    icon: 'AI',
    color: '#10a37f',
    auth: true,
    needs: tr(
      [
        'API-ключ OpenAI или любого совместимого провайдера.',
        'При необходимости — адрес API (base URL).',
      ],
      ['An API key for OpenAI or any compatible provider.', 'Optionally, the API base URL.']
    ),
  },
  ollama: {
    name: tr('Ollama (локальная модель)', 'Ollama (local model)'),
    icon: 'OL',
    color: '#475569',
    auth: false,
  },
  email: {
    name: tr('Email (SMTP)', 'Email (SMTP)'),
    icon: '✉',
    color: '#ea580c',
    auth: true,
    needs: tr(
      ['Адрес SMTP-сервера и порт.', 'Логин и пароль приложения (не основной пароль почты).'],
      ['SMTP server host and port.', 'Login and an app password (not your main mailbox password).']
    ),
  },
  mcp: {
    name: tr('MCP-серверы', 'MCP servers'),
    icon: 'MCP',
    color: '#0f766e',
    auth: true,
    needs: tr(
      [
        'Адрес MCP-сервера (Streamable HTTP), например из Composio, Zapier MCP или вашего сервера.',
        'Токен доступа, если сервер его требует.',
        'Через MCP AI-агент работает с Google Документами, Notion, GitHub и другими сервисами.',
      ],
      [
        'The MCP server address (Streamable HTTP), e.g. from Composio, Zapier MCP or your own server.',
        'An access token if the server needs one.',
        'Through MCP the AI agent works with Google Docs, Notion, GitHub and other services.',
      ]
    ),
  },
  rss: { name: tr('RSS-лента', 'RSS feed'), icon: 'RSS', color: '#f97316', auth: false },
  webhook: {
    name: tr('Вебхук / форма', 'Webhook / form'),
    icon: '⇥',
    color: '#7c3aed',
    auth: false,
  },
  logic: { name: tr('Логика', 'Logic'), icon: '⑂', color: '#64748b', auth: false },
  http: {
    name: tr('HTTP-запрос', 'HTTP request'),
    icon: '{ }',
    color: '#334155',
    auth: false,
    dev: true,
  },
  postgres: {
    name: tr('PostgreSQL', 'PostgreSQL'),
    icon: 'PG',
    color: '#336791',
    auth: true,
    dev: true,
    needs: tr(['Строка подключения (DSN) к базе данных.'], ['A database connection string (DSN).']),
  },
  google_sheets: {
    name: tr('Google Таблицы', 'Google Sheets'),
    icon: 'GS',
    color: '#0f9d58',
    auth: true,
    planned: true,
  },
  google_drive: {
    name: tr('Google Диск', 'Google Drive'),
    icon: 'GD',
    color: '#4285f4',
    auth: true,
    planned: true,
  },
  google_calendar: {
    name: tr('Google Календарь', 'Google Calendar'),
    icon: 'GC',
    color: '#1a73e8',
    auth: true,
    planned: true,
  },
  notion: { name: tr('Notion', 'Notion'), icon: 'N', color: '#111827', auth: true, planned: true },
  slack: {
    name: tr('Slack', 'Slack'),
    icon: 'SL',
    color: '#4a154b',
    auth: true,
    needs: tr(
      [
        'В Slack: Apps → Incoming Webhooks → Add New Webhook, выберите канал.',
        'Скопируйте адрес вебхука (https://hooks.slack.com/…).',
      ],
      [
        'In Slack: Apps → Incoming Webhooks → Add New Webhook, pick a channel.',
        'Copy the webhook address (https://hooks.slack.com/…).',
      ]
    ),
  },
  discord: {
    name: tr('Discord', 'Discord'),
    icon: 'DC',
    color: '#5865f2',
    auth: true,
    needs: tr(
      [
        'В Discord: настройки канала → Интеграции → Вебхуки → Новый вебхук.',
        'Скопируйте URL вебхука (https://discord.com/api/webhooks/…).',
      ],
      [
        'In Discord: channel settings → Integrations → Webhooks → New Webhook.',
        'Copy the webhook URL (https://discord.com/api/webhooks/…).',
      ]
    ),
  },
};

/** Order of cards on the Connections page. */
export const SERVICE_ORDER = [
  'telegram',
  'ai',
  'mcp',
  'email',
  'ollama',
  'rss',
  'webhook',
  'schedule',
  'http',
  'postgres',
  'google_sheets',
  'google_drive',
  'google_calendar',
  'notion',
  'slack',
  'discord',
];

const MODEL_OPTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'].map((m) => ({
  value: m,
  label: m,
}));

export const ACTIONS = {
  // ── Triggers ────────────────────────────────────────────────────────────
  'manual.run': {
    type: 'trigger.manual',
    service: 'manual',
    kind: 'trigger',
    name: tr('Запуск вручную с тестовыми данными', 'Run manually with test data'),
    desc: tr(
      'Запускается кнопкой «Проверить». Ничего не ждёт извне.',
      'Starts when you press “Test”. Waits for nothing external.'
    ),
    keywords: 'вручную кнопка тест manual button test start',
    fields: [
      {
        key: 'sampleText',
        type: 'textarea',
        required: true,
        basic: true,
        label: tr('Тестовый текст', 'Test text'),
        default: tr(
          'Подскажи три идеи для выходных в городе.',
          'Suggest three ideas for a weekend in the city.'
        ),
      },
    ],
    outputs: [
      {
        key: 'text',
        label: tr('Тестовый текст', 'Test text'),
        example: tr('Подскажи три идеи…', 'Suggest three ideas…'),
      },
    ],
    simulate: (c) => ({
      output: { text: c.sampleText },
      summary: tr(
        `Запуск с текстом: «${clip(c.sampleText)}»`,
        `Started with text: “${clip(c.sampleText)}”`
      ),
    }),
  },
  'schedule.every': {
    type: 'trigger.cron',
    service: 'schedule',
    kind: 'trigger',
    name: tr('По расписанию', 'On a schedule'),
    desc: tr(
      'Запускается регулярно: каждый час, день или неделю.',
      'Runs regularly: every hour, day or week.'
    ),
    keywords:
      'расписание каждый день час неделя таймер cron schedule every daily hourly weekly timer',
    fields: [
      {
        key: 'every',
        type: 'select',
        required: true,
        basic: true,
        label: tr('Как часто', 'How often'),
        default: 'daily',
        options: [
          { value: 'every15m', label: tr('Каждые 15 минут', 'Every 15 minutes') },
          { value: 'hourly', label: tr('Каждый час', 'Every hour') },
          { value: 'daily', label: tr('Каждый день', 'Every day') },
          { value: 'weekly', label: tr('Каждый понедельник', 'Every Monday') },
        ],
      },
      {
        key: 'time',
        type: 'text',
        required: false,
        basic: true,
        label: tr('Время', 'Time'),
        default: '09:00',
        placeholder: '09:00',
        help: tr('Для ежедневного и еженедельного запуска.', 'For daily and weekly runs.'),
      },
      {
        key: 'timezone',
        type: 'select',
        required: true,
        basic: false,
        label: tr('Часовой пояс', 'Time zone'),
        default: 'Europe/Moscow',
        options: ['Europe/Moscow', 'Europe/Berlin', 'UTC', 'America/New_York', 'Asia/Almaty'].map(
          (v) => ({ value: v, label: v })
        ),
      },
      {
        key: 'cron',
        type: 'text',
        required: false,
        basic: false,
        label: tr('Своё cron-выражение', 'Custom cron expression'),
        placeholder: '0 9 * * 1-5',
        help: tr('Заменяет настройки выше.', 'Overrides the settings above.'),
      },
    ],
    outputs: [
      { key: 'firedAt', label: tr('Время запуска', 'Run time'), example: '2026-11-02T09:00:00Z' },
    ],
    simulate: (c) => ({
      output: { firedAt: new Date().toISOString(), timezone: c.timezone },
      summary: tr(
        'Запуск по расписанию (симуляция текущего момента)',
        'Scheduled run (simulating “now”)'
      ),
    }),
  },
  'telegram.newMessage': {
    type: 'trigger.telegram',
    service: 'telegram',
    kind: 'trigger',
    name: tr('Новое сообщение в Telegram', 'New Telegram message'),
    desc: tr('Когда боту пишут сообщение или команду.', 'When someone messages your bot.'),
    keywords:
      'telegram телеграм сообщение получить новое входящее бот message receive incoming bot',
    fields: [
      {
        key: 'onlyCommands',
        type: 'text',
        required: false,
        basic: false,
        label: tr('Только команды', 'Only commands'),
        placeholder: '/start, /ask',
        help: tr(
          'Оставьте пустым, чтобы реагировать на все сообщения.',
          'Leave empty to react to every message.'
        ),
      },
    ],
    outputs: [
      {
        key: 'text',
        label: tr('Текст сообщения', 'Message text'),
        example: tr('Когда вы работаете?', 'When are you open?'),
      },
      { key: 'fromName', label: tr('Имя отправителя', 'Sender name'), example: 'Анна' },
      { key: 'chatId', label: tr('Чат отправителя', 'Sender chat'), example: '123456789' },
    ],
    simulate: () => ({
      output: {
        text: L(tr('Когда вы работаете в выходные?', 'When are you open on weekends?')),
        fromName: L(tr('Анна', 'Anna')),
        chatId: '123456789',
      },
      summary: tr('Пример входящего сообщения от «Анна»', 'Sample incoming message from “Anna”'),
    }),
  },
  'webhook.receive': {
    type: 'trigger.webhook',
    service: 'webhook',
    kind: 'trigger',
    name: tr('Отправлена форма / входящий вебхук', 'Form submitted / incoming webhook'),
    desc: tr(
      'Когда сайт или сервис присылает данные на ваш адрес.',
      'When a site or service sends data to your URL.'
    ),
    keywords: 'форма заявка вебхук сайт webhook form submit lead incoming',
    fields: [
      {
        key: 'path',
        type: 'text',
        required: true,
        basic: true,
        label: tr('Адрес приёма', 'Receiving path'),
        default: '/hooks/lead-form',
      },
      {
        key: 'verifySignature',
        type: 'boolean',
        required: false,
        basic: false,
        label: tr('Проверять подпись HMAC', 'Verify HMAC signature'),
        default: false,
      },
    ],
    outputs: [
      { key: 'name', label: tr('Имя из формы', 'Name from form'), example: 'Иван' },
      { key: 'email', label: tr('Email из формы', 'Email from form'), example: 'ivan@example.com' },
      {
        key: 'message',
        label: tr('Сообщение из формы', 'Form message'),
        example: tr('Хочу демо', 'I want a demo'),
      },
      { key: 'budget', label: tr('Бюджет', 'Budget'), example: '1500' },
    ],
    simulate: () => ({
      output: {
        name: L(tr('Иван', 'Ivan')),
        email: 'ivan@example.com',
        message: L(tr('Хочу демо для команды из 10 человек', 'I want a demo for a team of 10')),
        budget: 1500,
      },
      summary: tr('Пример заявки с формы от «Иван»', 'Sample form submission from “Ivan”'),
    }),
  },

  // ── Actions ─────────────────────────────────────────────────────────────
  'ai.reply': {
    type: 'ai.openai',
    service: 'ai',
    kind: 'action',
    forEach: true,
    name: tr('AI: ответить на текст', 'AI: answer a text'),
    desc: tr(
      'Языковая модель пишет ответ по вашей инструкции.',
      'A language model writes an answer following your instructions.'
    ),
    keywords:
      'ai ии нейросеть gpt openai chatgpt ответ написать текст llm answer write generate summarize саммари кратко',
    fields: [
      {
        key: 'prompt',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Что сделать с текстом', 'What to do with the text'),
        placeholder: tr(
          'Ответь вежливо и кратко на вопрос клиента',
          'Answer the customer briefly and politely'
        ),
      },
      {
        key: 'model',
        type: 'select',
        required: true,
        basic: true,
        label: tr('Модель', 'Model'),
        default: 'gpt-4o-mini',
        options: MODEL_OPTIONS,
      },
      {
        key: 'temperature',
        type: 'number',
        required: false,
        basic: false,
        label: tr('Креативность (0–2)', 'Creativity (0–2)'),
        default: 0.7,
      },
      {
        key: 'maxTokens',
        type: 'number',
        required: false,
        basic: false,
        label: tr('Максимальная длина ответа (токены)', 'Max answer length (tokens)'),
      },
    ],
    outputs: [
      {
        key: 'text',
        label: tr('Ответ AI', 'AI answer'),
        example: tr('Мы работаем в субботу с 10 до 18.', 'We are open Saturday 10–6.'),
      },
    ],
    simulate: (c) => ({
      output: {
        text: L(
          tr(
            `[Пример ответа модели ${c.model}] на запрос «${clip(c.prompt, 60)}»`,
            `[Sample ${c.model} answer] to “${clip(c.prompt, 60)}”`
          )
        ),
      },
      summary: tr(
        `Модель ${c.model} вернула бы ответ на: «${clip(c.prompt, 60)}»`,
        `Model ${c.model} would answer: “${clip(c.prompt, 60)}”`
      ),
    }),
  },
  'ai.classify': {
    type: 'ai.classify',
    service: 'ai',
    kind: 'action',
    forEach: true,
    name: tr('AI: определить категорию', 'AI: classify text'),
    desc: tr(
      'Относит текст к одной из ваших категорий.',
      'Puts a text into one of your categories.'
    ),
    keywords: 'ai ии классификация категория тема сортировать classify category sort tag',
    fields: [
      {
        key: 'text',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Какой текст', 'Which text'),
      },
      {
        key: 'categories',
        type: 'text',
        required: true,
        basic: true,
        label: tr('Категории через запятую', 'Comma-separated categories'),
        default: tr('Вопрос, Жалоба, Заказ, Спам', 'Question, Complaint, Order, Spam'),
      },
      {
        key: 'model',
        type: 'select',
        required: true,
        basic: false,
        label: tr('Модель', 'Model'),
        default: 'gpt-4o-mini',
        options: MODEL_OPTIONS,
      },
    ],
    outputs: [
      { key: 'category', label: tr('Категория', 'Category'), example: tr('Вопрос', 'Question') },
    ],
    simulate: (c) => {
      const first = String(c.categories).split(',')[0].trim();
      return {
        output: { category: first },
        summary: tr(
          `Текст отнесён бы к категории «${first}» (пример)`,
          `Text would be classified as “${first}” (example)`
        ),
      };
    },
  },
  'ai.process': {
    type: 'ai.process',
    service: 'ai',
    kind: 'action',
    forEach: true,
    name: tr('AI: обработать данные по инструкции', 'AI: process data by instruction'),
    desc: tr(
      'Данные из прошлых шагов + что с ними сделать: пересказать, перевести, оформить. Может прочитать статьи по ссылкам.',
      'Data from earlier steps + what to do with it: summarize, translate, format. Can read the linked articles.'
    ),
    keywords:
      'обработать данные инструкция промпт саммари пересказ перевод перевести оформить статья ссылка prompt summary translate process format article link',
    fields: [
      {
        key: 'input',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Данные', 'Data'),
        placeholder: tr('{Шаг 2: Список: заголовок — ссылка}', '{Step 2: List: title — link}'),
        help: tr(
          'Что обрабатывать: вставьте данные прошлых шагов кнопками ниже.',
          'What to process: insert data from earlier steps with the buttons below.'
        ),
      },
      {
        key: 'instruction',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Что сделать', 'Instruction'),
        placeholder: tr(
          'Переведи на русский. Первой строкой — заголовок, ниже — текст.',
          'Translate into English. The title on the first line, the text below.'
        ),
        help: tr(
          'Чтобы в посте был и ваш заголовок от ИИ (например, переведённый), попросите: «Первой строкой — заголовок, ниже — текст». Тогда в данных появятся «заголовок от ИИ» и «текст от ИИ».',
          'For an AI-made title too (e.g. translated), ask: “the title on the first line, the text below”. The data then has “AI title” and “AI text”.'
        ),
      },
      {
        key: 'readLinks',
        type: 'boolean',
        required: false,
        basic: true,
        label: tr('Открыть ссылки и прочитать статьи', 'Open the links and read the articles'),
        help: tr(
          'Модель сама ссылки не открывает. Сервер скачает страницы по ссылкам из данных и передаст ей текст статей.',
          'A model cannot open links. The server fetches the pages linked in the data and gives it the article text.'
        ),
        default: false,
      },
      {
        key: 'maxLinks',
        type: 'number',
        required: false,
        basic: false,
        label: tr('Сколько ссылок читать', 'How many links to read'),
        default: 3,
      },
      {
        key: 'model',
        type: 'text',
        required: false,
        basic: false,
        label: tr('Модель', 'Model'),
        placeholder: 'gpt-4o-mini',
        help: tr(
          'Пусто — модель по умолчанию из подключения AI.',
          'Empty — the default model of the AI connection.'
        ),
      },
    ],
    outputs: [
      {
        key: 'text',
        label: tr('Результат', 'Result'),
        example: tr(
          'Алекс Рорисон: фото как объект\nФотограф работает с отпечатками как с материалом…',
          'Alex Rorison: photos as objects\nThe photographer treats prints as material…'
        ),
      },
    ],
    simulate: (c) => ({
      output: {
        text: L(
          tr(
            'Заголовок от ИИ (симуляция)\nПример результата по инструкции.',
            'AI title (simulation)\nSample result per the instruction.'
          )
        ),
        sources: [],
      },
      summary: tr(
        `AI выполнил бы «${clip(c.instruction, 60)}»${c.readLinks ? ', прочитав статьи по ссылкам' : ''}. В демо модель не вызывается.`,
        `AI would do “${clip(c.instruction, 60)}”${c.readLinks ? ', reading the linked articles' : ''}. The model is not called in the demo.`
      ),
    }),
  },
  'ai.agent': {
    type: 'ai.agent',
    service: 'ai',
    kind: 'action',
    external: true,
    name: tr('AI-агент с инструментами (MCP)', 'AI agent with tools (MCP)'),
    desc: tr(
      'Модель сама выполняет задачу через инструменты MCP-серверов: Google Документы, Notion, GitHub…',
      'The model does the task itself with the tools of MCP servers: Google Docs, Notion, GitHub…'
    ),
    keywords:
      'агент mcp инструменты google документы docs notion github ai ии нейросеть agent tools автоматически',
    fields: [
      {
        key: 'prompt',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Задача', 'Task'),
        placeholder: tr(
          'Создай Google-документ «Итоги дня» и запиши туда: {Шаг 1: Текст}',
          'Create a Google Doc “Daily notes” and write into it: {Step 1: Text}'
        ),
      },
      {
        key: 'servers',
        type: 'connections',
        service: 'mcp',
        required: true,
        basic: true,
        label: tr('MCP-серверы, которыми можно пользоваться', 'MCP servers the agent may use'),
      },
      {
        key: 'model',
        type: 'text',
        required: false,
        basic: false,
        label: tr('Модель', 'Model'),
        placeholder: 'gpt-4o-mini',
        help: tr(
          'Нужна модель с вызовом инструментов. Пусто — модель по умолчанию из подключения AI.',
          'Needs a model with tool calling. Empty — the default model of the AI connection.'
        ),
      },
      {
        key: 'allowedTools',
        type: 'text',
        required: false,
        basic: false,
        label: tr('Разрешённые инструменты', 'Allowed tools'),
        placeholder: 'create_document, append_text',
        help: tr(
          'Через запятую. Пусто — все инструменты выбранных серверов.',
          'Comma-separated. Empty — every tool of the chosen servers.'
        ),
      },
      {
        key: 'maxSteps',
        type: 'number',
        required: false,
        basic: false,
        label: tr('Максимум шагов агента', 'Max agent steps'),
        default: 6,
        help: tr(
          'Сколько раз модель может обратиться к инструментам (до 20).',
          'How many times the model may use tools (up to 20).'
        ),
      },
      {
        key: 'system',
        type: 'textarea',
        required: false,
        basic: false,
        label: tr('Инструкция для агента', 'Agent instructions'),
      },
    ],
    outputs: [
      {
        key: 'text',
        label: tr('Ответ агента', 'Agent answer'),
        example: tr(
          'Создал документ «Итоги дня» и записал в него 3 пункта.',
          'Created the “Daily notes” doc with 3 points.'
        ),
      },
    ],
    simulate: (c) => ({
      output: {
        text: L(tr('Готово (симуляция): задача выполнена.', 'Done (simulation): task completed.')),
        toolCalls: [],
      },
      summary: tr(
        `Агент выполнил бы задачу «${clip(c.prompt, 60)}» через MCP. В демо инструменты не вызываются.`,
        `The agent would do “${clip(c.prompt, 60)}” via MCP. Tools are not called in the demo.`
      ),
    }),
  },
  'ollama.reply': {
    type: 'ai.ollama',
    service: 'ollama',
    kind: 'action',
    forEach: true,
    name: tr('Локальная модель: ответить на текст', 'Local model: answer a text'),
    desc: tr(
      'То же, что AI-ответ, но на вашем сервере через Ollama.',
      'Like the AI answer, but on your own server via Ollama.'
    ),
    keywords: 'ollama локальная модель llama ai ии local model offline',
    fields: [
      {
        key: 'prompt',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Что сделать с текстом', 'What to do with the text'),
      },
      {
        key: 'model',
        type: 'text',
        required: true,
        basic: true,
        label: tr('Модель', 'Model'),
        default: 'llama3.2',
      },
      {
        key: 'baseUrl',
        type: 'text',
        required: true,
        basic: false,
        label: tr('Адрес Ollama', 'Ollama URL'),
        default: 'http://ollama:11434',
      },
    ],
    outputs: [
      {
        key: 'text',
        label: tr('Ответ модели', 'Model answer'),
        example: tr('Похоже, сервис перегружен…', 'Looks like the service is overloaded…'),
      },
    ],
    simulate: (c) => ({
      output: {
        text: L(
          tr(
            `[Пример ответа ${c.model}] на запрос «${clip(c.prompt, 60)}»`,
            `[Sample ${c.model} answer] to “${clip(c.prompt, 60)}”`
          )
        ),
      },
      summary: tr(
        `Локальная модель ${c.model} вернула бы ответ`,
        `Local model ${c.model} would return an answer`
      ),
    }),
  },
  'telegram.sendMessage': {
    type: 'core.telegramBot',
    service: 'telegram',
    kind: 'action',
    forEach: true,
    external: true,
    name: tr('Отправить сообщение в Telegram', 'Send a Telegram message'),
    desc: tr('Бот пишет в чат, группу или канал.', 'The bot posts to a chat, group or channel.'),
    keywords:
      'telegram телеграм отправить сообщение написать уведомить уведомление send message notify notification post',
    fields: [
      {
        key: 'chatId',
        type: 'text',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Куда отправить (чат или @канал)', 'Where to send (chat or @channel)'),
        placeholder: '@my_channel',
      },
      {
        key: 'text',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Текст сообщения', 'Message text'),
      },
      {
        key: 'parseMode',
        type: 'select',
        required: true,
        basic: false,
        label: tr('Оформление текста', 'Text formatting'),
        default: 'auto',
        options: [
          {
            value: 'auto',
            label: tr(
              'Авто: **жирный**, *курсив*, [ссылка](адрес)',
              'Auto: **bold**, *italic*, [link](url)'
            ),
          },
          {
            value: 'plain',
            label: tr('Без оформления — символы как есть', 'None — characters as typed'),
          },
          { value: 'HTML', label: tr('HTML (для опытных)', 'HTML (advanced)') },
        ],
        help: tr(
          'В режиме «Авто» разметка из текста и из ответа ИИ превращается в оформление Telegram.',
          'In “Auto” Markdown in the text and in AI answers becomes Telegram formatting.'
        ),
      },
      {
        key: 'imageUrl',
        type: 'text',
        required: false,
        basic: true,
        acceptsData: true,
        label: tr('Картинка (ссылка)', 'Picture (link)'),
        placeholder: 'https://example.com/cover.jpg',
        help: tr(
          'Пост выйдет одним сообщением: до 1024 символов — фото с подписью, длиннее — картинка над текстом.',
          'One post: up to 1024 characters it is a photo with a caption, longer — the picture above the text.'
        ),
      },
      {
        key: 'disablePreview',
        type: 'boolean',
        required: false,
        basic: false,
        label: tr('Не показывать превью ссылок', 'Disable link previews'),
        default: false,
      },
    ],
    outputs: [
      {
        key: 'messageId',
        label: tr('ID отправленного сообщения', 'Sent message ID'),
        example: '4521',
      },
    ],
    simulate: (c) => ({
      output: {
        simulated: true,
        wouldSendTo: c.chatId,
        text: c.text,
        ...(c.imageUrl && { photo: c.imageUrl }),
      },
      summary: tr(
        `Было бы отправлено в ${c.chatId}${c.imageUrl ? ' (с фото)' : ''}: «${clip(c.text)}». В демо ничего не отправлено.`,
        `Would send to ${c.chatId}: “${clip(c.text)}”. Nothing was sent in the demo.`
      ),
    }),
  },
  'telegram.sendFile': {
    type: 'telegram.sendFile',
    service: 'telegram',
    kind: 'action',
    forEach: true,
    external: true,
    name: tr('Отправить фото или файл в Telegram', 'Send a photo or file to Telegram'),
    desc: tr(
      'Картинка или документ по ссылке, с подписью.',
      'A picture or document by link, with a caption.'
    ),
    keywords:
      'telegram файл документ картинка фото изображение pdf file document image photo picture',
    fields: [
      {
        key: 'chatId',
        type: 'text',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Куда отправить (чат или @канал)', 'Where to send (chat or @channel)'),
        placeholder: '@my_channel',
      },
      {
        key: 'fileUrl',
        type: 'text',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Ссылка на файл', 'Link to the file'),
        placeholder: 'https://example.com/report.pdf',
      },
      {
        key: 'kind',
        type: 'select',
        required: true,
        basic: true,
        label: tr('Как отправить', 'Send as'),
        default: 'photo',
        options: [
          { value: 'photo', label: tr('Фото', 'Photo') },
          { value: 'document', label: tr('Документ', 'Document') },
        ],
      },
      {
        key: 'caption',
        type: 'textarea',
        required: false,
        basic: true,
        acceptsData: true,
        label: tr('Подпись', 'Caption'),
      },
      {
        key: 'parseMode',
        type: 'select',
        required: true,
        basic: false,
        label: tr('Оформление подписи', 'Caption formatting'),
        default: 'auto',
        options: [
          {
            value: 'auto',
            label: tr(
              'Авто: **жирный**, *курсив*, [ссылка](адрес)',
              'Auto: **bold**, *italic*, [link](url)'
            ),
          },
          {
            value: 'plain',
            label: tr('Без оформления — символы как есть', 'None — characters as typed'),
          },
          { value: 'HTML', label: tr('HTML (для опытных)', 'HTML (advanced)') },
        ],
      },
    ],
    outputs: [
      {
        key: 'messageId',
        label: tr('ID отправленного сообщения', 'Sent message ID'),
        example: '4522',
      },
    ],
    simulate: (c) => ({
      output: { simulated: true, wouldSendTo: c.chatId, file: c.fileUrl, caption: c.caption ?? '' },
      summary: tr(
        `Было бы отправлено в ${c.chatId}: ${c.kind === 'document' ? 'документ' : 'фото'} ${clip(c.fileUrl, 50)}. В демо ничего не отправлено.`,
        `Would send to ${c.chatId}: ${c.kind === 'document' ? 'document' : 'photo'} ${clip(c.fileUrl, 50)}. Nothing was sent in the demo.`
      ),
    }),
  },
  'email.send': {
    type: 'core.smtp',
    service: 'email',
    kind: 'action',
    forEach: true,
    external: true,
    name: tr('Отправить письмо', 'Send an email'),
    desc: tr('Письмо через ваш SMTP-сервер.', 'An email through your SMTP server.'),
    keywords: 'email письмо почта отправить mail e-mail smtp send notify уведомление',
    fields: [
      {
        key: 'to',
        type: 'text',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Кому', 'To'),
        placeholder: 'team@example.com',
      },
      {
        key: 'subject',
        type: 'text',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Тема', 'Subject'),
      },
      {
        key: 'body',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Текст письма', 'Email body'),
      },
      {
        key: 'isHtml',
        type: 'boolean',
        required: false,
        basic: false,
        label: tr('Текст в формате HTML', 'Body is HTML'),
        default: false,
      },
    ],
    outputs: [{ key: 'messageId', label: tr('ID письма', 'Message ID'), example: '<abc@mail>' }],
    simulate: (c) => ({
      output: { simulated: true, wouldSendTo: c.to, subject: c.subject },
      summary: tr(
        `Было бы отправлено письмо на ${c.to} с темой «${clip(c.subject, 50)}». В демо ничего не отправлено.`,
        `Would email ${c.to} with subject “${clip(c.subject, 50)}”. Nothing was sent in the demo.`
      ),
    }),
  },
  'email.receive': {
    service: 'email',
    kind: 'trigger',
    planned: true,
    name: tr('Новое письмо (IMAP)', 'New email (IMAP)'),
    desc: tr('Когда в ящик приходит письмо.', 'When an email arrives.'),
    keywords: 'email письмо получить входящее почта imap receive incoming mail',
  },
  'rss.read': {
    type: 'core.rss',
    service: 'rss',
    kind: 'action',
    name: tr('Получить новые записи RSS', 'Get new RSS items'),
    desc: tr('Читает ленту новостей или блога.', 'Reads a news or blog feed.'),
    keywords: 'rss лента новости блог feed news blog atom',
    fields: [
      {
        key: 'feedUrl',
        type: 'text',
        required: true,
        basic: true,
        label: tr('Адрес ленты', 'Feed URL'),
        placeholder: 'https://example.com/feed.xml',
        help: tr(
          'Можно указать и адрес сайта — если сайт объявляет свою ленту, она найдётся сама.',
          'A site address works too — if the site announces its feed, it is found automatically.'
        ),
      },
      {
        key: 'maxItems',
        type: 'number',
        required: true,
        basic: true,
        label: tr('Сколько записей брать', 'How many items'),
        default: 5,
      },
      {
        key: 'onlyNew',
        type: 'boolean',
        required: false,
        basic: false,
        label: tr('Только новые с прошлого запуска', 'Only items new since last run'),
        help: tr(
          'Каждая запись уйдёт дальше один раз. Если новых нет — следующие шаги не выполнятся. Проверка из редактора записи не «съедает».',
          'Each item goes on once. With nothing new the next steps do not run. Tests from the editor do not use items up.'
        ),
        default: true,
      },
      {
        key: 'rememberTests',
        type: 'boolean',
        required: false,
        basic: false,
        label: tr('Проверки тоже запоминают записи', 'Tests remember items too'),
        help: tr(
          'Каждая удачная проверка берёт следующие новые записи — удобно посмотреть, как шаги справятся с разными. Начать заново — «Сбросить память».',
          'Each successful test takes the next new items — handy to see how the steps cope with different ones. Start over with “Reset memory”.'
        ),
        default: true,
      },
    ],
    outputs: [
      {
        key: 'items',
        label: tr('Записи (каждая отдельно)', 'Items (each on its own)'),
        list: 'feedItem',
        example: tr('3 записи', '3 items'),
      },
      {
        key: 'postsWithLinks',
        label: tr('Все записи: заголовок + кратко + ссылка', 'All items: title + summary + link'),
        example: tr(
          '**Новость 1**\nО чём она…\nhttps://example.com/1',
          '**Story 1**\nWhat it says…\nhttps://example.com/1'
        ),
      },
      {
        key: 'postsShort',
        label: tr('Все записи: заголовок + кратко', 'All items: title + summary'),
        example: tr('**Новость 1**\nО чём она…', '**Story 1**\nWhat it says…'),
      },
      {
        key: 'posts',
        label: tr('Все записи: заголовок + текст', 'All items: title + text'),
        example: tr('**Новость 1**\nПолный текст…', '**Story 1**\nFull text…'),
      },
      {
        key: 'digest',
        label: tr('Список: заголовок — ссылка', 'List: title — link'),
        example: tr(
          'Новость 1 — https://example.com/1\nНовость 2 — https://example.com/2',
          'Story 1 — https://example.com/1\nStory 2 — https://example.com/2'
        ),
      },
      {
        key: 'titleLinks',
        label: tr('Список: заголовки-ссылки', 'List: titles as links'),
        example: '[Новость 1](https://example.com/1)',
      },
      {
        key: 'numbered',
        label: tr('Нумерованный список заголовков', 'Numbered list of titles'),
        example: tr('1. Новость 1\n2. Новость 2', '1. Story 1\n2. Story 2'),
      },
      {
        key: 'bullets',
        label: tr('Заголовки с точками •', 'Titles with bullets •'),
        example: tr('• Новость 1\n• Новость 2', '• Story 1\n• Story 2'),
      },
      {
        key: 'titles',
        label: tr('Заголовки записей', 'Item titles'),
        example: tr('Новость 1\nНовость 2', 'Story 1\nStory 2'),
      },
      {
        key: 'texts',
        label: tr('Тексты всех записей', 'Texts of all items'),
        example: tr('Текст первой…\n\nТекст второй…', 'First text…\n\nSecond text…'),
      },
      {
        key: 'links',
        label: tr('Ссылки всех записей', 'Links of all items'),
        example: 'https://example.com/1\nhttps://example.com/2',
      },
      {
        key: 'images',
        label: tr('Картинки всех записей (ссылки)', 'Pictures of all items (links)'),
        example: 'https://example.com/1.jpg\nhttps://example.com/2.jpg',
      },
      {
        key: 'firstTitle',
        label: tr('Первая запись: заголовок', 'First item: title'),
        example: tr('Новость 1', 'Story 1'),
      },
      {
        key: 'firstSummary',
        label: tr('Первая запись: кратко', 'First item: summary'),
        example: tr('О чём она в двух строках…', 'What it says in two lines…'),
      },
      {
        key: 'firstText',
        label: tr('Первая запись: текст', 'First item: text'),
        example: tr('Полный текст записи…', 'The full text…'),
      },
      {
        key: 'link',
        label: tr('Первая запись: ссылка', 'First item: link'),
        example: 'https://example.com/1',
      },
      {
        key: 'image',
        label: tr('Первая запись: картинка', 'First item: picture'),
        example: 'https://example.com/cover.jpg',
      },
      {
        key: 'firstDate',
        label: tr('Первая запись: дата', 'First item: date'),
        example: '03.11.2026 10:15',
      },
      { key: 'count', label: tr('Сколько записей', 'How many items'), example: '3' },
    ],
    simulate: (c) => ({
      output: feedSummary(L(SAMPLE_FEED)),
      summary: tr(
        `Из ${clip(c.feedUrl, 50)} получили бы до ${c.maxItems} записей (пример: 3)`,
        `Would fetch up to ${c.maxItems} items from ${clip(c.feedUrl, 50)} (example: 3)`
      ),
    }),
  },
  'logic.filter': {
    type: 'logic.condition',
    service: 'logic',
    kind: 'logic',
    name: tr('Продолжить, только если…', 'Continue only if…'),
    desc: tr(
      'Останавливает сценарий, если условие не выполнено.',
      'Stops the automation when the condition is not met.'
    ),
    keywords: 'условие фильтр если только when if filter condition only',
    fields: [
      {
        key: 'left',
        type: 'text',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Значение', 'Value'),
      },
      {
        key: 'operator',
        type: 'select',
        required: true,
        basic: true,
        label: tr('Условие', 'Condition'),
        default: 'contains',
        options: [
          { value: 'contains', label: tr('содержит', 'contains') },
          { value: 'equals', label: tr('равно', 'equals') },
          { value: 'gte', label: tr('больше или равно', 'is at least') },
          { value: 'notEmpty', label: tr('не пустое', 'is not empty') },
        ],
      },
      {
        key: 'right',
        type: 'text',
        required: false,
        basic: true,
        label: tr('С чем сравнить', 'Compare with'),
      },
    ],
    outputs: [],
    simulate: (c) => {
      const l = String(c.left ?? '');
      const r = String(c.right ?? '');
      const pass =
        c.operator === 'contains'
          ? l.toLowerCase().includes(r.toLowerCase())
          : c.operator === 'equals'
            ? l === r
            : c.operator === 'gte'
              ? Number(l) >= Number(r)
              : l.trim() !== '';
      return {
        output: { passed: pass },
        stop: !pass,
        summary: pass
          ? tr(`Условие выполнено («${clip(l, 30)}»)`, `Condition met (“${clip(l, 30)}”)`)
          : tr(
              `Условие не выполнено («${clip(l, 30)}») — дальше не идём`,
              `Condition not met (“${clip(l, 30)}”) — stopping here`
            ),
      };
    },
  },
  'logic.delay': {
    type: 'primitive.delay',
    service: 'logic',
    kind: 'logic',
    name: tr('Подождать', 'Wait'),
    desc: tr('Пауза перед следующим шагом.', 'A pause before the next step.'),
    keywords: 'подождать пауза задержка wait delay pause later',
    fields: [
      {
        key: 'amount',
        type: 'number',
        required: true,
        basic: true,
        label: tr('Сколько', 'How long'),
        default: 10,
      },
      {
        key: 'unit',
        type: 'select',
        required: true,
        basic: true,
        label: tr('Единица', 'Unit'),
        default: 'minutes',
        options: [
          { value: 'seconds', label: tr('секунд', 'seconds') },
          { value: 'minutes', label: tr('минут', 'minutes') },
          { value: 'hours', label: tr('часов', 'hours') },
        ],
      },
    ],
    outputs: [],
    simulate: (c) => ({
      output: { waited: `${c.amount} ${c.unit}` },
      summary: tr(
        `Пауза ${c.amount} (в симуляции — мгновенно)`,
        `Wait ${c.amount} (instant in simulation)`
      ),
    }),
  },
  'text.format': {
    type: 'text.format',
    service: 'logic',
    kind: 'logic',
    forEach: true,
    name: tr('Текст: обработать', 'Text: process'),
    desc: tr(
      'Убрать HTML, обрезать до лимита, заменить, вытащить ссылки, сменить регистр.',
      'Strip HTML, cut to a limit, replace, pull out links, change case.'
    ),
    keywords:
      'текст обработать обрезать сократить лимит html убрать заменить ссылки регистр formatter format text truncate strip replace links case',
    fields: [
      {
        key: 'input',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Текст', 'Text'),
      },
      {
        key: 'operation',
        type: 'select',
        required: true,
        basic: true,
        label: tr('Что сделать', 'Operation'),
        default: 'stripHtml',
        options: [
          { value: 'stripHtml', label: tr('Убрать HTML-разметку', 'Strip HTML') },
          { value: 'truncate', label: tr('Обрезать до N символов', 'Cut to N characters') },
          { value: 'replace', label: tr('Заменить текст', 'Replace text') },
          { value: 'extractLinks', label: tr('Вытащить ссылки', 'Pull out links') },
          {
            value: 'extractRegex',
            label: tr('Найти по шаблону (regex)', 'Find by pattern (regex)'),
          },
          { value: 'upper', label: tr('ЗАГЛАВНЫМИ', 'UPPERCASE') },
          { value: 'lower', label: tr('строчными', 'lowercase') },
          {
            value: 'trim',
            label: tr('Убрать пустые строки и пробелы', 'Remove blank lines and spaces'),
          },
          { value: 'firstLine', label: tr('Только первая строка', 'First line only') },
        ],
      },
      {
        key: 'maxLength',
        type: 'number',
        required: false,
        basic: true,
        label: tr('N символов (для «Обрезать»)', 'N characters (for “Cut”)'),
        default: 1000,
        help: tr(
          'Telegram: сообщение до 4096, подпись к фото до 1024.',
          'Telegram: message up to 4096, photo caption up to 1024.'
        ),
      },
      {
        key: 'find',
        type: 'text',
        required: false,
        basic: false,
        label: tr('Что заменить', 'Find'),
      },
      {
        key: 'replaceWith',
        type: 'text',
        required: false,
        basic: false,
        label: tr('На что заменить', 'Replace with'),
      },
      {
        key: 'pattern',
        type: 'text',
        required: false,
        basic: false,
        label: tr('Шаблон (regex)', 'Pattern (regex)'),
        placeholder: '(\\d+) ₽',
      },
    ],
    outputs: [
      {
        key: 'result',
        label: tr('Готовый текст', 'Result'),
        example: tr('Текст без разметки', 'Text without markup'),
      },
      { key: 'length', label: tr('Длина', 'Length'), example: '120' },
    ],
    simulate: (c) => ({
      output: {
        result: L(tr('Обработанный текст (пример)', 'Processed text (example)')),
        length: 30,
      },
      summary: tr('Текст обработан (симуляция).', 'Text processed (simulation).'),
    }),
  },
  'text.compose': {
    type: 'text.compose',
    service: 'logic',
    kind: 'logic',
    forEach: true,
    name: tr('Собрать текст или отчёт', 'Compose a text or report'),
    desc: tr(
      'Объединяет данные прошлых шагов в один текст.',
      'Combines data from earlier steps into one text.'
    ),
    keywords: 'текст отчёт шаблон собрать объединить report compose template text format',
    fields: [
      {
        key: 'template',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Текст', 'Text'),
      },
    ],
    outputs: [
      {
        key: 'text',
        label: tr('Готовый текст', 'Composed text'),
        example: tr('Отчёт за день…', 'Daily report…'),
      },
    ],
    simulate: (c) => ({
      output: { text: c.template },
      summary: tr(`Текст собран: «${clip(c.template)}»`, `Text composed: “${clip(c.template)}”`),
    }),
  },

  // ── For developers ──────────────────────────────────────────────────────
  'http.request': {
    type: 'core.httpRequest',
    service: 'http',
    kind: 'action',
    forEach: true,
    external: true,
    name: tr('HTTP-запрос к API', 'HTTP API request'),
    desc: tr('Вызвать любой API. Защита от SSRF включена.', 'Call any API. SSRF protection is on.'),
    keywords: 'http api запрос rest get post request call endpoint разработчик developer',
    fields: [
      {
        key: 'url',
        type: 'text',
        required: true,
        basic: true,
        acceptsData: true,
        label: 'URL',
        placeholder: 'https://api.example.com/v1/status',
      },
      {
        key: 'method',
        type: 'select',
        required: true,
        basic: true,
        label: tr('Метод', 'Method'),
        default: 'GET',
        options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((v) => ({ value: v, label: v })),
      },
      {
        key: 'headers',
        type: 'json',
        required: false,
        basic: false,
        label: tr('Заголовки (JSON)', 'Headers (JSON)'),
        placeholder: '{"Accept": "application/json"}',
      },
      {
        key: 'body',
        type: 'json',
        required: false,
        basic: false,
        label: tr('Тело запроса (JSON)', 'Request body (JSON)'),
      },
      {
        key: 'timeoutMs',
        type: 'number',
        required: false,
        basic: false,
        label: tr('Тайм-аут, мс', 'Timeout, ms'),
        default: 10000,
      },
    ],
    outputs: [
      { key: 'status', label: tr('Код ответа', 'Status code'), example: '200' },
      { key: 'body', label: tr('Ответ', 'Response body'), example: '{"ok":true}' },
    ],
    simulate: (c) => ({
      output: { simulated: true, status: 200, body: { ok: true, sample: true } },
      summary: tr(
        `Был бы выполнен ${c.method} ${clip(c.url, 50)} (пример ответа: 200). Запрос не отправлен.`,
        `Would call ${c.method} ${clip(c.url, 50)} (sample response: 200). No request was sent.`
      ),
    }),
  },
  'webhook.send': {
    type: 'core.outgoingWebhook',
    service: 'webhook',
    kind: 'action',
    forEach: true,
    external: true,
    dev: true,
    name: tr('Отправить данные на вебхук', 'Send data to a webhook'),
    desc: tr('POST с данными на внешний адрес.', 'POST data to an external URL.'),
    keywords: 'вебхук отправить webhook post notify outgoing',
    fields: [
      {
        key: 'url',
        type: 'text',
        required: true,
        basic: true,
        label: 'URL',
        placeholder: 'https://hooks.example.com/notify',
      },
      {
        key: 'payload',
        type: 'json',
        required: false,
        basic: true,
        label: tr('Данные (JSON)', 'Payload (JSON)'),
        placeholder: '{"event": "lead"}',
      },
    ],
    outputs: [{ key: 'status', label: tr('Код ответа', 'Status code'), example: '204' }],
    simulate: (c) => ({
      output: { simulated: true, status: 204 },
      summary: tr(
        `Данные были бы отправлены на ${clip(c.url, 50)}. Ничего не отправлено.`,
        `Would POST to ${clip(c.url, 50)}. Nothing was sent.`
      ),
    }),
  },
  'postgres.query': {
    type: 'core.postgresSql',
    service: 'postgres',
    kind: 'action',
    external: true,
    name: tr('Выполнить SQL-запрос', 'Run an SQL query'),
    desc: tr('Запись или чтение из PostgreSQL.', 'Write to or read from PostgreSQL.'),
    keywords: 'postgres postgresql sql база данных запрос database query insert select',
    fields: [
      {
        key: 'query',
        type: 'textarea',
        required: true,
        basic: true,
        label: tr('SQL-запрос', 'SQL query'),
        placeholder: 'INSERT INTO leads (email) VALUES ($1)',
      },
      {
        key: 'params',
        type: 'json',
        required: false,
        basic: true,
        label: tr('Параметры ($1, $2…) в JSON', 'Parameters ($1, $2…) as JSON'),
        placeholder: '["{{ $trigger.email }}"]',
      },
    ],
    outputs: [{ key: 'rowCount', label: tr('Затронуто строк', 'Rows affected'), example: '1' }],
    simulate: () => ({
      output: { simulated: true, rowCount: 1 },
      summary: tr(
        'Запрос был бы выполнен (пример: 1 строка). База не изменена.',
        'Query would run (example: 1 row). Database untouched.'
      ),
    }),
  },

  // ── Planned integrations ────────────────────────────────────────────────
  'sheets.addRow': {
    service: 'google_sheets',
    kind: 'action',
    planned: true,
    name: tr('Добавить строку в Google Таблицу', 'Add a row to Google Sheets'),
    desc: tr('Записать данные в новую строку.', 'Write data into a new row.'),
    keywords: 'таблица google sheets строка excel spreadsheet row add',
  },
  'drive.upload': {
    service: 'google_drive',
    kind: 'action',
    planned: true,
    name: tr('Сохранить файл в Google Диск', 'Save a file to Google Drive'),
    desc: tr('Загрузить файл в папку.', 'Upload a file into a folder.'),
    keywords: 'google drive диск файл загрузить upload file',
  },
  'calendar.createEvent': {
    service: 'google_calendar',
    kind: 'action',
    planned: true,
    name: tr('Создать событие в календаре', 'Create a calendar event'),
    desc: tr('Встреча или напоминание.', 'A meeting or reminder.'),
    keywords: 'календарь событие встреча calendar event meeting',
  },
  'notion.createPage': {
    service: 'notion',
    kind: 'action',
    planned: true,
    name: tr('Создать страницу в Notion', 'Create a Notion page'),
    desc: tr('Запись в базу Notion.', 'An entry in a Notion database.'),
    keywords: 'notion страница заметка page note database',
  },
  'slack.sendMessage': {
    type: 'slack.sendMessage',
    service: 'slack',
    kind: 'action',
    forEach: true,
    external: true,
    name: tr('Отправить сообщение в Slack', 'Send a Slack message'),
    desc: tr('Сообщение в канал через вебхук.', 'A message to a channel via a webhook.'),
    keywords: 'slack сообщение канал message channel notify',
    fields: [
      {
        key: 'text',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Текст сообщения', 'Message text'),
      },
      {
        key: 'imageUrl',
        type: 'text',
        required: false,
        basic: false,
        acceptsData: true,
        label: tr('Картинка (ссылка)', 'Picture (link)'),
      },
    ],
    outputs: [{ key: 'status', label: tr('Код ответа', 'Response code'), example: '200' }],
    simulate: (c) => ({
      output: { simulated: true, text: c.text },
      summary: tr(
        `В Slack ушло бы: «${clip(c.text)}». В демо ничего не отправлено.`,
        `Would post to Slack: “${clip(c.text)}”. Nothing was sent in the demo.`
      ),
    }),
  },
  'discord.sendMessage': {
    type: 'discord.sendMessage',
    service: 'discord',
    kind: 'action',
    forEach: true,
    external: true,
    name: tr('Отправить сообщение в Discord', 'Send a Discord message'),
    desc: tr(
      'Сообщение в канал сервера через вебхук.',
      'A message to a server channel via a webhook.'
    ),
    keywords: 'discord сообщение канал message channel notify',
    fields: [
      {
        key: 'text',
        type: 'textarea',
        required: true,
        basic: true,
        acceptsData: true,
        label: tr('Текст сообщения (до 2000 символов)', 'Message text (up to 2000 characters)'),
      },
      {
        key: 'imageUrl',
        type: 'text',
        required: false,
        basic: false,
        acceptsData: true,
        label: tr('Картинка (ссылка)', 'Picture (link)'),
      },
      {
        key: 'username',
        type: 'text',
        required: false,
        basic: false,
        label: tr('Имя отправителя', 'Sender name'),
      },
    ],
    outputs: [{ key: 'messageId', label: tr('ID сообщения', 'Message ID'), example: '1234567890' }],
    simulate: (c) => ({
      output: { simulated: true, text: c.text },
      summary: tr(
        `В Discord ушло бы: «${clip(c.text)}». В демо ничего не отправлено.`,
        `Would post to Discord: “${clip(c.text)}”. Nothing was sent in the demo.`
      ),
    }),
  },
};

/** Groups shown in the step picker. Developer-level actions live in their own section. */
export const PICKER_GROUPS = [
  { id: 'trigger', label: 'kind.trigger', match: (a) => a.kind === 'trigger' },
  { id: 'action', label: 'kind.action', match: (a) => a.kind === 'action' && !isDevAction(a) },
  { id: 'logic', label: 'kind.logic', match: (a) => a.kind === 'logic' },
  { id: 'dev', label: 'cat.dev', match: (a) => a.kind === 'action' && isDevAction(a) },
];

export function isDevAction(a) {
  return Boolean(a.dev || SERVICES[a.service]?.dev);
}

/** RU/EN synonym groups for natural-language search ("отправить сообщение", "receive email"). */
export const SYNONYMS = [
  [
    'сообщение',
    'сообщения',
    'message',
    'написать',
    'notify',
    'уведомление',
    'уведомить',
    'notification',
    'оповещение',
  ],
  ['письмо', 'письма', 'email', 'e-mail', 'mail', 'почта', 'почту', 'smtp', 'imap'],
  ['таблица', 'таблицу', 'таблицы', 'sheet', 'sheets', 'spreadsheet', 'excel', 'гугл'],
  ['ai', 'ии', 'gpt', 'chatgpt', 'нейросеть', 'llm', 'openai', 'модель', 'model'],
  ['расписание', 'schedule', 'cron', 'каждый', 'ежедневно', 'daily', 'таймер', 'timer', 'every'],
  [
    'получить',
    'получено',
    'новое',
    'новый',
    'входящее',
    'receive',
    'incoming',
    'пришло',
    'приходит',
  ],
  ['отправить', 'отправлять', 'send', 'post', 'послать', 'переслать'],
  ['telegram', 'телеграм', 'телеграмм', 'tg', 'тг'],
  ['форма', 'формы', 'заявка', 'form', 'lead', 'webhook', 'вебхук'],
  ['отчёт', 'отчет', 'report', 'сводка', 'summary', 'саммари', 'дайджест', 'digest'],
  ['новости', 'rss', 'лента', 'feed', 'news', 'блог', 'blog'],
];

/**
 * Templates. `{ ru, en }` config values are resolved to the current language on creation.
 * Node configs use the same `{{ $trigger.x }}` / `{{ $nodes.<id>.output.x }}`
 * expression language as the engine; the editor shows them as readable data chips.
 */
export const TEMPLATES = [
  {
    id: 'first_ai',
    category: 'ai',
    safe: true,
    recommended: true,
    name: tr('Попробовать AI-ответ', 'Try an AI answer'),
    desc: tr(
      'Тестовый текст → AI → результат на экране. Ничего не отправляет наружу — идеально для первого раза.',
      'Test text → AI → result on screen. Sends nothing outside — perfect for a first try.'
    ),
    sampleInput: tr(
      '«Подскажи три идеи для выходных в городе.»',
      '“Suggest three ideas for a weekend in the city.”'
    ),
    outputPreview: tr(
      'Ответ модели появится в результате проверки.',
      'The model answer appears in the test result.'
    ),
    limitations: tr(
      'Нужен AI-ключ в вашей установке; в демо — тестовое подключение.',
      'Needs an AI key in your install; a test connection in the demo.'
    ),
    setup: tr(
      ['Подключите AI-сервис.', 'Измените тестовый текст при желании.', 'Нажмите «Проверить».'],
      ['Connect the AI service.', 'Change the test text if you like.', 'Press “Test”.']
    ),
    nodes: [
      { id: 'trigger', action: 'manual.run', config: {} },
      {
        id: 'ai_1',
        action: 'ai.reply',
        config: {
          prompt: tr(
            'Ответь кратко и по делу: {{ $trigger.text }}',
            'Answer briefly and to the point: {{ $trigger.text }}'
          ),
        },
      },
    ],
    edges: [['trigger', 'ai_1']],
  },
  {
    id: 'tg_ai_reply',
    category: 'ai',
    name: tr('Telegram → AI → ответ пользователю', 'Telegram → AI → reply to user'),
    desc: tr(
      'Бот отвечает на сообщения клиентов с помощью AI.',
      'Your bot answers customer messages with AI.'
    ),
    sampleInput: tr(
      'Сообщение боту: «Когда вы работаете в выходные?»',
      'Message to the bot: “When are you open on weekends?”'
    ),
    outputPreview: tr(
      'Бот отвечает в тот же чат: «Мы работаем в субботу с 10 до 18».',
      'The bot replies in the same chat: “We are open Saturday 10–6”.'
    ),
    limitations: tr(
      'Бот видит только сообщения, отправленные ему напрямую или в группы, где он админ.',
      'The bot only sees messages sent to it directly or in groups where it is admin.'
    ),
    setup: tr(
      [
        'Подключите Telegram-бота.',
        'Подключите AI-сервис.',
        'Опишите, как отвечать.',
        'Проверьте и включите.',
      ],
      [
        'Connect the Telegram bot.',
        'Connect the AI service.',
        'Describe how to answer.',
        'Test and turn on.',
      ]
    ),
    nodes: [
      { id: 'trigger', action: 'telegram.newMessage', config: {} },
      {
        id: 'ai_1',
        action: 'ai.reply',
        config: {
          prompt: tr(
            'Ты вежливый помощник магазина. Ответь кратко на вопрос клиента: {{ $trigger.text }}',
            'You are a polite shop assistant. Briefly answer the customer: {{ $trigger.text }}'
          ),
        },
      },
      {
        id: 'tg_1',
        action: 'telegram.sendMessage',
        config: { chatId: '{{ $trigger.chatId }}', text: '{{ $nodes.ai_1.output.text }}' },
      },
    ],
    edges: [
      ['trigger', 'ai_1'],
      ['ai_1', 'tg_1'],
    ],
  },
  {
    id: 'rss_digest',
    category: 'notifications',
    name: tr('RSS → AI-саммари → письмо', 'RSS → AI summary → email'),
    desc: tr(
      'Каждое утро — краткая выжимка новостей из любимой ленты.',
      'Every morning — a short digest of your favourite feed.'
    ),
    sampleInput: tr('3 новые записи в ленте блога.', '3 new items in a blog feed.'),
    outputPreview: tr(
      'Письмо «Дайджест за день» с кратким пересказом.',
      'An email “Daily digest” with a short summary.'
    ),
    limitations: tr('Лента должна быть в формате RSS или Atom.', 'The feed must be RSS or Atom.'),
    setup: tr(
      ['Укажите адрес ленты.', 'Подключите AI и почту.', 'Укажите, кому отправлять.'],
      ['Set the feed URL.', 'Connect AI and email.', 'Choose the recipient.']
    ),
    nodes: [
      { id: 'trigger', action: 'schedule.every', config: { every: 'daily', time: '08:30' } },
      { id: 'rss_1', action: 'rss.read', config: { feedUrl: 'https://hnrss.org/frontpage' } },
      {
        id: 'ai_1',
        action: 'ai.reply',
        config: {
          prompt: tr(
            'Сделай краткий дайджест на русском по заголовкам: {{ $nodes.rss_1.output.titles }}',
            'Write a short digest of these headlines: {{ $nodes.rss_1.output.titles }}'
          ),
        },
      },
      {
        id: 'mail_1',
        action: 'email.send',
        config: {
          subject: tr('Дайджест за день', 'Daily digest'),
          body: '{{ $nodes.ai_1.output.text }}',
        },
      },
    ],
    edges: [
      ['trigger', 'rss_1'],
      ['rss_1', 'ai_1'],
      ['ai_1', 'mail_1'],
    ],
  },
  {
    id: 'rss_ai_channel',
    category: 'notifications',
    recommended: false,
    name: tr('RSS → AI → пост в Telegram-канал', 'RSS → AI → post to a Telegram channel'),
    desc: tr(
      'Новые записи ленты превращаются в короткий пост для вашего канала — каждая один раз.',
      'New feed items become a short post in your channel — each one only once.'
    ),
    sampleInput: tr('2 новые записи в ленте.', '2 new items in the feed.'),
    outputPreview: tr(
      'Отдельный пост на каждую запись: картинка, жирный заголовок, пересказ и ссылка.',
      'A post per item: picture, bold title, summary and link.'
    ),
    limitations: tr(
      'Бот должен быть администратором канала с правом публикации. Если новых записей нет, пост не выходит.',
      'The bot must be a channel admin allowed to post. With no new items no post goes out.'
    ),
    setup: tr(
      [
        'Укажите адрес ленты.',
        'Подключите AI и Telegram-бота.',
        'Добавьте бота администратором канала и укажите @канал.',
      ],
      [
        'Set the feed URL.',
        'Connect AI and a Telegram bot.',
        'Make the bot a channel admin and enter @channel.',
      ]
    ),
    nodes: [
      { id: 'trigger', action: 'schedule.every', config: { every: 'daily', time: '10:00' } },
      {
        id: 'rss_1',
        action: 'rss.read',
        config: { feedUrl: 'https://hnrss.org/frontpage', maxItems: 3, onlyNew: true },
      },
      {
        id: 'ai_1',
        action: 'ai.process',
        config: {
          forEach: '{{ $nodes.rss_1.output.items }}',
          input: '{{ $item.title }}\n{{ $item.text }}\n{{ $item.link }}',
          instruction: tr(
            'Первой строкой — заголовок статьи по-русски. Ниже — пересказ по-русски в 2–3 предложениях, по её тексту. Без хэштегов и вступлений.',
            'The article’s title on the first line. Below — a 2–3 sentence summary from its text. No hashtags, no intro.'
          ),
          readLinks: true,
          maxLinks: 1,
        },
      },
      {
        id: 'tg_1',
        action: 'telegram.sendMessage',
        config: {
          chatId: '@my_channel',
          forEach: '{{ $nodes.ai_1.output.items }}',
          text: '**{{ $item.resultTitle }}**\n\n{{ $item.resultBody }}\n\n[Читать полностью →]({{ $item.link }})',
          imageUrl: '{{ $item.image }}',
          parseMode: 'auto',
        },
      },
    ],
    edges: [
      ['trigger', 'rss_1'],
      ['rss_1', 'ai_1'],
      ['ai_1', 'tg_1'],
    ],
  },
  {
    id: 'form_filter_notify',
    category: 'notifications',
    name: tr(
      'Заявка с формы → фильтр → письмо и Telegram',
      'Form lead → filter → email and Telegram'
    ),
    desc: tr(
      'Крупные заявки сразу уходят менеджеру на почту и в рабочий чат.',
      'Big leads go straight to a manager by email and to the team chat.'
    ),
    sampleInput: tr(
      'Заявка: Иван, ivan@example.com, бюджет 1500.',
      'Lead: Ivan, ivan@example.com, budget 1500.'
    ),
    outputPreview: tr(
      'Письмо менеджеру и сообщение в чат «Новая заявка: Иван».',
      'An email to the manager and a chat message “New lead: Ivan”.'
    ),
    limitations: tr(
      'Форма должна уметь отправлять данные на вебхук.',
      'Your form must be able to post to a webhook.'
    ),
    setup: tr(
      [
        'Укажите адрес приёма и вставьте его в настройки формы.',
        'Задайте минимальный бюджет.',
        'Подключите почту и Telegram.',
      ],
      [
        'Set the receiving path and paste it into your form settings.',
        'Set the minimum budget.',
        'Connect email and Telegram.',
      ]
    ),
    nodes: [
      { id: 'trigger', action: 'webhook.receive', config: {} },
      {
        id: 'filter_1',
        action: 'logic.filter',
        config: { left: '{{ $trigger.budget }}', operator: 'gte', right: '1000' },
      },
      {
        id: 'mail_1',
        action: 'email.send',
        config: {
          subject: tr('Новая заявка: {{ $trigger.name }}', 'New lead: {{ $trigger.name }}'),
          body: '{{ $trigger.name }} ({{ $trigger.email }}): {{ $trigger.message }}',
        },
      },
      {
        id: 'tg_1',
        action: 'telegram.sendMessage',
        config: {
          text: tr(
            'Новая заявка: {{ $trigger.name }}, бюджет {{ $trigger.budget }}',
            'New lead: {{ $trigger.name }}, budget {{ $trigger.budget }}'
          ),
        },
      },
    ],
    edges: [
      ['trigger', 'filter_1'],
      ['filter_1', 'mail_1'],
      ['filter_1', 'tg_1'],
    ],
  },
  {
    id: 'schedule_http_report',
    category: 'reports',
    name: tr('По расписанию → HTTP API → отчёт', 'On schedule → HTTP API → report'),
    desc: tr(
      'Раз в час проверяет сервис и присылает короткий отчёт.',
      'Checks a service every hour and sends a short report.'
    ),
    sampleInput: tr('Ответ API: 200, {"ok": true}.', 'API response: 200, {"ok": true}.'),
    outputPreview: tr('Сообщение «Статус сервиса: 200».', 'A message “Service status: 200”.'),
    limitations: tr(
      'Адрес API должен быть доступен из сети вашего сервера; внутренние адреса блокируются защитой SSRF.',
      'The API must be reachable from your server; internal addresses are blocked by SSRF protection.'
    ),
    setup: tr(
      ['Укажите адрес API.', 'Настройте текст отчёта.', 'Подключите Telegram.'],
      ['Set the API URL.', 'Adjust the report text.', 'Connect Telegram.']
    ),
    nodes: [
      { id: 'trigger', action: 'schedule.every', config: { every: 'hourly' } },
      {
        id: 'http_1',
        action: 'http.request',
        config: { url: 'https://api.example.com/health', method: 'GET' },
      },
      {
        id: 'text_1',
        action: 'text.compose',
        config: {
          template: tr(
            'Статус сервиса: {{ $nodes.http_1.output.status }}',
            'Service status: {{ $nodes.http_1.output.status }}'
          ),
        },
      },
      {
        id: 'tg_1',
        action: 'telegram.sendMessage',
        config: { text: '{{ $nodes.text_1.output.text }}' },
      },
    ],
    edges: [
      ['trigger', 'http_1'],
      ['http_1', 'text_1'],
      ['text_1', 'tg_1'],
    ],
  },
  {
    id: 'server_health_ollama',
    category: 'notifications',
    name: tr('Мониторинг сервера → локальный AI → тревога', 'Server check → local AI → alert'),
    desc: tr(
      'Проверяет сервер, локальная модель объясняет проблему, дежурный получает сообщение.',
      'Checks a server, a local model explains the problem, the on-call engineer gets a message.'
    ),
    sampleInput: tr('Ответ /health: 503.', '/health response: 503.'),
    outputPreview: tr(
      'Сообщение дежурному с кратким диагнозом.',
      'A message to on-call with a short diagnosis.'
    ),
    limitations: tr(
      'Нужен запущенный Ollama рядом с OpenNodes.',
      'Needs Ollama running next to OpenNodes.'
    ),
    setup: tr(
      ['Укажите адрес проверки.', 'Проверьте адрес Ollama.', 'Подключите Telegram.'],
      ['Set the health URL.', 'Check the Ollama URL.', 'Connect Telegram.']
    ),
    nodes: [
      { id: 'trigger', action: 'schedule.every', config: { every: 'every15m' } },
      {
        id: 'http_1',
        action: 'http.request',
        config: { url: 'https://api.example.com/health/ready', method: 'GET' },
      },
      {
        id: 'ollama_1',
        action: 'ollama.reply',
        config: {
          prompt: tr(
            'Кратко объясни причину сбоя по ответу: {{ $nodes.http_1.output.body }}',
            'Briefly explain the failure from this response: {{ $nodes.http_1.output.body }}'
          ),
        },
      },
      {
        id: 'tg_1',
        action: 'telegram.sendMessage',
        config: {
          text: tr(
            'Проблема с сервером: {{ $nodes.ollama_1.output.text }}',
            'Server problem: {{ $nodes.ollama_1.output.text }}'
          ),
        },
      },
    ],
    edges: [
      ['trigger', 'http_1'],
      ['http_1', 'ollama_1'],
      ['ollama_1', 'tg_1'],
    ],
  },
  {
    id: 'tg_classify_sheet',
    category: 'sheets',
    planned: ['google_sheets'],
    name: tr('Telegram → AI-классификация → таблица', 'Telegram → AI classification → spreadsheet'),
    desc: tr(
      'Каждое сообщение получает категорию и записывается в Google Таблицу.',
      'Every message gets a category and is written to Google Sheets.'
    ),
    sampleInput: tr('Сообщение: «Не пришёл заказ №123».', 'Message: “Order #123 never arrived”.'),
    outputPreview: tr(
      'Строка в таблице: дата, автор, текст, категория «Жалоба».',
      'A row: date, author, text, category “Complaint”.'
    ),
    limitations: tr(
      'Станет доступен после появления интеграции Google Sheets.',
      'Available once the Google Sheets integration ships.'
    ),
    setup: tr([], []),
    nodes: [
      { id: 'trigger', action: 'telegram.newMessage', config: {} },
      { id: 'ai_1', action: 'ai.classify', config: { text: '{{ $trigger.text }}' } },
      { id: 'sheet_1', action: 'sheets.addRow', config: {} },
    ],
    edges: [
      ['trigger', 'ai_1'],
      ['ai_1', 'sheet_1'],
    ],
  },
  {
    id: 'payment_ledger',
    category: 'custom',
    name: tr('Платёж → запись в базу → чек на почту', 'Payment → database record → receipt email'),
    desc: tr(
      'Для разработчиков: вебхук платёжной системы, запись в PostgreSQL и письмо клиенту.',
      'For developers: a payment webhook, a PostgreSQL record and a customer email.'
    ),
    sampleInput: tr('Вебхук: сумма 1500, email клиента.', 'Webhook: amount 1500, customer email.'),
    outputPreview: tr(
      'Строка в таблице payments и письмо «Оплата получена».',
      'A row in payments and an email “Payment received”.'
    ),
    limitations: tr(
      'Нужен доступ к PostgreSQL и проверка подписи вебхука.',
      'Needs PostgreSQL access and webhook signature verification.'
    ),
    setup: tr(
      ['Подключите PostgreSQL и почту.', 'Проверьте SQL-запрос.', 'Включите проверку подписи.'],
      ['Connect PostgreSQL and email.', 'Review the SQL query.', 'Turn on signature verification.']
    ),
    nodes: [
      {
        id: 'trigger',
        action: 'webhook.receive',
        config: { path: '/hooks/payments', verifySignature: true },
      },
      {
        id: 'filter_1',
        action: 'logic.filter',
        config: { left: '{{ $trigger.budget }}', operator: 'gte', right: '100' },
      },
      {
        id: 'sql_1',
        action: 'postgres.query',
        config: {
          query: 'INSERT INTO payments (email, amount) VALUES ($1, $2)',
          params: ['{{ $trigger.email }}', '{{ $trigger.budget }}'],
        },
      },
      {
        id: 'mail_1',
        action: 'email.send',
        config: {
          to: '{{ $trigger.email }}',
          subject: tr('Оплата получена', 'Payment received'),
          body: tr(
            'Спасибо! Мы получили оплату {{ $trigger.budget }}.',
            'Thank you! We received your payment of {{ $trigger.budget }}.'
          ),
        },
      },
    ],
    edges: [
      ['trigger', 'filter_1'],
      ['filter_1', 'sql_1'],
      ['sql_1', 'mail_1'],
    ],
  },
];

export const TEMPLATE_CATEGORIES = ['notifications', 'sheets', 'ai', 'reports', 'custom'];
