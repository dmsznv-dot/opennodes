# Fix Plan: `@localflow/observability` Redaction Hardening

**Target Package**: `@localflow/observability` (`packages/observability`)  
**Scope**:
1. `isSensitiveKey`: Support camelCase keys (`clientSecret`, `userPassword`, `dbPassword`, `accessToken`, `refreshToken`, etc.) and ensure robust casing normalization.
2. `OPENAI_API_KEY` regex: Support modern hyphenated project keys (`sk-proj-...`), admin keys (`sk-admin-...`), and add pattern scrubbers for Anthropic (`sk-ant-...`) and GitHub (`ghp_...`, `github_pat_...`).

---

## 1. Problem Analysis & Root Cause

### Issue 1: camelCase Key Bypass in `isSensitiveKey`
- **Location**: `packages/observability/src/redaction/sensitive-keys.ts:36-42`
- **Root Cause**:
  ```ts
  const SENSITIVE_KEY_REGEX =
    /^(.*[_-])?(password|secret|token|api[_-]?key|private[_-]?key|auth|credential|bearer)([_-].*)?$/i;

  export function isSensitiveKey(key: string): boolean {
    const normalized = key.toLowerCase().trim();
    if (SENSITIVE_EXACT_KEYS.has(normalized)) {
      return true;
    }
    return SENSITIVE_KEY_REGEX.test(normalized);
  }
  ```
  When evaluating `clientSecret`, `normalized` becomes `'clientsecret'`.
  The prefix `client` has no trailing `_` or `-`, failing `^(.*[_-])?`. Because `'clientsecret'` is not in `SENSITIVE_EXACT_KEYS`, `isSensitiveKey` returns `false`.
  The same failure occurs for standard idiomatic JavaScript/TypeScript credentials: `userPassword`, `dbPassword`, `accessToken`, `refreshToken`, `apiSecret`, `webhookSecret`, `bearerToken`, `sessionToken`.
  Consequently, sensitive keys logged in structured JSON payloads or error contexts bypass redaction and appear in plain text in logs.

### Issue 2: Hyphenated OpenAI Project Keys Bypass Scanner
- **Location**: `packages/observability/src/redaction/patterns.ts:33-36`
- **Root Cause**:
  ```ts
  {
    name: 'OPENAI_API_KEY',
    regex: /\bsk-[a-zA-Z0-9]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  }
  ```
  Modern default OpenAI keys use the project prefix format `sk-proj-<alphanumeric_with_dashes_or_underscores>` (e.g., `sk-proj-abc123DEF456ghi789jkl012mno345pqr678stu901vwx`), or admin format `sk-admin-...`, or service account format `sk-svcacct-...`.
  Because hyphens (`-`) are excluded from `[a-zA-Z0-9]`, the regex fails to match project keys. As demonstrated in `redaction-stress.test.ts:148-158`, the key remains completely unredacted.

### Issue 3: Missing Token Patterns for Anthropic and GitHub
- Modern AI workflows frequently configure Anthropic Claude credentials (`sk-ant-api03-...`, `sk-ant-admin01-...`) and GitHub automation tokens (`ghp_...`, `gho_...`, `ghu_...`, `ghs_...`, `ghr_...`, `github_pat_...`).
- Currently, `@localflow/observability` lacks pattern detectors for both providers, leaving freeform text, URLs, and stack traces vulnerable to token exposure.

---

## 2. Design Decisions & Implementation Strategy

### 2.1 `isSensitiveKey` Hardening
1. **CamelCase to Snake_Case Normalizer**:
   Implement `toSnakeCase(str: string): string` to convert camelCase and PascalCase identifiers to delimited snake_case before regex evaluation:
   ```ts
   function toSnakeCase(str: string): string {
     return str
       .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
       .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
       .toLowerCase();
   }
   ```
   - `clientSecret` -> `client_secret` (matches `^(.*[_-])?secret`)
   - `userPassword` -> `user_password` (matches `^(.*[_-])?password`)
   - `dbPassword` -> `db_password` (matches `^(.*[_-])?password`)
   - `accessToken` -> `access_token` (matches exact set & regex)
   - `refreshToken` -> `refresh_token` (matches exact set & regex)
   - `openAIApiKey` -> `open_ai_api_key` (matches regex)
2. **Defensive Input Handling**:
   Check `if (!key || typeof key !== 'string') return false;` to prevent runtime crashes on nullish/undefined inputs.
3. **Exact Key Set Expansion**:
   Add common concatenated forms and delimited snake_case forms to `SENSITIVE_EXACT_KEYS` for O(1) lookup:
   - `'client_secret'`, `'clientsecret'`
   - `'user_password'`, `'userpassword'`
   - `'db_password'`, `'dbpassword'`
   - `'access_token'`, `'accesstoken'`
   - `'refresh_token'`, `'refreshtoken'`
   - `'bearer_token'`, `'bearertoken'`
   - `'passphrase'`, `'pass_phrase'`
