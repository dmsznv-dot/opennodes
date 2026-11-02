# Handoff Report: Milestone 1 Explorer 3 (Security, Envelope Encryption, Redaction & SSRF Guard)

## 1. Observation

1. **Dispatch Scope & Mandate**:
   - `DISPATCH.md` lines 4-19:
     - F03 & F04: AES-256-GCM envelope encryption service (`encrypt`, `decrypt`, key versioning, zero plaintext leak), password hashing with Argon2id / bcrypt, 4-tier RBAC policy engine (`Owner`, `Admin`, `Editor`, `Viewer`), one-time owner bootstrapping flow.
     - F05: Secret Redaction Engine (`packages/observability`) with recursive redaction masking sensitive keys, Bearer tokens, high-entropy tokens, and Pino logger serializers.
     - F06: SSRF Defense Engine (`packages/connector-sdk` / `packages/shared`) enforcing pre-request DNS resolution, CIDR blocklist (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `169.254.169.254`, `::1`, `fc00::/7`, `fe80::/10`), and socket-level IP pinning (`lookup` override in `http.Agent`/`https.Agent`) to defeat DNS rebinding attacks.

2. **Architecture Specification & Interface Contracts**:
   - `PROJECT.md` lines 178-196 define the required interfaces:
     ```typescript
     export interface EncryptedData {
       keyVersion: number;
       iv: string;       // base64
       authTag: string;  // base64
       ciphertext: string; // base64
     }

     export interface EncryptionService {
       encrypt(plaintext: string): Promise<EncryptedData>;
       decrypt(data: EncryptedData): Promise<string>;
     }

     export interface RedactionService {
       redact(obj: unknown): unknown; // recursively masks passwords, tokens, secrets
     }
     ```
   - `PROJECT.md` line 169 defines `httpClient: SafeHttpClient` within `ConnectorContext`.
   - `survey_spec.md` § 7.1 lines 756-774 defines the 4-tier RBAC capability matrix, explicitly mandating that no role can ever view decrypted credential secrets via public API.
   - `survey_spec.md` § 7.2 lines 775-796 defines MEK 32-byte key handling, AES-256-GCM cipher with 12-byte CSPRNG IV, and zero-plaintext exfiltration.
   - `survey_spec.md` § 7.3 lines 797-806 defines the multi-layer redaction pipeline (exact secret masking, header scrubbing, key pattern matching, entropy/token detectors).
   - `survey_spec.md` § 7.4 lines 807-825 specifies the SSRF defense rules, DNS rebinding mitigation with socket-level IP pinning, redirect validation, and `SSRF_ALLOWLIST`.

3. **Runtime & Environment Status**:
   - Node.js version is `v24.21.0` (LTS) with native `node:crypto` (`crypto.createCipheriv`, `crypto.createDecipheriv`, `crypto.randomBytes`, `crypto.scrypt`).
   - `pnpm` version is `12.16.1`.
   - Apple Silicon Darwin ARM64 host environment requires zero-native-compilation dependencies to guarantee seamless execution across macOS, Linux CI, and Alpine/Debian Docker containers (`bcryptjs` chosen for password hashing; `node:crypto` for AES-256-GCM and Scrypt).

---

## 2. Logic Chain

1. **Cryptographic Integrity & Key Versioning (F04)**:
   - *From Observation 2*: `EncryptedData` requires `keyVersion`, `iv`, `authTag`, `ciphertext` in base64.
   - *Deduction*: AES-256-GCM requires a 32-byte key, 12-byte IV (which MUST NOT be reused), and produces a 16-byte authentication tag.
   - *Design*: `AesGcmEncryptionService` generates a fresh `crypto.randomBytes(12)` IV on every `encrypt()` call. It binds optional `AAD` context (e.g. `workspaceId:credentialId`) to prevent ciphertext transplant attacks.
   - *Integrity Verification*: If any byte of `ciphertext`, `iv`, or `authTag` is tampered with, OpenSSL fails tag verification during `decipher.final()`. The service intercepts this and throws `DecryptionFailedError` without leaking internal key or stack traces.
   - *Zero Exfiltration*: `maskSecret()` provides visual hints (`••••••••4f2a`), and `sanitizeCredentialEntity()` completely strips `encryptedPayload` from read responses.

2. **Authorization Boundary & Owner Bootstrap (F03)**:
   - *From Observation 2*: PRD § 7.1 establishes a strict hierarchy (`OWNER` > `ADMIN` > `EDITOR` > `VIEWER`).
   - *Design*: We define 18 granular permissions. `OWNER` has all 18. `ADMIN` has 16 (cannot delete workspace or transfer ownership). `EDITOR` has 10 (can create drafts, edit nodes, reference credentials, test run workflows; CANNOT publish, rollback, manage members, or delete credentials). `VIEWER` has 4 (read-only view of workflows, canvas, executions, and credential summaries).
   - *One-time Bootstrap*: `BootstrapService` checks `isSystemBootstrapped()`. If true, any subsequent attempt immediately throws `AlreadyBootstrappedError` (`ERR_ALREADY_BOOTSTRAPPED`), preventing attacker takeover of existing instances.
   - *Password Hashing*: Implements `BcryptPasswordHasher` (via `bcryptjs` for portable cross-platform stability) and `ScryptPasswordHasher` (via `node:crypto.scrypt` with constant-time `timingSafeEqual`), resisting brute-force and side-channel attacks.

