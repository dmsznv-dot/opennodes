const SENSITIVE_EXACT_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'key',
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'credential',
  'credentials',
  'private_key',
  'privatekey',
  'api_key',
  'apikey',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'client_secret',
  'clientsecret',
  'user_password',
  'userpassword',
  'db_password',
  'dbpassword',
  'bearer_token',
  'bearertoken',
  'passphrase',
  'pass_phrase',
  'webhook_secret',
  'session_token',
  'auth',
  'x-api-key',
  'x-auth-token',
]);

const SENSITIVE_CONTAINER_KEYS = new Set([
  'auth',
  'credential',
  'credentials',
]);

const SENSITIVE_KEY_REGEX =
  /^(.*[_-])?(password|secret|token|api[_-]?key|private[_-]?key|auth|credential|bearer)([_-].*)?$/i;

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

export function isSensitiveKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }
  const trimmed = key.trim();
  const normalized = trimmed.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(normalized)) {
    return true;
  }
  const snakeCase = toSnakeCase(trimmed);
  if (SENSITIVE_EXACT_KEYS.has(snakeCase)) {
    return true;
  }
  return SENSITIVE_KEY_REGEX.test(snakeCase) || SENSITIVE_KEY_REGEX.test(normalized);
}

export function isSensitiveContainerKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }
  const normalized = key.toLowerCase().trim();
  return SENSITIVE_CONTAINER_KEYS.has(normalized);
}