4. **False Positive Guard**:
   Non-sensitive domain keys such as `keyboard`, `turnkey`, `monkey`, `author`, `authority`, `tokenization` remain `false`.

### 2.2 Token Pattern Additions & Ordering
1. **Anthropic API Keys**:
   - Name: `'ANTHROPIC_API_KEY'`
   - Regex: `/\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g`
   - Replacement: `'[REDACTED_ANTHROPIC_KEY]'`
   - Placement: Placed **before** `OPENAI_API_KEY` to avoid collision with generic `sk-` prefixes.
2. **OpenAI API Keys (Hardened)**:
   - Name: `'OPENAI_API_KEY'`
   - Regex: `/\bsk-(?!ant-)(?:proj-|admin-|svcacct-)?[a-zA-Z0-9_-]{20,}\b/g`
   - Replacement: `'[REDACTED_API_KEY]'` (maintains backward compatibility with existing tests and log consumers)
   - Negative lookahead `(?!ant-)` guarantees Anthropic keys are never misclassified even if regex order changes.
3. **GitHub Authentication Tokens**:
   - Name: `'GITHUB_TOKEN'`
   - Regex: `/\b(?:gh[pousr]_[a-zA-Z0-9_]{16,}|github_pat_[a-zA-Z0-9_]{20,})\b/g`
   - Replacement: `'[REDACTED_GITHUB_TOKEN]'`
   - Matches classic Personal Access Tokens (`ghp_`), OAuth tokens (`gho_`), User-to-server (`ghu_`), Server-to-server (`ghs_`), Refresh tokens (`ghr_`), and Fine-grained Personal Access Tokens (`github_pat_`).

---

## 3. Exact Code Changes

### File 1: `packages/observability/src/redaction/sensitive-keys.ts`
```diff
--- a/packages/observability/src/redaction/sensitive-keys.ts
+++ b/packages/observability/src/redaction/sensitive-keys.ts
@@ -17,7 +17,17 @@
   'api_key',
   'apikey',
   'access_token',
+  'accesstoken',
   'refresh_token',
+  'refreshtoken',
+  'client_secret',
+  'clientsecret',
+  'user_password',
+  'userpassword',
+  'db_password',
+  'dbpassword',
+  'bearer_token',
+  'bearertoken',
+  'passphrase',
+  'pass_phrase',
   'webhook_secret',
   'session_token',
   'auth',
@@ -34,13 +44,28 @@
 const SENSITIVE_KEY_REGEX =
   /^(.*[_-])?(password|secret|token|api[_-]?key|private[_-]?key|auth|credential|bearer)([_-].*)?$/i;
 
+function toSnakeCase(str: string): string {
+  return str
+    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
+    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
+    .toLowerCase();
+}
+
 export function isSensitiveKey(key: string): boolean {
-  const normalized = key.toLowerCase().trim();
+  if (!key || typeof key !== 'string') {
+    return false;
+  }
+  const trimmed = key.trim();
+  const normalized = trimmed.toLowerCase();
   if (SENSITIVE_EXACT_KEYS.has(normalized)) {
     return true;
   }
-  return SENSITIVE_KEY_REGEX.test(normalized);
+  const snakeCase = toSnakeCase(trimmed);
+  if (SENSITIVE_EXACT_KEYS.has(snakeCase)) {
+    return true;
+  }
+  return SENSITIVE_KEY_REGEX.test(snakeCase) || SENSITIVE_KEY_REGEX.test(normalized);
 }
 
 export function isSensitiveContainerKey(key: string): boolean {
+  if (!key || typeof key !== 'string') {
+    return false;
+  }
   const normalized = key.toLowerCase().trim();
   return SENSITIVE_CONTAINER_KEYS.has(normalized);
 }
```

### File 2: `packages/observability/src/redaction/patterns.ts`
```diff
--- a/packages/observability/src/redaction/patterns.ts
+++ b/packages/observability/src/redaction/patterns.ts
@@ -31,9 +31,19 @@
     regex: /\b\d{8,11}:[A-Za-z0-9_-]{35}\b/g,
     replacement: '[REDACTED_TELEGRAM_TOKEN]',
   },
   {
+    name: 'ANTHROPIC_API_KEY',
+    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
+    replacement: '[REDACTED_ANTHROPIC_KEY]',
+  },
+  {
     name: 'OPENAI_API_KEY',
-    regex: /\bsk-[a-zA-Z0-9]{20,}\b/g,
+    regex: /\bsk-(?!ant-)(?:proj-|admin-|svcacct-)?[a-zA-Z0-9_-]{20,}\b/g,
     replacement: '[REDACTED_API_KEY]',
   },
   {
+    name: 'GITHUB_TOKEN',
+    regex: /\b(?:gh[pousr]_[a-zA-Z0-9_]{16,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,
+    replacement: '[REDACTED_GITHUB_TOKEN]',
+  },
   {
     name: 'PEM_PRIVATE_KEY',
```