3. **Deep Recursive Redaction Pipeline (F05)**:
   - *From Observation 2*: Execution logs, canvas run inspector inputs/outputs, and exports must not leak secrets.
   - *Design*: The engine applies a 4-tier pipeline:
     1. Key name masking (exact & fuzzy matching `password`, `secret`, `token`, `api_key`, `private_key`).
     2. Header scrubbing (`Authorization`, `Cookie`, `X-Api-Key`, `Proxy-Authorization`).
     3. Dynamic `SecretRegistry` for exact string scrubbing of decrypted secrets encountered at runtime.
     4. Regex token scrubbers for Bearer tokens, Basic auth, JWTs, AWS keys, Slack tokens, Telegram bot tokens, PEM private keys, and OpenAI keys.
   - *Cycle Handling*: Object graphs are tracked with `WeakSet<object>`, replacing circular references with `"[CIRCULAR]"` to prevent stack overflows.
   - *Pino Integration*: Custom Pino serializers (`req`, `res`, `err`) and log formatters automatically invoke `redact()` before writing log lines to stdout or streams.

4. **SSRF Defense with Socket-Level IP Pinning (F06)**:
   - *From Observation 2*: Attacking outbound HTTP connectors with private RFC 1918 IPs, cloud metadata IPs, or DNS rebinding poses a severe threat.
   - *Design*:
     - *CIDR Blocklist*: Complete coverage of RFC 1918, RFC 3927 (link-local & metadata `169.254.169.254`), RFC 1122 (loopback `127.0.0.0/8`, `0.0.0.0/8`), RFC 6598 (CGNAT), and IPv6 loopback (`::1`), ULA (`fc00::/7`), and link-local (`fe80::/10`).
     - *Normalization*: Parses and decodes alternate IP encodings (hex `0x7f000001`, octal `0177.0.0.1`, DWORD `2130706433`, IPv4-mapped IPv6 `::ffff:127.0.0.1`) before validation.
     - *Anti-Rebinding (IP Pinning)*: Resolves DNS pre-connection via `dns.promises.lookup(hostname, { all: true })`. If ANY address is in a denied range, the request aborts with `SsrfBlockedError`. Then, a custom `http.Agent`/`https.Agent` overrides `lookup` to bind the TCP socket directly to the pre-validated IP. For HTTPS, SNI servername remains set to the hostname, preserving TLS certificate verification while pinning the socket connection to the safe IP.
     - *Redirect Defense*: Redirects (301, 302, 303, 307, 308) are followed only after re-running the full SSRF validation on the destination URL (max 5 hops).
     - *Allowlist*: `SSRF_ALLOWLIST` permits explicitly sanctioned internal endpoints (e.g. `localhost:8080`, `192.168.1.50`).

---

## 3. Caveats

1. **Database Adapter Dependency for Bootstrap**:
   - `BootstrapService` requires an injected `BootstrapDatabaseAdapter` interface (`isSystemBootstrapped`, `createOwnerAndWorkspace`). In M1, Milestone 1 Explorer 2 / Worker will implement this adapter against Drizzle ORM in `packages/db`. The interface in `packages/auth` is decoupled so it can be tested in isolation with an in-memory mock.
2. **Environment Variable Configuration**:
   - Production deployments must set `ENCRYPTION_KEY` (32 bytes). In development/test environments, tests must use a default 32-byte test key (e.g. `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`).
3. **No Caveats on Cryptographic or SSRF Safety**:
   - The cipher parameters (AES-256-GCM, 12-byte random IV, 16-byte tag), IP parsing, and socket pinning strictly adhere to NIST SP 800-38D and OWASP SSRF prevention guidelines.

---

## 4. Conclusion

Features F03, F04, F05, and F06 are fully architected, specified, and ready for worker implementation:
- **`packages/auth`**: Provides AES-256-GCM envelope encryption with key versioning, 4-tier RBAC engine with 18 discrete permissions, one-time owner bootstrap lock, and dual password hashers (Bcrypt and Scrypt).
- **`packages/observability`**: Provides a 4-layer recursive secret redactor with circular reference protection and Pino logger integration.
- **`packages/shared` / `packages/connector-sdk`**: Provides the SSRF defense engine with comprehensive IPv4/IPv6 CIDR matching, obfuscated IP normalization, socket-level IP pinning, redirect guards, and allowlist support.

The concrete code plan is published at:
`/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3/m1_3_plan.md`

---

## 5. Verification Method

Once implemented by the worker, the code must be independently verified using the following commands and checks:

1. **Build & Typecheck**:
   ```bash
   pnpm --filter @localflow/auth build
   pnpm --filter @localflow/observability build
   pnpm --filter @localflow/shared build
   pnpm -r typecheck
   ```
   *Expected*: Zero TypeScript diagnostic errors (`Exit code 0`).

2. **Unit & Security Tests**:
   ```bash
   # Run all auth tests (encryption roundtrips, tampered auth tags, RBAC matrix, bootstrap lock, password hashing)
   pnpm --filter @localflow/auth test

   # Run all observability tests (recursive redaction, headers, JWT, tokens, circular refs, Pino serializer)
   pnpm --filter @localflow/observability test

   # Run SSRF defense tests (loopback, 169.254.169.254, RFC 1918, octal/hex/DWORD IPs, DNS rebinding mock, 302 redirect)
   pnpm --filter @localflow/shared test
   ```
   *Expected*: 100% of tests pass across all test suites (`Exit code 0`).

3. **Invalidation Conditions**:
   - Decrypting tampered ciphertext or modified auth tag does NOT throw an error (integrity failure).
   - Plaintext credentials or secret tokens appear in log serializer output or `SanitizedCredential` summaries.
   - An HTTP request to `http://127.0.0.1:8080`, `http://169.254.169.254`, `http://0x7f000001`, or a 302 redirect to loopback succeeds without throwing `SsrfBlockedError`.
   - A subsequent call to `bootstrapOwner()` succeeds after the system has already been bootstrapped.
