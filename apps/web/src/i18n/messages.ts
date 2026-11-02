/**
 * Centralized UI dictionary. Keys are stable message codes; business IDs and schemas
 * are never translated. Every key must exist in both locales (enforced by tests).
 */
export const MESSAGES = {
  en: {
    'setup.error.alreadyBootstrapped': 'This instance is already set up. Redirecting to sign in.',
    'setup.error.email': 'Enter a valid owner email address.',
    'setup.error.password': 'Password must be at least {min} characters.',
    'setup.error.workspaceName': 'Enter a workspace name (at least 2 characters).',
    'field.error.required': "Field '{label}' is required.",
    'field.error.number': "Field '{label}' must be a number.",
    'field.error.json': "Field '{label}' must be valid JSON: {reason}",
    'field.error.select': "Choose one of the options for '{label}'.",
    'run.attempt': 'Attempt #{attempt}',
    'run.failedFallback': 'This step failed. Open technical details to see why.',
  },
  ru: {
    'setup.error.alreadyBootstrapped': 'Этот сервер уже настроен. Переходим ко входу.',
    'setup.error.email': 'Введите корректный email владельца.',
    'setup.error.password': 'Пароль должен быть не короче {min} символов.',
    'setup.error.workspaceName': 'Введите название пространства (минимум 2 символа).',
    'field.error.required': 'Заполните поле «{label}».',
    'field.error.number': 'В поле «{label}» должно быть число.',
    'field.error.json': 'В поле «{label}» некорректный JSON: {reason}',
    'field.error.select': 'Выберите один из вариантов в поле «{label}».',
    'run.attempt': 'Попытка №{attempt}',
    'run.failedFallback': 'Шаг завершился с ошибкой. Подробности — в «Технических деталях».',
  },
} as const;

export type Locale = keyof typeof MESSAGES;
export type MessageKey = keyof (typeof MESSAGES)['en'];
