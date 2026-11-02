# Milestone 1 Fix Plan: @localflow/auth and @localflow/connector-sdk

- **Agent**: Milestone 1 Fix Explorer 3 (`explorer_m1_fix_3`)
- **Working Directory**: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_fix_3`
- **Target Packages**:
  - `@localflow/auth` (`packages/auth`)
  - `@localflow/connector-sdk` (`packages/connector-sdk`)
- **Date**: 2026-11-02

---

## 1. Problem Statement & Scope

Following the Milestone 1 Review and Adversarial Stress-Testing reports (`reviewer_m1_2` and `challenger_m1_2`), three specific implementation issues require precise remediation:

1. **`AesGcmEncryptionService.decrypt` Falsy Ciphertext Check**:
   - *Target*: `packages/auth/src/encryption/crypto-service.ts:45`
   - *Issue*: Envelope validation uses `!data.ciphertext`. For legitimate empty string plaintext (`""`), AES-256-GCM encryption yields `ciphertext: ""`. Because `!""` is truthy, calling `decrypt()` rejects legitimate zero-byte plaintexts with `DecryptionFailedError: Malformed encrypted data envelope.`.
   - *Fix*: Replace `!data.ciphertext` check with `typeof data.ciphertext !== 'string'`.

2. **`validateSession` Unhandled Non-String / Undefined Tokens**:
   - *Target*: `packages/auth/src/session/session-service.ts:34-43`
   - *Issue*: `validateSession(token)` unconditionally passes `token` to `hashToken(token)` (`crypto.createHash('sha256').update(token)`). When invoked with `undefined` or non-string values (e.g. unauthenticated HTTP requests where session cookie is absent), Node.js runtime throws an unhandled `TypeError`.
   - *Fix*: Prepend defensive check: `if (!token || typeof token !== 'string') return null;`.

3. **`ConnectorManifestSchema` Omission of `triggers` Definition**:
   - *Target*: `packages/connector-sdk/src/manifest.ts`
   - *Issue*: While `ConnectorDefinition` interface (`packages/connector-sdk/src/types.ts:28`) specifies `triggers?: Record<string, ConnectorTrigger<any, any>>`, `ConnectorManifestSchema` in `manifest.ts` only declares `actions`. When connector manifests containing triggers are parsed through `ConnectorManifestSchema.parse()`, Zod strips the trigger declarations.
   - *Fix*: Add `ConnectorTriggerManifestSchema` and include `triggers: z.record(z.string(), ConnectorTriggerManifestSchema).default({})` in `ConnectorManifestSchema`. Export `ConnectorTriggerManifest` type.

---

## 2. Detailed Technical Design & Code Changes

### Task 1: `AesGcmEncryptionService.decrypt` Ciphertext Envelope Validation

#### Affected Files:
1. `packages/auth/src/encryption/crypto-service.ts`
2. `packages/auth/tests/encryption.test.ts`
3. `packages/auth/tests/crypto-stress.test.ts`

#### Exact Source Code Diff (`packages/auth/src/encryption/crypto-service.ts`):
```diff
--- a/packages/auth/src/encryption/crypto-service.ts
+++ b/packages/auth/src/encryption/crypto-service.ts
@@ -42,7 +42,7 @@
   }
 
   public async decrypt(data: EncryptedData, context?: string): Promise<string> {
-    if (!data.iv || !data.authTag || !data.ciphertext) {
+    if (!data.iv || !data.authTag || typeof data.ciphertext !== 'string') {
       throw new DecryptionFailedError('Malformed encrypted data envelope.');
     }
```

#### Rationale & Semantic Analysis:
- `data.iv` and `data.authTag` must remain truthy strings (and are subsequently validated for exactly 12 and 16 bytes respectively).
- `data.ciphertext` can legitimately be an empty string `""` when encrypting 0 bytes.
- When `data.ciphertext === ""`:
  - `Buffer.from("", 'base64')` generates a 0-byte Buffer.
  - `decipher.update(Buffer.alloc(0))` generates 0 bytes.
  - `decipher.final()` verifies the 16-byte authentication tag against 0 bytes of ciphertext (and AAD if provided).
  - If the auth tag matches, `decipher.final()` returns 0 bytes, and `decrypted.toString('utf8')` returns `""`.
  - If tampered, `decipher.final()` throws an OpenSSL authentication error, properly caught and mapped to `DecryptionFailedError`.
- If `data.ciphertext` is `null`, `undefined`, a number, or boolean, `typeof data.ciphertext !== 'string'` evaluates to `true`, throwing `DecryptionFailedError('Malformed encrypted data envelope.')`.

#### Test Suite Additions:
1. In `packages/auth/tests/encryption.test.ts`:
```ts
  it('encrypts and decrypts empty string with roundtrip fidelity', async () => {
    const plaintext = '';
    const encrypted = await cryptoService.encrypt(plaintext);

    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.ciphertext).toBe('');

    const decrypted = await cryptoService.decrypt(encrypted);
    expect(decrypted).toBe('');
  });
```

2. In `packages/auth/tests/crypto-stress.test.ts`:
Update line 151-158 which previously asserted that the bug occurred:
```diff
--- a/packages/auth/tests/crypto-stress.test.ts
+++ b/packages/auth/tests/crypto-stress.test.ts
@@ -148,10 +148,10 @@
   });
 
   describe('6. Extreme Payload Sizes & Unicode Fidelity', () => {
-    it('fails to decrypt empty string plaintext due to falsy ciphertext check (!data.ciphertext) (BUG)', async () => {
+    it('successfully decrypts empty string plaintext with cryptographic roundtrip fidelity', async () => {
       const envelope = await cryptoService.encrypt('');
       expect(envelope.ciphertext).toBe('');
-      // BUG: decrypt() checks `!data.ciphertext`, throwing DecryptionFailedError on legitimate empty string ciphertext
-      await expect(cryptoService.decrypt(envelope)).rejects.toThrow(
-        /Malformed encrypted data envelope/
-      );
+      const decrypted = await cryptoService.decrypt(envelope);
+      expect(decrypted).toBe('');
     });
```

---

### Task 2: `MemorySessionStore.validateSession` Defensive Check

#### Affected Files:
1. `packages/auth/src/session/session-service.ts`
2. `packages/auth/tests/session.test.ts`

#### Exact Source Code Diff (`packages/auth/src/session/session-service.ts`):
```diff
--- a/packages/auth/src/session/session-service.ts
+++ b/packages/auth/src/session/session-service.ts
@@ -32,6 +32,7 @@
   }
 
   public async validateSession(token: string): Promise<SessionData | null> {
+    if (!token || typeof token !== 'string') return null;
     const tokenHash = hashToken(token);
     const session = this.sessions.get(tokenHash);
     if (!session) return null;
```

#### Rationale & Semantic Analysis:
- In HTTP middleware and handlers, incoming session tokens from cookies (`req.cookies.sessionId`) or authorization headers are frequently `undefined` or `null` for unauthenticated requests.
- Calling `hashToken(undefined)` executes `crypto.createHash('sha256').update(undefined)` which causes Node.js to throw `TypeError: The "data" argument must be of type string or an instance of Buffer...`.
- If an empty string `""` is passed, while `hashToken("")` completes without throwing, empty strings are not valid session tokens.
- The guard `if (!token || typeof token !== 'string') return null;` immediately short-circuits with `null`, conforming to the `Promise<SessionData | null>` return signature.

#### Test Suite Additions:
In `packages/auth/tests/session.test.ts`:
```ts
  it('returns null when validating invalid, empty, or non-string tokens defensively', async () => {
    const store = new MemorySessionStore();
    expect(await store.validateSession(undefined as any)).toBeNull();
    expect(await store.validateSession(null as any)).toBeNull();
    expect(await store.validateSession('')).toBeNull();
    expect(await store.validateSession(12345 as any)).toBeNull();
    expect(await store.validateSession({} as any)).toBeNull();
  });
```

---

### Task 3: `ConnectorManifestSchema` Triggers Definition

#### Affected Files:
1. `packages/connector-sdk/src/manifest.ts`
2. `packages/connector-sdk/tests/connector-sdk.test.ts`

#### Exact Source Code Diff (`packages/connector-sdk/src/manifest.ts`):
```diff
--- a/packages/connector-sdk/src/manifest.ts
+++ b/packages/connector-sdk/src/manifest.ts
@@ -10,6 +10,14 @@
 });
 
+export const ConnectorTriggerManifestSchema = z.object({
+  name: z.string().min(1),
+  displayName: z.string().optional(),
+  type: z.string().default('webhook'),
+  description: z.string().optional(),
+  inputs: z.array(NodePortSchema).optional().default([]),
+  outputs: z.array(NodePortSchema).default([]),
+});
+
 export const ConnectorManifestSchema = z.object({
   id: z.string().min(1),
   name: z.string().min(1),
@@ -18,6 +26,7 @@
   icon: z.string().optional(),
   category: z.enum(['core', 'ai', 'integrations', 'utilities']),
   credentialType: z.string().optional(),
   actions: z.record(z.string(), ConnectorActionManifestSchema).default({}),
+  triggers: z.record(z.string(), ConnectorTriggerManifestSchema).default({}),
 });
 
 export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>;
 export type ConnectorActionManifest = z.infer<typeof ConnectorActionManifestSchema>;
+export type ConnectorTriggerManifest = z.infer<typeof ConnectorTriggerManifestSchema>;
```

#### Rationale & Semantic Analysis:
- `packages/connector-sdk/src/types.ts` defines:
  ```ts
  export interface ConnectorTrigger<TConfig = unknown, TOutput = unknown> {
    name: string;
    type: 'manual' | 'cron' | 'webhook' | 'telegram' | string;
    description?: string;
    outputs?: NodePort[];
  }
  ```
- `ConnectorTriggerManifestSchema` accommodates trigger metadata:
  - `name`: Identifier for the trigger (e.g. `'message'`).
  - `displayName`: Human-readable label for UI canvas (optional).
  - `type`: Trigger execution type (`'manual'`, `'cron'`, `'webhook'`, `'telegram'`, or custom connector trigger string; defaults to `'webhook'`).
  - `description`: Optional text describing trigger functionality.
  - `inputs`: Optional configuration ports (defaults to `[]`).
  - `outputs`: Output ports emitting event payload to downstream nodes (defaults to `[]`).
- In `ConnectorManifestSchema`, `triggers: z.record(z.string(), ConnectorTriggerManifestSchema).default({})` ensures manifests without triggers remain valid (backward compatible), while manifests with triggers are fully validated and retained rather than stripped.
- Exporting `ConnectorTriggerManifest` completes the TypeScript SDK type exports, re-exported by `packages/connector-sdk/src/index.ts`.

#### Test Suite Additions:
In `packages/connector-sdk/tests/connector-sdk.test.ts`:
```ts
  it('validates ConnectorManifest schema with triggers', () => {
    const manifest = {
      id: 'integrations.telegram',
      name: 'Telegram',
      description: 'Telegram bot actions and webhook triggers',
      version: '1.0.0',
      category: 'integrations',
      triggers: {
        message: {
          name: 'message',
          displayName: 'On Incoming Message',
          type: 'telegram',
          description: 'Triggers when a message is received by the bot',
          outputs: [
            {
              id: 'message',
              name: 'Message Payload',
              type: 'json',
              direction: 'output',
            },
          ],
        },
      },
      actions: {},
    };

    const parsed = ConnectorManifestSchema.parse(manifest);
    expect(parsed.id).toBe('integrations.telegram');
    expect(parsed.triggers.message?.displayName).toBe('On Incoming Message');
    expect(parsed.triggers.message?.type).toBe('telegram');
    expect(parsed.triggers.message?.outputs).toHaveLength(1);
    expect(parsed.triggers.message?.outputs[0]?.id).toBe('message');
  });
```

---

## 3. Implementation Order & Verification Sequence

1. **Step 1**: Apply patch to `packages/auth/src/encryption/crypto-service.ts`, `packages/auth/tests/encryption.test.ts`, and `packages/auth/tests/crypto-stress.test.ts`.
2. **Step 2**: Apply patch to `packages/auth/src/session/session-service.ts` and `packages/auth/tests/session.test.ts`.
3. **Step 3**: Apply patch to `packages/connector-sdk/src/manifest.ts` and `packages/connector-sdk/tests/connector-sdk.test.ts`.
4. **Step 4**: Run targeted package builds and tests:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   pnpm --filter @localflow/auth test
   pnpm --filter @localflow/connector-sdk test
   ```
5. **Step 5**: Run full monorepo typecheck, build, and test suite:
   ```bash
   cd /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
   pnpm run typecheck
   pnpm run build
   pnpm turbo run test --force
   ```
