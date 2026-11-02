/**
 * OpenNodes demo — central RU/EN dictionary.
 * UI chrome uses message keys below; catalog content (services, actions, templates)
 * carries `{ ru, en }` pairs next to its definition and is resolved with `L()`.
 * Business IDs (node types, template IDs) are never translated.
 */

const DICT = {
  ru: {
    'app.title': 'OpenNodes — конструктор автоматизаций',
    'demo.badge': 'Демо · симуляция',
    'demo.banner':
      'Публичное демо: «Проверить» выполняет симуляцию в вашем браузере. Сообщения, письма и запросы никуда не отправляются, результаты — примерные.',
    'demo.bannerShort': 'Демо: всё выполняется в симуляции, ничего не отправляется.',
    'demo.noRealRun':
      'Реальный запуск доступен только в вашей установке OpenNodes (Docker), подключённой к серверу.',

    'nav.automations': 'Мои автоматизации',
    'nav.templates': 'Шаблоны',
    'nav.connections': 'Подключения',
    'nav.history': 'История',
    'nav.main': 'Основная навигация',

    'menu.open': 'Меню профиля',
    'menu.restartTour': 'Повторить обучение',
    'menu.resumeTour': 'Продолжить обучение',
    'menu.devMode': 'Режим разработчика',
    'menu.theme': 'Тема',
    'menu.theme.light': 'Светлая',
    'menu.theme.dark': 'Тёмная',
    'menu.theme.system': 'Как в системе',
    'menu.reset': 'Сбросить демо-данные',
    'menu.resetConfirm': 'Удалить все автоматизации, подключения и историю этого демо?',
    'menu.about': 'О демо',
    'menu.aboutText':
      'Это статическая демонстрация интерфейса на GitHub Pages. Сервер, очереди и реальные коннекторы в ней не участвуют. Данные хранятся только в этом браузере.',
    'lang.label': 'Язык',

    'home.title': 'Что хотите автоматизировать?',
    'home.subtitle': 'Выберите готовую задачу — настройка займёт пару минут, без кода и JSON.',
    'home.searchPlaceholder': 'Например: отправлять письмо, когда приходит сообщение',
    'home.popular': 'Популярные задачи',
    'home.allTemplates': 'Все шаблоны',
    'home.fromScratch': 'Создать свой сценарий',
    'home.mine': 'Мои автоматизации',
    'home.empty':
      'Пока нет автоматизаций. Начните с шаблона выше — это самый быстрый путь к первому результату.',
    'home.noResults': 'Ничего не нашлось. Попробуйте другие слова или создайте свой сценарий.',

    'cat.all': 'Все',
    'cat.notifications': 'Уведомления',
    'cat.sheets': 'Таблицы',
    'cat.ai': 'AI-помощник',
    'cat.reports': 'Отчёты',
    'cat.custom': 'Свой сценарий',
    'cat.dev': 'Для разработчиков',

    'status.draft': 'Черновик',
    'status.active': 'Включена',
    'status.paused': 'Выключена',
    'status.unpublished': 'есть неопубликованные изменения',

    'step.needsSetup': 'Нужна настройка',
    'step.ready': 'Готово',
    'step.error': 'Ошибка',
    'step.disabled': 'Отключён',
    'step.n': 'Шаг {n}',

    'list.lastRun': 'Последняя проверка (симуляция): {when}',
    'list.never': 'ещё не проверялась',
    'list.open': 'Открыть',
    'list.delete': 'Удалить',
    'list.deleteConfirm': 'Удалить автоматизацию «{name}»?',
    'list.enable': 'Включить',
    'list.disable': 'Выключить',
    'list.steps': '{n} шаг(а/ов)',

    'tpl.title': 'Шаблоны',
    'tpl.subtitle':
      'Готовые решения с понятной настройкой. Каждый шаблон показывает, что понадобится и что получится.',
    'tpl.searchPlaceholder': 'Поиск: «telegram», «письмо», «ai», «расписание»…',
    'tpl.use': 'Использовать шаблон',
    'tpl.details': 'Подробнее',
    'tpl.planned': 'Планируется',
    'tpl.plannedHint': 'Нужна интеграция, которой пока нет в OpenNodes: {services}.',
    'tpl.needs': 'Понадобится',
    'tpl.nothingNeeded': 'Подключения не нужны',
    'tpl.sampleInput': 'Пример входящих данных',
    'tpl.outputPreview': 'Что получится',
    'tpl.limitations': 'Ограничения',
    'tpl.setup': 'Как настроить',
    'tpl.safe': 'Безопасно: без внешних действий',
    'tpl.recommended': 'Рекомендуем для начала',

    'conn.title': 'Подключения',
    'conn.subtitle':
      'Сервисы, с которыми работают ваши автоматизации. Подключите один раз — используйте во всех сценариях.',
    'conn.connected': 'Подключено (тестовое)',
    'conn.notConnected': 'Не подключено',
    'conn.noAuth': 'Подключение не требуется',
    'conn.planned': 'Планируется',
    'conn.connect': 'Подключить',
    'conn.check': 'Проверить',
    'conn.disconnect': 'Отключить',
    'conn.disconnectConfirm':
      'Отключить «{name}»? Шаги, которые его используют, потребуют настройки.',
    'conn.checkOk': 'Тестовое подключение отвечает (симуляция).',
    'conn.modalTitle': 'Подключить {service}',
    'conn.whatNeeded': 'Что понадобится в вашей установке',
    'conn.demoNotice':
      'В публичном демо реальные токены и пароли не запрашиваются и не сохраняются. Используйте тестовое подключение, чтобы пройти сценарий целиком.',
    'conn.useTest': 'Использовать тестовое подключение',
    'conn.securityDev':
      'В реальной установке секреты шифруются (AES-256-GCM, envelope encryption), API никогда не возвращает их в открытом виде.',
    'conn.testName': '{service} (тестовое)',

    'hist.title': 'История',
    'hist.subtitle':
      'Все проверки ваших автоматизаций. В демо это симуляции — реальных отправок не было.',
    'hist.empty': 'История пуста. Откройте автоматизацию и нажмите «Проверить».',
    'hist.ok': 'Успешно',
    'hist.okStopped': 'Остановлено условием',
    'hist.failed': 'Ошибка на шаге {n}',
    'hist.retry': 'Повторить',
    'hist.fix': 'Исправить',
    'hist.openAutomation': 'Открыть сценарий',
    'hist.tech': 'Технические детали',
    'hist.input': 'Входные данные (секреты скрыты)',
    'hist.output': 'Результат (пример)',
    'hist.deleted': 'сценарий удалён',

    'ed.back': 'Мои автоматизации',
    'ed.namePlaceholder': 'Название автоматизации',
    'ed.nameLabel': 'Название',
    'ed.check': 'Проверить',
    'ed.checkHint': 'Симуляция в браузере — ничего не отправляется',
    'ed.enable': 'Включить',
    'ed.disable': 'Выключить',
    'ed.publish': 'Опубликовать изменения',
    'ed.version': 'Версия',
    'ed.versionMenu': 'Версии и дополнительно',
    'ed.versionInfo': 'Опубликована версия {v}',
    'ed.versionNone': 'Ещё не публиковалась',
    'ed.revert': 'Отменить изменения (вернуть версию {v})',
    'ed.checksum': 'Контрольная сумма графа',
    'ed.dagOk': 'Граф корректен: один триггер, нет циклов',
    'ed.empty': 'С чего начинается сценарий?',
    'ed.emptyHint': 'Выберите событие, которое запускает автоматизацию.',
    'ed.addStep': 'Добавить шаг',
    'ed.addNext': 'Добавить следующий шаг',
    'ed.notFound': 'Автоматизация не найдена.',
    'ed.fixFirst': 'Сначала исправьте:',
    'ed.activateTitle': 'Включить «{name}»?',
    'ed.activateExternal': 'После включения сценарий будет выполнять внешние действия:',
    'ed.activateNoExternal': 'Сценарий не выполняет внешних действий.',
    'ed.activateDemo': 'Это демо: включение только меняет статус. Реальные запуски не происходят.',
    'ed.activateConfirm': 'Да, включить',
    'ed.cancel': 'Отмена',
    'ed.activated': 'Сценарий включён (демо).',
    'ed.paused': 'Сценарий выключен.',
    'ed.published': 'Изменения опубликованы (версия {v}).',
    'ed.reverted': 'Черновик возвращён к версии {v}.',
    'ed.unsavedClose': 'Есть несохранённые изменения в шаге. Закрыть без сохранения?',

    'run.title': 'Результат проверки',
    'run.simulated': 'Симуляция',
    'run.close': 'Свернуть',
    'run.ok': 'Всё работает: шаги прошли без ошибок (симуляция).',
    'run.stopped':
      'Сценарий остановлен условием на шаге {n} — это нормально, дальше данные не пошли.',
    'run.failed': 'Проверка остановилась на шаге {n}.',
    'run.skipped': 'Пропущен — шаг отключён',
    'run.notReached': 'Не выполнялся',
    'run.showError': 'Посмотреть ошибку',

    'err.noConnection': 'В этом шаге не выбран аккаунт {service}.',
    'err.connectionMissing': 'Выбранное подключение {service} удалено. Выберите другое.',
    'err.field': 'Не заполнено: {label}.',
    'err.badToken': 'Не удалось распознать подстановку {token}. Выберите данные заново.',
    'err.noTrigger': 'Добавьте первый шаг — событие, которое запускает сценарий.',
    'err.multiTrigger': 'В сценарии может быть только одно стартовое событие.',
    'err.cycle': 'Так соединить нельзя: шаги образуют замкнутый круг ({path}).',
    'err.planned': 'Это действие пока недоступно — интеграция в разработке.',

    'panel.close': 'Закрыть',
    'panel.account': 'Аккаунт',
    'panel.connectNew': 'Подключить {service}',
    'panel.chooseAccount': '— выберите аккаунт —',
    'panel.basic': 'Основные',
    'panel.advanced': 'Дополнительно',
    'panel.dev': 'Для разработчиков',
    'panel.data': 'Подставить данные из предыдущих шагов',
    'panel.dataHint': 'Нажмите, чтобы вставить в выбранное поле.',
    'panel.noData': 'Перед этим шагом нет данных — это первый шаг.',
    'panel.stepName': 'Своё название шага',
    'panel.disableStep': 'Отключить шаг (пропускать при запуске)',
    'panel.delete': 'Удалить шаг',
    'panel.deleteConfirm': 'Удалить шаг «{name}»?',
    'panel.test': 'Тестировать шаг',
    'panel.save': 'Сохранить',
    'panel.saved': 'Сохранено в черновик.',
    'panel.example': 'Пример: {text}',
    'panel.optional': 'необязательно',
    'panel.devType': 'Тип узла',
    'panel.devId': 'ID узла',
    'panel.devConfig': 'Конфигурация (как хранится)',
    'panel.devConnect': 'Добавить переход к шагу',
    'panel.devConnectBtn': 'Соединить',
    'panel.devEdges': 'Переходы',
    'panel.devRemoveEdge': 'Убрать переход',
    'panel.devNoEdges': 'Нет исходящих переходов',
    'panel.connected': 'Шаги соединены.',
    'panel.testResult': 'Результат шага (симуляция)',
    'panel.hintTitle': 'Подсказка',
    'panel.hint':
      'Здесь только главное. Редкие настройки — в разделе «Дополнительно», данные прошлых шагов вставляются кнопками ниже.',
    'panel.gotIt': 'Понятно',

    'picker.title': 'Добавить шаг',
    'picker.titleTrigger': 'С чего начинается сценарий?',
    'picker.search': 'Что нужно сделать? Например: «отправить сообщение», «получить письмо»',
    'picker.planned': 'Планируется',
    'picker.empty': 'Ничего не нашлось. Попробуйте «сообщение», «письмо», «AI», «таблица».',
    'picker.devSection': 'HTTP-запросы, вебхуки и база данных — в разделе «Для разработчиков».',

    'kind.trigger': 'Когда…',
    'kind.action': 'Сделать',
    'kind.logic': 'Логика',

    'onb.welcomeTitle': 'Добро пожаловать в OpenNodes',
    'onb.welcomeText': 'Соберём первую автоматизацию за 4 коротких шага. Что вам ближе?',
    'onb.goal.notifications': 'Уведомления',
    'onb.goal.notificationsText': 'Сообщать о новом: письма, сообщения, ленты',
    'onb.goal.sheets': 'Работа с таблицами',
    'onb.goal.sheetsText': 'Собирать данные в таблицы и отчёты',
    'onb.goal.ai': 'AI-помощник',
    'onb.goal.aiText': 'Отвечать на сообщения и обрабатывать тексты',
    'onb.goal.custom': 'Свой сценарий',
    'onb.goal.customText': 'Начать с чистого листа',
    'onb.skip': 'Пропустить обучение',
    'onb.hide': 'Скрыть',
    'onb.progress': 'Обучение · шаг {n} из 4',
    'onb.s1':
      'Выберите шаблон. Рекомендуем «Попробовать AI-ответ» — он ничего не отправляет наружу.',
    'onb.s2':
      'Подключите сервис (в демо — тестовое подключение) или заполните поля, отмеченные «Нужна настройка».',
    'onb.s3': 'Нажмите «Проверить» и посмотрите, что получилось на каждом шаге.',
    'onb.s4': 'Включите сценарий. Мы спросим подтверждение перед включением.',
    'onb.done': 'Готово! Первая автоматизация собрана. Обучение можно повторить в меню профиля.',
    'onb.goTemplates': 'К шаблонам',
    'onb.close': 'Закрыть',

    'common.close': 'Закрыть',
    'common.yes': 'Да',
    'common.saveError': 'Не удалось сохранить: проверьте выделенные поля.',
    'common.justNow': 'только что',
  },
  en: {
    'app.title': 'OpenNodes — automation builder',
    'demo.badge': 'Demo · simulation',
    'demo.banner':
      'Public demo: “Test” runs a simulation in your browser. No messages, emails or requests are sent; results are examples.',
    'demo.bannerShort': 'Demo: everything is simulated, nothing is sent.',
    'demo.noRealRun':
      'Real runs are only available in your own OpenNodes install (Docker) connected to a server.',

    'nav.automations': 'My automations',
    'nav.templates': 'Templates',
    'nav.connections': 'Connections',
    'nav.history': 'History',
    'nav.main': 'Main navigation',

    'menu.open': 'Profile menu',
    'menu.restartTour': 'Restart the tour',
    'menu.resumeTour': 'Resume the tour',
    'menu.devMode': 'Developer mode',
    'menu.theme': 'Theme',
    'menu.theme.light': 'Light',
    'menu.theme.dark': 'Dark',
    'menu.theme.system': 'System',
    'menu.reset': 'Reset demo data',
    'menu.resetConfirm': 'Delete all automations, connections and history in this demo?',
    'menu.about': 'About this demo',
    'menu.aboutText':
      'This is a static UI demo on GitHub Pages. No server, queues or real connectors are involved. Data is kept in this browser only.',
    'lang.label': 'Language',

    'home.title': 'What do you want to automate?',
    'home.subtitle': 'Pick a ready-made task — setup takes a couple of minutes, no code or JSON.',
    'home.searchPlaceholder': 'For example: send an email when a message arrives',
    'home.popular': 'Popular tasks',
    'home.allTemplates': 'All templates',
    'home.fromScratch': 'Build your own',
    'home.mine': 'My automations',
    'home.empty':
      'No automations yet. Start with a template above — it is the fastest way to a first result.',
    'home.noResults': 'Nothing found. Try other words or build your own.',

    'cat.all': 'All',
    'cat.notifications': 'Notifications',
    'cat.sheets': 'Spreadsheets',
    'cat.ai': 'AI assistant',
    'cat.reports': 'Reports',
    'cat.custom': 'Custom',
    'cat.dev': 'For developers',

    'status.draft': 'Draft',
    'status.active': 'On',
    'status.paused': 'Off',
    'status.unpublished': 'unpublished changes',

    'step.needsSetup': 'Needs setup',
    'step.ready': 'Ready',
    'step.error': 'Error',
    'step.disabled': 'Disabled',
    'step.n': 'Step {n}',

    'list.lastRun': 'Last test (simulation): {when}',
    'list.never': 'not tested yet',
    'list.open': 'Open',
    'list.delete': 'Delete',
    'list.deleteConfirm': 'Delete automation “{name}”?',
    'list.enable': 'Turn on',
    'list.disable': 'Turn off',
    'list.steps': '{n} step(s)',

    'tpl.title': 'Templates',
    'tpl.subtitle':
      'Ready-made solutions with simple setup. Each template shows what you need and what you get.',
    'tpl.searchPlaceholder': 'Search: “telegram”, “email”, “ai”, “schedule”…',
    'tpl.use': 'Use template',
    'tpl.details': 'Details',
    'tpl.planned': 'Planned',
    'tpl.plannedHint': 'Needs an integration OpenNodes does not have yet: {services}.',
    'tpl.needs': 'You will need',
    'tpl.nothingNeeded': 'No connections needed',
    'tpl.sampleInput': 'Sample input',
    'tpl.outputPreview': 'What you get',
    'tpl.limitations': 'Limitations',
    'tpl.setup': 'How to set up',
    'tpl.safe': 'Safe: no external actions',
    'tpl.recommended': 'Recommended to start',

    'conn.title': 'Connections',
    'conn.subtitle': 'Services your automations work with. Connect once, use in every scenario.',
    'conn.connected': 'Connected (test)',
    'conn.notConnected': 'Not connected',
    'conn.noAuth': 'No connection needed',
    'conn.planned': 'Planned',
    'conn.connect': 'Connect',
    'conn.check': 'Check',
    'conn.disconnect': 'Disconnect',
    'conn.disconnectConfirm': 'Disconnect “{name}”? Steps that use it will need setup.',
    'conn.checkOk': 'Test connection responds (simulation).',
    'conn.modalTitle': 'Connect {service}',
    'conn.whatNeeded': 'What you will need in your own install',
    'conn.demoNotice':
      'The public demo never asks for or stores real tokens or passwords. Use a test connection to walk through the whole scenario.',
    'conn.useTest': 'Use a test connection',
    'conn.securityDev':
      'In a real install secrets are encrypted (AES-256-GCM, envelope encryption); the API never returns them in plain text.',
    'conn.testName': '{service} (test)',

    'hist.title': 'History',
    'hist.subtitle':
      'Every test of your automations. In the demo these are simulations — nothing was actually sent.',
    'hist.empty': 'History is empty. Open an automation and press “Test”.',
    'hist.ok': 'Succeeded',
    'hist.okStopped': 'Stopped by a condition',
    'hist.failed': 'Error at step {n}',
    'hist.retry': 'Run again',
    'hist.fix': 'Fix',
    'hist.openAutomation': 'Open automation',
    'hist.tech': 'Technical details',
    'hist.input': 'Input (secrets hidden)',
    'hist.output': 'Result (example)',
    'hist.deleted': 'automation deleted',

    'ed.back': 'My automations',
    'ed.namePlaceholder': 'Automation name',
    'ed.nameLabel': 'Name',
    'ed.check': 'Test',
    'ed.checkHint': 'Simulation in your browser — nothing is sent',
    'ed.enable': 'Turn on',
    'ed.disable': 'Turn off',
    'ed.publish': 'Publish changes',
    'ed.version': 'Version',
    'ed.versionMenu': 'Versions and more',
    'ed.versionInfo': 'Published version {v}',
    'ed.versionNone': 'Not published yet',
    'ed.revert': 'Discard changes (back to version {v})',
    'ed.checksum': 'Graph checksum',
    'ed.dagOk': 'Graph is valid: one trigger, no cycles',
    'ed.empty': 'How does the automation start?',
    'ed.emptyHint': 'Choose the event that starts it.',
    'ed.addStep': 'Add step',
    'ed.addNext': 'Add next step',
    'ed.notFound': 'Automation not found.',
    'ed.fixFirst': 'Fix these first:',
    'ed.activateTitle': 'Turn on “{name}”?',
    'ed.activateExternal': 'Once on, the automation will perform external actions:',
    'ed.activateNoExternal': 'The automation performs no external actions.',
    'ed.activateDemo':
      'This is a demo: turning it on only changes the status. No real runs happen.',
    'ed.activateConfirm': 'Yes, turn on',
    'ed.cancel': 'Cancel',
    'ed.activated': 'Automation is on (demo).',
    'ed.paused': 'Automation is off.',
    'ed.published': 'Changes published (version {v}).',
    'ed.reverted': 'Draft reverted to version {v}.',
    'ed.unsavedClose': 'This step has unsaved changes. Close without saving?',

    'run.title': 'Test result',
    'run.simulated': 'Simulation',
    'run.close': 'Collapse',
    'run.ok': 'Everything works: all steps passed (simulation).',
    'run.stopped': 'Stopped by the condition at step {n} — that is expected, no data went further.',
    'run.failed': 'The test stopped at step {n}.',
    'run.skipped': 'Skipped — step is disabled',
    'run.notReached': 'Not run',
    'run.showError': 'Show error',

    'err.noConnection': 'No {service} account is selected in this step.',
    'err.connectionMissing': 'The selected {service} connection was removed. Choose another one.',
    'err.field': 'Missing: {label}.',
    'err.badToken': 'Could not recognise the inserted data {token}. Pick it again.',
    'err.noTrigger': 'Add a first step — the event that starts the automation.',
    'err.multiTrigger': 'An automation can have only one starting event.',
    'err.cycle': 'Cannot connect these: the steps would form a loop ({path}).',
    'err.planned': 'This action is not available yet — the integration is in progress.',

    'panel.close': 'Close',
    'panel.account': 'Account',
    'panel.connectNew': 'Connect {service}',
    'panel.chooseAccount': '— choose an account —',
    'panel.basic': 'Main settings',
    'panel.advanced': 'Advanced',
    'panel.dev': 'For developers',
    'panel.data': 'Insert data from previous steps',
    'panel.dataHint': 'Click to insert into the selected field.',
    'panel.noData': 'No data before this step — it is the first one.',
    'panel.stepName': 'Custom step name',
    'panel.disableStep': 'Disable step (skip it when running)',
    'panel.delete': 'Delete step',
    'panel.deleteConfirm': 'Delete step “{name}”?',
    'panel.test': 'Test this step',
    'panel.save': 'Save',
    'panel.saved': 'Saved to draft.',
    'panel.example': 'Example: {text}',
    'panel.optional': 'optional',
    'panel.devType': 'Node type',
    'panel.devId': 'Node ID',
    'panel.devConfig': 'Configuration (as stored)',
    'panel.devConnect': 'Add a transition to step',
    'panel.devConnectBtn': 'Connect',
    'panel.devEdges': 'Transitions',
    'panel.devRemoveEdge': 'Remove transition',
    'panel.devNoEdges': 'No outgoing transitions',
    'panel.connected': 'Steps connected.',
    'panel.testResult': 'Step result (simulation)',
    'panel.hintTitle': 'Tip',
    'panel.hint':
      'Only the essentials are here. Rare options live under “Advanced”; data from earlier steps is inserted with the buttons below.',
    'panel.gotIt': 'Got it',

    'picker.title': 'Add a step',
    'picker.titleTrigger': 'How does the automation start?',
    'picker.search': 'What should happen? E.g. “send a message”, “receive an email”',
    'picker.planned': 'Planned',
    'picker.empty': 'Nothing found. Try “message”, “email”, “AI”, “spreadsheet”.',
    'picker.devSection': 'HTTP requests, webhooks and databases are under “For developers”.',

    'kind.trigger': 'When…',
    'kind.action': 'Do',
    'kind.logic': 'Logic',

    'onb.welcomeTitle': 'Welcome to OpenNodes',
    'onb.welcomeText': 'Let’s build your first automation in 4 short steps. What are you after?',
    'onb.goal.notifications': 'Notifications',
    'onb.goal.notificationsText': 'Get told about new things: emails, messages, feeds',
    'onb.goal.sheets': 'Spreadsheets',
    'onb.goal.sheetsText': 'Collect data into tables and reports',
    'onb.goal.ai': 'AI assistant',
    'onb.goal.aiText': 'Answer messages and process text',
    'onb.goal.custom': 'Custom scenario',
    'onb.goal.customText': 'Start from a blank canvas',
    'onb.skip': 'Skip the tour',
    'onb.hide': 'Hide',
    'onb.progress': 'Tour · step {n} of 4',
    'onb.s1': 'Pick a template. We suggest “Try an AI answer” — it sends nothing outside.',
    'onb.s2':
      'Connect a service (a test connection in the demo) or fill in the steps marked “Needs setup”.',
    'onb.s3': 'Press “Test” and see what happened at each step.',
    'onb.s4': 'Turn the automation on. We will ask you to confirm first.',
    'onb.done':
      'Done! Your first automation is ready. You can restart the tour from the profile menu.',
    'onb.goTemplates': 'Go to templates',
    'onb.close': 'Close',

    'common.close': 'Close',
    'common.yes': 'Yes',
    'common.saveError': 'Could not save: check the highlighted fields.',
    'common.justNow': 'just now',
  },
};

export const LOCALES = ['ru', 'en'];
let locale = 'en';

export function detectLocale(preferred = []) {
  for (const tag of preferred) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (LOCALES.includes(base)) return base;
  }
  return 'en';
}

export function setLocale(l) {
  locale = LOCALES.includes(l) ? l : 'en';
  document.documentElement.lang = locale;
}

export function getLocale() {
  return locale;
}

export function t(key, params = {}) {
  const template = DICT[locale][key] ?? DICT.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/** Resolve a `{ ru, en }` pair (or plain string) for the current locale. */
export function L(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[locale] ?? value.en ?? '';
}

export function formatRelative(ts) {
  const diffSec = Math.round((ts - Date.now()) / 1000);
  if (Math.abs(diffSec) < 45) return t('common.justNow');
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, sec] of units) {
    if (Math.abs(diffSec) >= sec) return rtf.format(Math.round(diffSec / sec), unit);
  }
  return rtf.format(diffSec, 'second');
}

export function formatDateTime(ts) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ts);
}

export const __DICT_FOR_TESTS = DICT;