---

## 4. Test Changes and Additions

### File 3: `packages/observability/tests/redaction.test.ts`
Add comprehensive test suites for camelCase keys, modern OpenAI project keys, Anthropic keys, and GitHub tokens:
```ts
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
```

### File 4: `packages/observability/tests/redaction-stress.test.ts`
Update the two adversarial tests that originally asserted finding reproduction, and add Anthropic & GitHub tests:
1. Lines 148–158:
   ```diff
   -      it('checks whether modern OpenAI project keys (sk-proj-...) are redacted', () => {
   +      it('redacts modern OpenAI project keys (sk-proj-...) from log text', () => {
            const projectKey = 'sk-proj-abc123DEF456ghi789jkl012mno345pqr678stu901vwx';
            const text = `OpenAI client configured with ${projectKey}`;
            const redacted = redactString(text);
   -
   -        // Security Analysis: Does the regex catch modern sk-proj keys with dashes?
   -        // Document empirical result
   -        const isCaught = !redacted.includes(projectKey);
   -        // We observe whether current regex caught it or leaked it
   -        expect(isCaught).toBe(false); // Finding: sk-proj keys with hyphens bypass regex /\bsk-[a-zA-Z0-9]{20,}\b/g
   +        expect(redacted).not.toContain(projectKey);
   +        expect(redacted).toBe('OpenAI client configured with [REDACTED_API_KEY]');
          });
   ```
2. Lines 243–258:
   ```diff
   -    it('leaks standard camelCase sensitive keys like clientSecret, userPassword, dbPassword (BUG)', () => {
   +    it('redacts standard camelCase sensitive keys like clientSecret, userPassword, dbPassword, accessToken', () => {
          const input = {
            clientSecret: 'super_secret_oauth_key',
            userPassword: 'my_plaintext_password',
            dbPassword: 'postgres_password',
            accessToken: 'ghp_secret_access_token',
          };
   
          const result: any = redact(input);
   -      // BUG: SENSITIVE_KEY_REGEX requires [_-] separator before sensitive word in lowercase,
   -      // so camelCase keys like 'clientSecret' and 'userPassword' bypass redaction!
   -      expect(result.clientSecret).toBe('super_secret_oauth_key'); // LEAKED
   -      expect(result.userPassword).toBe('my_plaintext_password'); // LEAKED
   -      expect(result.dbPassword).toBe('postgres_password'); // LEAKED
   -      expect(result.accessToken).toBe('ghp_secret_access_token'); // LEAKED
   +      expect(result.clientSecret).toBe('[REDACTED]');
   +      expect(result.userPassword).toBe('[REDACTED]');
   +      expect(result.dbPassword).toBe('[REDACTED]');
   +      expect(result.accessToken).toBe('[REDACTED]');
        });
   ```
3. Add Anthropic and GitHub stress checks under `2. Token Pattern Regex Robustness & Evasion`:
   ```ts
       describe('Anthropic & GitHub Patterns', () => {
         it('redacts Anthropic API keys from unstructured logs', () => {
           const anthropicKey =
             'sk-ant-api03-abcdef1234567890_ABCDEFGHIJKLMNOPQRSTUVWXYZ-01234567890abcdefghijklmnopqrstuvwxyz';
           const text = `Claude API invoked with ${anthropicKey}`;
           const redacted = redactString(text);
           expect(redacted).toBe('Claude API invoked with [REDACTED_ANTHROPIC_KEY]');
         });

         it('redacts GitHub Personal Access Tokens and Fine-Grained PATs', () => {
           const ghp = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
           const pat =
             'github_pat_11A1234560abcdefghijklmnopqrstuvwxyz_1234567890abcdefghijklmnopqrstuv';
           const text = `git clone using https://${ghp}@github.com/repo and PAT ${pat}`;
           const redacted = redactString(text);
           expect(redacted).toBe(
             'git clone using https://[REDACTED_GITHUB_TOKEN]@github.com/repo and PAT [REDACTED_GITHUB_TOKEN]'
           );
         });
       });
   ```

---

## 5. Verification Commands for the Implementer

1. **Build Observability Package**:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   pnpm --filter @localflow/observability build
   ```
2. **Run Observability Tests**:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   pnpm --filter @localflow/observability test
   ```
3. **Run Full Monorepo Tests**:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   pnpm turbo run test --force
   ```
4. **Run E2E Foundation Suite**:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   node tests/run-e2e.mjs f01_f08
   ```
5. **Run Full E2E Test Suite**:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   node tests/run-e2e.mjs
   ```
