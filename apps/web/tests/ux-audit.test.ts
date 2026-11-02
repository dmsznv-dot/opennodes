import { describe, it, expect } from 'vitest';
import {
  MESSAGES,
  createTranslator,
  detectLocale,
  slugifyWorkspaceName,
  NodeConfigDrawerController,
  SetupWizardController,
  RunInspectorController,
  type ConfigFieldDefinition,
} from '../src/index.js';

describe('@localflow/web — UX audit v1 fixes', () => {
  it('BUG-04: builds Unicode-safe, collision-free workspace slugs', () => {
    expect(slugifyWorkspaceName('Моя команда')).toBe('moya-komanda');
    expect(slugifyWorkspaceName('Café Équipe')).toBe('cafe-equipe');
    expect(slugifyWorkspaceName('OpenNodes Core')).toBe('opennodes-core');

    const cjkA = slugifyWorkspaceName('工作区');
    const cjkB = slugifyWorkspaceName('团队');
    expect(cjkA).toMatch(/^ws-[a-z0-9]+$/);
    expect(cjkA).toBe(slugifyWorkspaceName('工作区'));
    expect(cjkA).not.toBe(cjkB);
    expect(cjkA).not.toBe('primary');

    expect(slugifyWorkspaceName('Моя команда', ['moya-komanda'])).toBe('moya-komanda-2');
    expect(slugifyWorkspaceName('Моя команда', ['moya-komanda', 'moya-komanda-2'])).toBe(
      'moya-komanda-3'
    );

    const res = SetupWizardController.validateAndPrepareRedirect({
      email: 'owner@example.com',
      password: 'StrongPassword123!',
      fullName: 'Owner',
      workspaceName: 'Моя команда',
    });
    expect(res.redirectPath).toBe('/workspaces/moya-komanda/workflows');
  });

  it('BUG-02/03: typed field inputs round-trip false, 0, [], {}, empty optionals and expressions', () => {
    const fields: ConfigFieldDefinition[] = [
      { key: 'enabled', label: 'Enabled', type: 'boolean', required: true },
      { key: 'retries', label: 'Retries', type: 'number', required: true },
      { key: 'items', label: 'Items', type: 'json', required: false },
      { key: 'headers', label: 'Headers', type: 'json', required: false },
      { key: 'note', label: 'Note', type: 'string', required: false },
      { key: 'limit', label: 'Limit', type: 'number', required: false },
      { key: 'method', label: 'Method', type: 'select', required: true, options: ['GET', 'POST'] },
    ];

    const res = NodeConfigDrawerController.coerceConfig(fields, {
      enabled: false,
      retries: '0',
      items: '[]',
      headers: '{}',
      note: '',
      limit: '{{ $trigger.limit }}',
      method: 'GET',
    });
    expect(res.valid).toBe(true);
    expect(res.config).toEqual({
      enabled: false,
      retries: 0,
      items: [],
      headers: {},
      limit: '{{ $trigger.limit }}',
      method: 'GET',
    });
    expect('note' in res.config).toBe(false);

    const bad = NodeConfigDrawerController.coerceConfig(
      fields,
      { enabled: 'false', retries: 'abc', items: '[1,', method: 'PUT' },
      'ru'
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors.retries).toContain('число');
    expect(bad.errors.items).toContain('JSON');
    expect(bad.errors.method).toBeDefined();
    expect(bad.errors.enabled).toBeUndefined();
    expect(bad.errors.note).toBeUndefined();

    // validateConfig must not treat false / 0 as missing
    const v = NodeConfigDrawerController.validateConfig(fields, {
      enabled: false,
      retries: 0,
      method: 'GET',
    });
    expect(v.valid).toBe(true);
  });

  it('BUG-07: RU/EN dictionaries are complete and errors are localized', () => {
    expect(Object.keys(MESSAGES.ru).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    expect(detectLocale(['ru-RU', 'en'])).toBe('ru');
    expect(detectLocale(['de-DE'])).toBe('en');

    const t = createTranslator('ru');
    expect(t('setup.error.password', { min: 8 })).toBe('Пароль должен быть не короче 8 символов.');

    const ru = SetupWizardController.validateAndPrepareRedirect(
      { email: 'bad', password: 'x', fullName: '', workspaceName: '' },
      false,
      { locale: 'ru' }
    );
    expect(ru.valid).toBe(false);
    expect(ru.errorCodes).toEqual({
      email: 'setup.error.email',
      password: 'setup.error.password',
      workspaceName: 'setup.error.workspaceName',
    });
    expect(ru.errors.email).toBe('Введите корректный email владельца.');

    const step = RunInspectorController.formatStepForDisplay(
      {
        nodeId: 'n1',
        nodeName: 'Step',
        status: 'FAILED',
        attempt: 3,
        startedAt: '2026-11-02T12:00:00Z',
        durationMs: 10,
        inputPayload: {},
      },
      'ru'
    );
    expect(step.attemptBadge).toBe('Попытка №3');
    expect(step.errorDiagnostic).toContain('ошибкой');
  });
});
