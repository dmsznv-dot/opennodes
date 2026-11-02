export const TOKEN_PATTERNS = [
  {
    name: 'BEARER_TOKEN',
    regex: /Bearer\s+[a-zA-Z0-9_\-\.~+/]+=*/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    name: 'BASIC_AUTH',
    regex: /Basic\s+[a-zA-Z0-9+/=]{10,}/gi,
    replacement: 'Basic [REDACTED]',
  },
  {
    name: 'JWT',
    regex: /\beyJ[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\b/g,
    replacement: '[REDACTED_JWT]',
  },
  {
    name: 'AWS_ACCESS_KEY',
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  {
    name: 'SLACK_TOKEN',
    regex: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  {
    name: 'TELEGRAM_BOT_TOKEN',
    regex: /\b\d{8,11}:[A-Za-z0-9_-]{35}\b/g,
    replacement: '[REDACTED_TELEGRAM_TOKEN]',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_ANTHROPIC_KEY]',
  },
  {
    name: 'OPENAI_API_KEY',
    regex: /\bsk-(?!ant-)(?:proj-|admin-|svcacct-)?[a-zA-Z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'GITHUB_TOKEN',
    regex: /\b(?:gh[pousr]_[a-zA-Z0-9_]{16,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    name: 'PEM_PRIVATE_KEY',
    regex:
      /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
];
