import { describe, it, expect } from 'vitest';
import { redact, redactString, SecretRegistry } from '../src/index.js';

describe('Secret Redaction Engine', () => {
  it('redacts sensitive keys in deeply nested objects', () => {
    const input = {
      config: {
        host: 'api.example.com',
        auth: {
          password: 'my-super-password',
          apiKey: 'key_12345',
          secret_token: 'tok_67890',
        },
      },
    };

    const redacted = redact(input) as typeof input;
    expect(redacted.config.auth.password).toBe('[REDACTED]');
    expect(redacted.config.auth.apiKey).toBe('[REDACTED]');
    expect(redacted.config.auth.secret_token).toBe('[REDACTED]');
    expect(redacted.config.host).toBe('api.example.com');
  });

  it('redacts case-insensitive and fuzzy sensitive keys', () => {
    const input = {
      PASSWORD: '123',
      Secret_Key: 'abc',
      user_auth_token: 'xyz',
      PRIVATE_KEY: 'pem',
    };
    const redacted = redact(input) as Record<string, string>;
    expect(redacted.PASSWORD).toBe('[REDACTED]');
    expect(redacted.Secret_Key).toBe('[REDACTED]');
    expect(redacted.user_auth_token).toBe('[REDACTED]');
    expect(redacted.PRIVATE_KEY).toBe('[REDACTED]');
  });

  it('scrubs Bearer tokens from arbitrary strings', () => {
    const text = 'Making request with header Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDN to auth';
    const result = redactString(text);
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('scrubs Basic auth tokens from arbitrary strings', () => {
    const text = 'Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=';
    const result = redactString(text);
    expect(result).toBe('Authorization: Basic [REDACTED]');
  });

  it('scrubs Telegram Bot tokens', () => {
    const text = 'Connecting to Telegram bot 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ123456789';
    const result = redactString(text);
    expect(result).toBe('Connecting to Telegram bot [REDACTED_TELEGRAM_TOKEN]');
  });

  it('scrubs AWS keys and OpenAI keys', () => {
    const text = 'Access key AKIAIOSFODNN7EXAMPLE with secret sk-1234567890abcdefghijklmnopqrstuvwxyz';
    const result = redactString(text);
    expect(result).toContain('[REDACTED_AWS_KEY]');
    expect(result).toContain('[REDACTED_API_KEY]');
  });

  it('scrubs PEM private keys', () => {
    const text = `Certificate loaded:
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+
...
-----END RSA PRIVATE KEY-----
Proceeding...`;
    const result = redactString(text);
    expect(result).toContain('[REDACTED_PRIVATE_KEY]');
    expect(result).not.toContain('MIIEowIBAAKCAQEA0Y1+');
  });

  it('scrubs registered runtime secrets dynamically from SecretRegistry', () => {
    const registry = new SecretRegistry();
    registry.register('my-custom-unusual-database-password');
    registry.register('secret-tenant-code-7788');

    const message = 'Failed connecting to postgres://user:my-custom-unusual-database-password@localhost/db with tenant secret-tenant-code-7788';
    const result = redactString(message, registry);

    expect(result).toBe(
      'Failed connecting to postgres://user:[REDACTED_SECRET]@localhost/db with tenant [REDACTED_SECRET]'
    );
    expect(result).not.toContain('my-custom-unusual-database-password');
  });

  it('handles circular references gracefully without stack overflow', () => {
    const circular: any = { name: 'Root' };
    circular.self = circular;

    const result: any = redact(circular);
    expect(result.name).toBe('Root');
    expect(result.self).toBe('[CIRCULAR]');
  });

  it('redacts Error objects including error stack traces', () => {
    const err = new Error('Connection failed with token sk-abcdefghijklmnopqrstuvwxyz');
    const result: any = redact(err);

    expect(result.name).toBe('Error');
    expect(result.message).toContain('[REDACTED_API_KEY]');
    expect(result.message).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts camelCase sensitive keys (clientSecret, userPassword, dbPassword, accessToken, refreshToken)', () => {
    const input = {
      clientSecret: 'secret_oauth_client_xyz',
      userPassword: 'plaintext_user_pass_123',
      dbPassword: 'super_secret_pg_pass',
      accessToken: 'jwt_access_token_val',
      refreshToken: 'refresh_token_secret_val',
      apiSecret: 'custom_api_secret',
      webhookSecret: 'whsec_abcdef123456',
      bearerToken: 'tok_bearer_123',
      sessionToken: 'sess_tok_456',
      normalField: 'leave_unredacted',
    };

    const redacted = redact(input) as Record<string, string>;
    expect(redacted.clientSecret).toBe('[REDACTED]');
    expect(redacted.userPassword).toBe('[REDACTED]');
    expect(redacted.dbPassword).toBe('[REDACTED]');
    expect(redacted.accessToken).toBe('[REDACTED]');
    expect(redacted.refreshToken).toBe('[REDACTED]');
    expect(redacted.apiSecret).toBe('[REDACTED]');
    expect(redacted.webhookSecret).toBe('[REDACTED]');
    expect(redacted.bearerToken).toBe('[REDACTED]');
    expect(redacted.sessionToken).toBe('[REDACTED]');
    expect(redacted.normalField).toBe('leave_unredacted');
  });

  it('scrubs modern OpenAI project keys (sk-proj-...) and admin/service keys', () => {
    const projKey = 'sk-proj-abc123DEF456ghi789jkl012mno345pqr678stu901vwx';
    const adminKey = 'sk-admin-xyz987UVW654rst321qpo098nml765kji543hgf210edc';
    const svcacctKey = 'sk-svcacct-test_service_account_token_with_many_chars_12345';
    const legacyKey = 'sk-1234567890abcdefghijklmnopqrstuvwxyz';

    const text = `Keys: proj=${projKey}, admin=${adminKey}, svc=${svcacctKey}, leg=${legacyKey}`;
    const result = redactString(text);

    expect(result).toBe(
      'Keys: proj=[REDACTED_API_KEY], admin=[REDACTED_API_KEY], svc=[REDACTED_API_KEY], leg=[REDACTED_API_KEY]'
    );
    expect(result).not.toContain(projKey);
    expect(result).not.toContain(adminKey);
    expect(result).not.toContain(svcacctKey);
    expect(result).not.toContain(legacyKey);
  });

  it('scrubs Anthropic API keys (sk-ant-...)', () => {
    const antKey =
      'sk-ant-api03-abcdef1234567890_ABCDEFGHIJKLMNOPQRSTUVWXYZ-01234567890abcdefghijklmnopqrstuvwxyz';
    const antAdminKey = 'sk-ant-admin01-some_admin_token_with_many_alphanumeric_chars';

    const text = `Anthropic: ${antKey} and ${antAdminKey}`;
    const result = redactString(text);

    expect(result).toBe('Anthropic: [REDACTED_ANTHROPIC_KEY] and [REDACTED_ANTHROPIC_KEY]');
    expect(result).not.toContain(antKey);
    expect(result).not.toContain(antAdminKey);
  });

  it('scrubs GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)', () => {
    const classicPat = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
    const oauthToken = 'gho_ABCDEF1234567890abcdef1234567890abcd';
    const userToken = 'ghu_1234567890abcdefghijklmnopqrstuvwxyz';
    const serverToken = 'ghs_1234567890abcdefghijklmnopqrstuvwxyz';
    const refreshToken = 'ghr_1234567890abcdefghijklmnopqrstuvwxyz';
    const fineGrainedPat =
      'github_pat_11A1234560abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuv';

    const text = `GitHub: pat=${classicPat}, o=${oauthToken}, u=${userToken}, s=${serverToken}, r=${refreshToken}, fine=${fineGrainedPat}`;
    const result = redactString(text);

    expect(result).toBe(
      'GitHub: pat=[REDACTED_GITHUB_TOKEN], o=[REDACTED_GITHUB_TOKEN], u=[REDACTED_GITHUB_TOKEN], s=[REDACTED_GITHUB_TOKEN], r=[REDACTED_GITHUB_TOKEN], fine=[REDACTED_GITHUB_TOKEN]'
    );
    expect(result).not.toContain(classicPat);
    expect(result).not.toContain(oauthToken);
    expect(result).not.toContain(fineGrainedPat);
  });
});
