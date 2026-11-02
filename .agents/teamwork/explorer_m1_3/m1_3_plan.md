# Milestone 1 Implementation Plan: Security, Envelope Encryption, Redaction & SSRF Guard

**Features**: F03 (RBAC & Identity), F04 (Credential Envelope Encryption), F05 (Secret Redaction Engine), F06 (SSRF Defense Engine)  
**Target Packages**: `packages/auth`, `packages/observability`, `packages/shared`, `packages/connector-sdk`  
**Date**: 2026-11-02  
**Explorer**: Explorer M1-3  

---

## 1. Executive Summary & Architecture Overview

This plan specifies the complete, concrete implementation for the security foundation of LocalFlow. These four features protect credentials at rest, restrict user capabilities at the workspace boundary, prevent confidential leakage into logs and canvas inspectors, and secure outgoing network execution against internal infrastructure probing and cloud metadata exfiltration.

```
+---------------------------------------------------------------------------------------+
|                                    apps/api & apps/worker                             |
+---------------------------------------------------------------------------------------+
              |                                        |                        |
              v                                        v                        v
+-------------------------------+       +--------------------------+  +--------------------------+
|        packages/auth          |       |  packages/observability  |  | packages/shared / SDK    |
|-------------------------------|       |--------------------------|  |--------------------------|
| • F04 Envelope Encryption     |       | • F05 Redaction Engine   |  | • F06 SSRF Defense       |
|   - AES-256-GCM               |       |   - Recursive Masker     |  |   - CIDR Blocklist       |
|   - CSPRNG 12-byte IV         |       |   - Exact Secret Scrub   |  |   - Pre-DNS Resolution   |
|   - 16-byte Auth Tag          |       |   - Regex Token Detectors|  |   - Socket IP Pinning    |
|   - Key Versioning            |       |   - Pino Serializers     |  |   - Redirect Guard       |
|   - Secret Masking Hint       |       |   - Cycle Detection      |  |   - Allowlist Policy     |
| • F03 RBAC & Identity         |       +--------------------------+  +--------------------------+
|   - 4-Tier Roles              |
|   - 18 Discrete Permissions   |
|   - Policy Engine Checker     |
|   - Owner Bootstrap Lock      |
|   - Password Hashing (Argon2/ |
|     Bcrypt / Scrypt)          |
+-------------------------------+
```

---

## 2. Package Configurations & Dependencies

### 2.1 `packages/auth/package.json`
```json
{
  "name": "@localflow/auth",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@localflow/shared": "workspace:*",
    "bcryptjs": "^2.4.3",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^22.10.1",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

### 2.2 `packages/observability/package.json`
```json
{
  "name": "@localflow/observability",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@localflow/shared": "workspace:*",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.1",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

### 2.3 SSRF Engine within `packages/shared` & `packages/connector-sdk`
The SSRF module is placed in `packages/shared/src/ssrf/` (with re-export in `packages/connector-sdk`), allowing both SDK and API/worker layers to consume the safe HTTP client without circular dependencies.

---

## 3. Feature F04: Credential Envelope Encryption (`packages/auth`)

### 3.1 Architecture & Cryptographic Specification

1. **Master Encryption Key (MEK)**:
   - Configured via environment variable `ENCRYPTION_KEY` (32 bytes / 256 bits).
   - Accepted encodings: 64-character hexadecimal or 32 raw UTF-8 bytes or 44-character Base64.
   - Support for key rotation via `KeyProvider`:
     - Default active key version: `1` (or specified by `ENCRYPTION_KEY_VERSION`).
     - Supports key map `{ [version: number]: Buffer }` to allow decrypting legacy credentials encrypted under previous key versions and re-encrypting under the current active version.
2. **Cipher Algorithm**:
   - Standard: **AES-256-GCM** (`crypto.createCipheriv('aes-256-gcm', key, iv)`).
   - IV (Initialization Vector): 12 bytes (96 bits) randomly generated per operation via `crypto.randomBytes(12)`.
   - Auth Tag: 16 bytes (128 bits) via `cipher.getAuthTag()`.
   - Additional Authenticated Data (AAD): Optional context binding (e.g. `workspaceId:credentialId`) passed into `cipher.setAAD()`, preventing ciphertext transplant attacks between different credentials.
3. **Data Representation (`EncryptedData`)**:
   Conforms to `PROJECT.md § Interface Contracts`:
   ```typescript
   export interface EncryptedData {
     keyVersion: number;
     iv: string;         // base64
     authTag: string;    // base64
     ciphertext: string; // base64
   }
   ```
4. **Zero Plaintext Exfiltration Guarantee**:
   - `maskSecret(value: string): string`: Produces safe visual hints (e.g. `"••••••••4f2a"`).
   - `sanitizeCredential(entity)`: Completely strips `encryptedPayload` and produces `{ id, name, type, maskedHint, createdAt, updatedAt }`.

### 3.2 File Structure (`packages/auth/src/encryption/`)
```
packages/auth/src/encryption/
├── key-provider.ts        # MEK resolution, validation, and multi-version rotation
├── crypto-service.ts      # AES-256-GCM encrypt, decrypt, encryptJson, decryptJson
├── masking.ts             # Secret hint generator and credential sanitization
├── errors.ts              # EncryptionError, InvalidKeyError, DecryptionFailedError
└── index.ts               # Public exports
```

### 3.3 Concrete Code Implementation

#### `key-provider.ts`
```typescript
import { Buffer } from 'node:buffer';
import { InvalidKeyError, KeyVersionNotFoundError } from './errors.js';

export interface KeyProvider {
  getKey(version?: number): Buffer;
  getActiveVersion(): number;
}

export class EnvKeyProvider implements KeyProvider {
  private readonly keys = new Map<number, Buffer>();
  private activeVersion: number;

  constructor(envKey?: string, activeVersion = 1, rotationKeys?: Record<number, string>) {
    this.activeVersion = activeVersion;
    const primaryRaw = envKey ?? process.env.ENCRYPTION_KEY;
    if (!primaryRaw) {
      throw new InvalidKeyError('Master encryption key missing. Set ENCRYPTION_KEY environment variable.');
    }
    this.keys.set(this.activeVersion, this.parseKey(primaryRaw));

    if (rotationKeys) {
      for (const [verStr, keyStr] of Object.entries(rotationKeys)) {
        const ver = Number(verStr);
        this.keys.set(ver, this.parseKey(keyStr));
      }
    }
  }

  public parseKey(raw: string): Buffer {
    let buf: Buffer;
    const trimmed = raw.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      buf = Buffer.from(trimmed, 'hex');
    } else if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed)) {
      buf = Buffer.from(trimmed, 'base64');
    } else {
      buf = Buffer.from(trimmed, 'utf8');
    }

    if (buf.length !== 32) {
      throw new InvalidKeyError(
        `Master encryption key must be exactly 32 bytes (256 bits). Received ${buf.length} bytes.`
      );
    }
    return buf;
  }

  public getKey(version = this.activeVersion): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new KeyVersionNotFoundError(`Encryption key for version ${version} not found.`);
    }
    return key;
  }

  public getActiveVersion(): number {
    return this.activeVersion;
  }
}
```

#### `crypto-service.ts`
```typescript
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { KeyProvider } from './key-provider.js';
import { DecryptionFailedError } from './errors.js';

export interface EncryptedData {
  keyVersion: number;
  iv: string;         // base64
  authTag: string;    // base64
  ciphertext: string; // base64
}

export interface EncryptionService {
  encrypt(plaintext: string, context?: string): Promise<EncryptedData>;
  decrypt(data: EncryptedData, context?: string): Promise<string>;
  encryptJson<T = unknown>(obj: T, context?: string): Promise<EncryptedData>;
  decryptJson<T = unknown>(data: EncryptedData, context?: string): Promise<T>;
}

export class AesGcmEncryptionService implements EncryptionService {
  constructor(private readonly keyProvider: KeyProvider) {}

  public async encrypt(plaintext: string, context?: string): Promise<EncryptedData> {
    const keyVersion = this.keyProvider.getActiveVersion();
    const key = this.keyProvider.getKey(keyVersion);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    if (context) {
      cipher.setAAD(Buffer.from(context, 'utf8'));
    }

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return {
      keyVersion,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
  }

  public async decrypt(data: EncryptedData, context?: string): Promise<string> {
    if (!data.iv || !data.authTag || !data.ciphertext) {
      throw new DecryptionFailedError('Malformed encrypted data envelope.');
    }

    const key = this.keyProvider.getKey(data.keyVersion);
    const iv = Buffer.from(data.iv, 'base64');
    const authTag = Buffer.from(data.authTag, 'base64');
    const ciphertext = Buffer.from(data.ciphertext, 'base64');

    if (iv.length !== 12) {
      throw new DecryptionFailedError('Invalid IV length. Expected 12 bytes.');
    }
    if (authTag.length !== 16) {
      throw new DecryptionFailedError('Invalid Auth Tag length. Expected 16 bytes.');
    }

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      if (context) {
        decipher.setAAD(Buffer.from(context, 'utf8'));
      }

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);

      return decrypted.toString('utf8');
    } catch {
      throw new DecryptionFailedError('Decryption failed: integrity check or authentication tag mismatch.');
    }
  }

  public async encryptJson<T = unknown>(obj: T, context?: string): Promise<EncryptedData> {
    const serialized = JSON.stringify(obj);
    return this.encrypt(serialized, context);
  }

  public async decryptJson<T = unknown>(data: EncryptedData, context?: string): Promise<T> {
    const raw = await this.decrypt(data, context);
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new DecryptionFailedError('Decrypted payload is not valid JSON.');
    }
  }
}
```

#### `masking.ts`
```typescript
export function maskSecret(secret: string): string {
  if (!secret) return '';
  const len = secret.length;
  if (len <= 4) {
    return '••••••••';
  }
  if (len <= 8) {
    return '••••' + secret.slice(-2);
  }
  return '••••••••' + secret.slice(-4);
}

export interface SanitizedCredentialSummary {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  maskedHint: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function sanitizeCredentialEntity(
  raw: {
    id: string;
    workspaceId: string;
    name: string;
    type: string;
    createdAt: Date | string;
    updatedAt: Date | string;
  },
  sampleSecret?: string
): SanitizedCredentialSummary {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId,
    name: raw.name,
    type: raw.type,
    maskedHint: sampleSecret ? maskSecret(sampleSecret) : '••••••••',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}
```

---

## 4. Feature F03: RBAC & Identity (`packages/auth`)

### 4.1 Specification: Roles, Permissions, and Authorization

#### Role Hierarchy:
- `OWNER` (Tier 4): Complete instance & workspace ownership.
- `ADMIN` (Tier 3): Workspace management, publishing, credentials, members.
- `EDITOR` (Tier 2): Workflow construction, drafting, testing, referencing credentials.
- `VIEWER` (Tier 1): Read-only observability of workflows and execution history.

#### Exhaustive Permission Matrix (18 Permissions):
| Permission ID | Name | OWNER | ADMIN | EDITOR | VIEWER |
|---|---|:---:|:---:|:---:|:---:|
| `workspace:delete` | Delete Workspace | ✅ | ❌ | ❌ | ❌ |
| `workspace:transfer_owner` | Transfer Ownership | ✅ | ❌ | ❌ | ❌ |
| `workspace:update` | Update Workspace Details | ✅ | ✅ | ❌ | ❌ |
| `workspace:manage_members` | Invite/Remove/Change Roles | ✅ | ✅ | ❌ | ❌ |
| `workspace:view` | View Workspace Metadata | ✅ | ✅ | ✅ | ✅ |
| `credential:create` | Create New Credential | ✅ | ✅ | ❌ | ❌ |
| `credential:update` | Update Credential Secrets | ✅ | ✅ | ❌ | ❌ |
| `credential:delete` | Delete Credential | ✅ | ✅ | ❌ | ❌ |
| `credential:reference` | Bind Credential in Workflow | ✅ | ✅ | ✅ | ❌ |
| `credential:view_metadata` | View Credential Summary | ✅ | ✅ | ✅ | ✅ |
| `workflow:create` | Create Workflow Draft | ✅ | ✅ | ✅ | ❌ |
| `workflow:edit` | Modify Nodes, Config, Edges | ✅ | ✅ | ✅ | ❌ |
| `workflow:delete` | Archive / Delete Workflow | ✅ | ✅ | ✅ | ❌ |
| `workflow:publish` | Promote Draft to Published | ✅ | ✅ | ❌ | ❌ |
| `workflow:rollback` | Revert to Prior Snapshot | ✅ | ✅ | ❌ | ❌ |
| `workflow:execute` | Manual Run / Test Execution | ✅ | ✅ | ✅ | ❌ |
| `workflow:cancel` | Cancel Active Run | ✅ | ✅ | ✅ | ❌ |
| `workflow:view` | Inspect Canvas & Nodes | ✅ | ✅ | ✅ | ✅ |
| `execution:view` | View Execution History & Steps| ✅ | ✅ | ✅ | ✅ |
| `audit_log:view` | Inspect Security Audit Trail| ✅ | ✅ | ❌ | ❌ |

*(Note: Plaintext credential decryption is NEVER permitted for ANY role via public API).*

### 4.2 File Structure (`packages/auth/src/rbac/` & `packages/auth/src/password/`)
```
packages/auth/src/
├── rbac/
│   ├── roles.ts           # Role enum and constants
│   ├── permissions.ts     # Permission enum and definitions
│   ├── matrix.ts          # Role-to-permission mapping
│   ├── policy-engine.ts   # hasPermission, assertPermission
│   └── errors.ts          # ForbiddenError, UnauthorizedError
├── password/
│   ├── hasher.ts          # PasswordHasher interface & Bcrypt/Scrypt implementations
│   └── validator.ts       # Password strength rules
├── bootstrap/
│   ├── bootstrap-service.ts # One-time owner initialization & locking
│   └── errors.ts          # AlreadyBootstrappedError
└── session/
    ├── token.ts           # Secure token generation & SHA-256 hash
    └── session-service.ts # Session validation types
```

### 4.3 Concrete Code Implementation

#### `rbac/matrix.ts` & `rbac/policy-engine.ts`
```typescript
import { ForbiddenError } from './errors.js';

export type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export const PERMISSIONS = {
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_TRANSFER_OWNER: 'workspace:transfer_owner',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_MANAGE_MEMBERS: 'workspace:manage_members',
  WORKSPACE_VIEW: 'workspace:view',

  CREDENTIAL_CREATE: 'credential:create',
  CREDENTIAL_UPDATE: 'credential:update',
  CREDENTIAL_DELETE: 'credential:delete',
  CREDENTIAL_REFERENCE: 'credential:reference',
  CREDENTIAL_VIEW_METADATA: 'credential:view_metadata',

  WORKFLOW_CREATE: 'workflow:create',
  WORKFLOW_EDIT: 'workflow:edit',
  WORKFLOW_DELETE: 'workflow:delete',
  WORKFLOW_PUBLISH: 'workflow:publish',
  WORKFLOW_ROLLBACK: 'workflow:rollback',
  WORKFLOW_EXECUTE: 'workflow:execute',
  WORKFLOW_CANCEL: 'workflow:cancel',
  WORKFLOW_VIEW: 'workflow:view',

  EXECUTION_VIEW: 'execution:view',
  AUDIT_LOG_VIEW: 'audit_log:view',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(Object.values(PERMISSIONS)),
  ADMIN: new Set([
    PERMISSIONS.WORKSPACE_UPDATE,
    PERMISSIONS.WORKSPACE_MANAGE_MEMBERS,
    PERMISSIONS.WORKSPACE_VIEW,
    PERMISSIONS.CREDENTIAL_CREATE,
    PERMISSIONS.CREDENTIAL_UPDATE,
    PERMISSIONS.CREDENTIAL_DELETE,
    PERMISSIONS.CREDENTIAL_REFERENCE,
    PERMISSIONS.CREDENTIAL_VIEW_METADATA,
    PERMISSIONS.WORKFLOW_CREATE,
    PERMISSIONS.WORKFLOW_EDIT,
    PERMISSIONS.WORKFLOW_DELETE,
    PERMISSIONS.WORKFLOW_PUBLISH,
    PERMISSIONS.WORKFLOW_ROLLBACK,
    PERMISSIONS.WORKFLOW_EXECUTE,
    PERMISSIONS.WORKFLOW_CANCEL,
    PERMISSIONS.WORKFLOW_VIEW,
    PERMISSIONS.EXECUTION_VIEW,
    PERMISSIONS.AUDIT_LOG_VIEW,
  ]),
  EDITOR: new Set([
    PERMISSIONS.WORKSPACE_VIEW,
    PERMISSIONS.CREDENTIAL_REFERENCE,
    PERMISSIONS.CREDENTIAL_VIEW_METADATA,
    PERMISSIONS.WORKFLOW_CREATE,
    PERMISSIONS.WORKFLOW_EDIT,
    PERMISSIONS.WORKFLOW_DELETE,
    PERMISSIONS.WORKFLOW_EXECUTE,
    PERMISSIONS.WORKFLOW_CANCEL,
    PERMISSIONS.WORKFLOW_VIEW,
    PERMISSIONS.EXECUTION_VIEW,
  ]),
  VIEWER: new Set([
    PERMISSIONS.WORKSPACE_VIEW,
    PERMISSIONS.CREDENTIAL_VIEW_METADATA,
    PERMISSIONS.WORKFLOW_VIEW,
    PERMISSIONS.EXECUTION_VIEW,
  ]),
};

export class RbacPolicyEngine {
  public static hasPermission(role: Role, permission: Permission): boolean {
    const perms = ROLE_PERMISSIONS[role];
    return perms ? perms.has(permission) : false;
  }

  public static assertPermission(role: Role, permission: Permission): void {
    if (!this.hasPermission(role, permission)) {
      throw new ForbiddenError(
        `Role '${role}' is not authorized to perform action requiring permission '${permission}'.`
      );
    }
  }

  public static hasAllPermissions(role: Role, permissions: Permission[]): boolean {
    return permissions.every((p) => this.hasPermission(role, p));
  }

  public static hasAnyPermission(role: Role, permissions: Permission[]): boolean {
    return permissions.some((p) => this.hasPermission(role, p));
  }

  public static getPermissionsForRole(role: Role): ReadonlySet<Permission> {
    return ROLE_PERMISSIONS[role] ?? new Set();
  }
}
```

#### `password/hasher.ts`
```typescript
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

export class BcryptPasswordHasher implements PasswordHasher {
  private readonly saltRounds: number;

  constructor(saltRounds = 12) {
    this.saltRounds = saltRounds;
  }

  public async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  public async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}

/**
 * Built-in Node crypto Scrypt hasher fallback (zero external dependencies).
 */
export class ScryptPasswordHasher implements PasswordHasher {
  public async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  public async verify(password: string, hash: string): Promise<boolean> {
    const parts = hash.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
      return false;
    }
    const [, salt, expectedHashHex] = parts;
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    const keyBuf = derivedKey;
    const expectedBuf = Buffer.from(expectedHashHex, 'hex');
    if (keyBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(keyBuf, expectedBuf);
  }
}
```

#### `bootstrap/bootstrap-service.ts`
```typescript
import { AlreadyBootstrappedError } from './errors.js';
import type { PasswordHasher } from '../password/hasher.js';

export interface BootstrapInput {
  email: string;
  password: string;
  fullName?: string;
  workspaceName?: string;
}

export interface BootstrapResult {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: 'OWNER';
}

export interface BootstrapDatabaseAdapter {
  isSystemBootstrapped(): Promise<boolean>;
  createOwnerAndWorkspace(user: {
    email: string;
    passwordHash: string;
    fullName?: string;
    workspaceName: string;
  }): Promise<BootstrapResult>;
}

export class BootstrapService {
  constructor(
    private readonly db: BootstrapDatabaseAdapter,
    private readonly hasher: PasswordHasher
  ) {}

  public async isBootstrapped(): Promise<boolean> {
    return this.db.isSystemBootstrapped();
  }

  public async bootstrapOwner(input: BootstrapInput): Promise<BootstrapResult> {
    const alreadyBootstrapped = await this.db.isSystemBootstrapped();
    if (alreadyBootstrapped) {
      throw new AlreadyBootstrappedError(
        'Instance has already been bootstrapped. Owner creation is permanently locked.'
      );
    }

    if (!input.email || !input.email.includes('@')) {
      throw new Error('Valid email address is required.');
    }
    if (!input.password || input.password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }

    const passwordHash = await this.hasher.hash(input.password);
    const workspaceName = input.workspaceName?.trim() || 'Primary Workspace';

    return this.db.createOwnerAndWorkspace({
      email: input.email.trim().toLowerCase(),
      passwordHash,
      fullName: input.fullName?.trim(),
      workspaceName,
    });
  }
}
```

---

## 5. Feature F05: Secret Redaction Engine (`packages/observability`)

### 5.1 Redaction Pipeline Layers
1. **Layer 1: Sensitive Key Names**:
   Recursively detects keys matching:
   - Exact: `password`, `secret`, `token`, `key`, `authorization`, `cookie`, `credential`, `private_key`, `api_key`, `access_token`, `refresh_token`, `webhook_secret`.
   - Fuzzy regex: `/^(.*_)?(password|secret|token|api_?key|private_?key|auth|credential|bearer)(_.*)?$/i`.
   - Value replaced with: `"[REDACTED]"`.
2. **Layer 2: Sensitive HTTP Headers**:
   Scans header maps for `authorization`, `proxy-authorization`, `x-api-key`, `cookie`, `set-cookie`, `x-auth-token`.
   - Replaced with `"[REDACTED]"`.
3. **Layer 3: Dynamic Secret Registry (`SecretRegistry`)**:
   During workflow execution, any decrypted credential secret values (strings >= 4 chars) are registered into the execution's `SecretRegistry`. Any string value in inputs, outputs, logs, or error messages containing these values replaces them verbatim with `"[REDACTED_SECRET]"`.
4. **Layer 4: High-Entropy Token Pattern Regex Scrubbers**:
   - Bearer token: `Bearer <token>` -> `Bearer [REDACTED]`
   - Basic auth: `Basic <base64>` -> `Basic [REDACTED]`
   - JWT: `eyJ...` -> `[REDACTED_JWT]`
   - AWS Access Key: `AKIA...` -> `[REDACTED_AWS_KEY]`
   - Slack Token: `xox[baprs]-...` -> `[REDACTED_SLACK_TOKEN]`
   - Telegram Bot Token: `123456789:ABC...` -> `[REDACTED_TELEGRAM_TOKEN]`
   - PEM Private Key: `-----BEGIN ... PRIVATE KEY-----` -> `[REDACTED_PRIVATE_KEY]`
   - Generic API Key: `sk-...` -> `[REDACTED_API_KEY]`
5. **Graph Traversal & Safety**:
   - Circular reference detection using `WeakSet<object>`, replacing cycle with `"[CIRCULAR]"`.
   - Error object sanitization: unpacks `message`, `stack`, and custom properties, redacting secrets inside error stacks.
   - Preserves Dates, Booleans, Numbers, null, undefined.

### 5.2 File Structure (`packages/observability/src/redaction/` & `logger/`)
```
packages/observability/src/
├── redaction/
│   ├── patterns.ts        # Regex detectors for JWT, AWS, Slack, Telegram, PEM
│   ├── sensitive-keys.ts  # Sensitive key set and matcher
│   ├── secret-registry.ts # Dynamic runtime secret tracker
│   ├── redactor.ts        # Deep recursive redaction function
│   └── index.ts           # Redaction exports
├── logger/
│   ├── pino-logger.ts     # Pino wrapper with serializer redaction
│   └── index.ts           # Logger exports
└── index.ts               # Package public API
```

### 5.3 Concrete Code Implementation

#### `redaction/patterns.ts`
```typescript
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
    name: 'OPENAI_API_KEY',
    regex: /\bsk-[a-zA-Z0-9]{20,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    name: 'PEM_PRIVATE_KEY',
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
];
```

#### `redaction/redactor.ts`
```typescript
import { TOKEN_PATTERNS } from './patterns.js';
import { isSensitiveKey } from './sensitive-keys.js';
import type { SecretRegistry } from './secret-registry.js';

export interface RedactionOptions {
  secretRegistry?: SecretRegistry;
  maxDepth?: number;
  maskString?: string;
}

export function redactString(str: string, secretRegistry?: SecretRegistry): string {
  if (!str) return str;
  let result = str;

  // 1. Dynamic exact secrets
  if (secretRegistry) {
    result = secretRegistry.redactString(result);
  }

  // 2. Pattern detectors
  for (const pattern of TOKEN_PATTERNS) {
    result = result.replace(pattern.regex, pattern.replacement);
  }

  return result;
}

export function redact(value: unknown, options: RedactionOptions = {}): unknown {
  const visited = new WeakSet<object>();
  const maxDepth = options.maxDepth ?? 25;
  const mask = options.maskString ?? '[REDACTED]';

  function traverse(current: unknown, depth: number): unknown {
    if (depth > maxDepth) return '[MAX_DEPTH_EXCEEDED]';
    if (current === null || current === undefined) return current;

    const type = typeof current;
    if (type === 'string') {
      return redactString(current as string, options.secretRegistry);
    }
    if (type === 'number' || type === 'boolean' || type === 'bigint') {
      return current;
    }

    if (current instanceof Date) {
      return current;
    }

    if (current instanceof RegExp) {
      return current.toString();
    }

    if (Buffer.isBuffer(current)) {
      return `[BUFFER:${current.length} bytes]`;
    }

    if (current instanceof Error) {
      return {
        name: current.name,
        message: redactString(current.message, options.secretRegistry),
        stack: current.stack ? redactString(current.stack, options.secretRegistry) : undefined,
      };
    }

    if (type === 'object') {
      const obj = current as object;
      if (visited.has(obj)) {
        return '[CIRCULAR]';
      }
      visited.add(obj);

      if (Array.isArray(current)) {
        return current.map((item) => traverse(item, depth + 1));
      }

      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(obj)) {
        if (isSensitiveKey(key)) {
          out[key] = mask;
        } else {
          out[key] = traverse(val, depth + 1);
        }
      }
      return out;
    }

    return current;
  }

  return traverse(value, 0);
}
```

#### `logger/pino-logger.ts`
```typescript
import pino, { type Logger, type LoggerOptions } from 'pino';
import { redact } from '../redaction/redactor.js';

export interface AppLoggerConfig {
  level?: string;
  pretty?: boolean;
}

export function createLogger(config: AppLoggerConfig = {}): Logger {
  const isPretty = config.pretty ?? (process.env.NODE_ENV !== 'production');
  const level = config.level ?? process.env.LOG_LEVEL ?? 'info';

  const options: LoggerOptions = {
    level,
    serializers: {
      req: (req: any) => {
        if (!req) return req;
        const sanitizedHeaders = { ...req.headers };
        for (const h of ['authorization', 'cookie', 'set-cookie', 'proxy-authorization', 'x-api-key']) {
          if (sanitizedHeaders[h]) sanitizedHeaders[h] = '[REDACTED]';
        }
        return {
          method: req.method,
          url: req.url,
          headers: sanitizedHeaders,
          remoteAddress: req.socket?.remoteAddress,
        };
      },
      err: (err: any) => {
        if (!err) return err;
        return redact(err);
      },
    },
    formatters: {
      log: (obj: Record<string, unknown>) => {
        return redact(obj) as Record<string, unknown>;
      },
    },
  };

  if (isPretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      },
    });
  }

  return pino(options);
}
```

---

## 6. Feature F06: SSRF Defense Engine (`packages/shared` / `packages/connector-sdk`)

### 6.1 Defense-in-Depth Specification

1. **Protocol Validation**: Strictly permit `http:` and `https:`. Reject `file:`, `ftp:`, `gopher:`, `data:`, `dict:` with `DisallowedProtocolError`.
2. **Blocked CIDR Ranges**:
   - `0.0.0.0/8`: Broadcast / default host
   - `10.0.0.0/8`: Private network (RFC 1918)
   - `100.64.0.0/10`: Carrier-Grade NAT (RFC 6598)
   - `127.0.0.0/8`: Loopback (RFC 1122)
   - `169.254.0.0/16`: Link-Local & Cloud Metadata (RFC 3927)
   - `172.16.0.0/12`: Private network (RFC 1918)
   - `192.0.0.0/24`, `192.0.2.0/24`: Protocol assignments & Test net
   - `192.168.0.0/16`: Private network (RFC 1918)
   - `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`: Test networks
   - `224.0.0.0/4`: Multicast
   - `240.0.0.0/4`: Reserved
   - `255.255.255.255/32`: Limited broadcast
   - `::/128`: Unspecified IPv6
   - `::1/128`: Loopback IPv6
   - `::ffff:0:0/96`: IPv4-mapped IPv6 (unwrapped and validated as IPv4)
   - `fc00::/7`: Unique Local Address (IPv6 ULA)
   - `fe80::/10`: Link-Local IPv6
   - `ff00::/8`: Multicast IPv6
3. **Obfuscated IP Address Handling**:
   Normalizes decimal/DWORD (`2130706433`), octal (`0177.0.0.1`), hexadecimal (`0x7f000001`), and mixed base into canonical dotted decimal before CIDR checks.
4. **Pre-Request DNS Resolution**:
   Uses `dns.promises.lookup(hostname, { all: true })`. If ANY returned IP address matches the CIDR blocklist, the request is immediately aborted with `SsrfBlockedError`.
5. **Socket-Level IP Pinning (Anti-DNS Rebinding)**:
   A custom `http.Agent` / `https.Agent` overrides the internal `lookup` mechanism. When Node's `net.connect` or `tls.connect` connects, it is forced to use the pre-validated `pinnedIp`. For HTTPS, TLS SNI remains bound to the domain hostname, ensuring cryptographic certificate verification passes without opening a window for rebinding.
6. **Redirect Chain Defense**:
   Redirects (`301`, `302`, `303`, `307`, `308`) are intercepted. The redirect `Location` URL is re-evaluated through the complete SSRF validation pipeline before following the hop (max 5 hops).
7. **Administrator Allowlist**:
   `SSRF_ALLOWLIST` environment variable allows trusted internal destinations (e.g. `localhost:8080`, `192.168.1.50`, `*.corp.internal`).

### 6.2 File Structure (`packages/shared/src/ssrf/`)
```
packages/shared/src/ssrf/
├── cidr.ts             # CIDR parsing and IP range matching (IPv4 & IPv6)
├── ip-normalizer.ts    # Hex, octal, dword, and IPv4-mapped normalization
├── blocklist.ts        # Comprehensive denied ranges & hostname blocklist
├── allowlist.ts        # SSRF_ALLOWLIST parser and evaluator
├── agent-pinning.ts    # Custom http/https Agent with lookup IP pinning
├── safe-client.ts      # SafeHttpClient and safeFetch implementation
├── errors.ts           # SsrfBlockedError, DisallowedProtocolError
└── index.ts            # Public exports
```

### 6.3 Concrete Code Implementation

#### `cidr.ts`
```typescript
import net from 'node:net';

export function ipv4ToInt(ip: string): number {
  const octets = ip.split('.').map(Number);
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

export function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(rangeIp);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function ipv6ToBigInt(ip: string): bigint {
  const parts = ip.split(':');
  let expanded: string[] = [];

  const doubleColonIndex = parts.indexOf('');
  if (doubleColonIndex !== -1) {
    const head = parts.slice(0, doubleColonIndex).filter(Boolean);
    const tail = parts.slice(doubleColonIndex + 1).filter(Boolean);
    const missing = 8 - (head.length + tail.length);
    expanded = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    expanded = parts;
  }

  let result = 0n;
  for (let i = 0; i < 8; i++) {
    const val = BigInt(parseInt(expanded[i] || '0', 16));
    result = (result << 16n) | val;
  }
  return result;
}

export function isIpv6InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  const prefix = BigInt(prefixStr);
  const ipBig = ipv6ToBigInt(ip);
  const rangeBig = ipv6ToBigInt(rangeIp);

  if (prefix === 0n) return true;
  const shift = 128n - prefix;
  return (ipBig >> shift) === (rangeBig >> shift);
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const isV4 = net.isIPv4(ip);
  const isCidrV4 = cidr.includes('.');
  if (isV4 && isCidrV4) {
    return isIpv4InCidr(ip, cidr);
  }
  if (!isV4 && !isCidrV4) {
    return isIpv6InCidr(ip, cidr);
  }
  return false;
}
```

#### `ip-normalizer.ts`
```typescript
import net from 'node:net';

export function normalizeIp(input: string): string {
  let ip = input.trim().toLowerCase();

  // Strip brackets if IPv6
  if (ip.startsWith('[') && ip.endsWith(']')) {
    ip = ip.slice(1, -1);
  }

  // Handle IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (ip.startsWith('::ffff:')) {
    const remainder = ip.slice(7);
    if (net.isIPv4(remainder)) {
      return remainder;
    }
    const hexParts = remainder.split(':');
    if (hexParts.length === 2) {
      const p1 = parseInt(hexParts[0], 16);
      const p2 = parseInt(hexParts[1], 16);
      return `${(p1 >> 8) & 0xff}.${p1 & 0xff}.${(p2 >> 8) & 0xff}.${p2 & 0xff}`;
    }
  }

  // Handle DWORD integer (e.g. 2130706433 -> 127.0.0.1)
  if (/^\d+$/.test(ip)) {
    const num = Number(ip);
    if (num >= 0 && num <= 0xffffffff) {
      return `${(num >>> 24) & 0xff}.${(num >>> 16) & 0xff}.${(num >>> 8) & 0xff}.${num & 0xff}`;
    }
  }

  // Handle Hex IP (e.g. 0x7f000001 -> 127.0.0.1)
  if (/^0x[0-9a-fA-F]{1,8}$/.test(ip)) {
    const num = parseInt(ip.slice(2), 16);
    return `${(num >>> 24) & 0xff}.${(num >>> 16) & 0xff}.${(num >>> 8) & 0xff}.${num & 0xff}`;
  }

  // Handle Octal IP components (e.g. 0177.0.0.1)
  if (/^0[0-7]+(\.0[0-7]+)*$/.test(ip) || ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      const parsed = parts.map((part) => {
        if (part.startsWith('0x') || part.startsWith('0X')) return parseInt(part, 16);
        if (part.startsWith('0') && part.length > 1) return parseInt(part, 8);
        return parseInt(part, 10);
      });
      if (parsed.every((n) => !isNaN(n) && n >= 0 && n <= 255)) {
        return parsed.join('.');
      }
    }
  }

  return ip;
}
```

#### `blocklist.ts`
```typescript
import { isIpInCidr } from './cidr.js';
import { normalizeIp } from './ip-normalizer.js';
import net from 'node:net';

export const DENIED_CIDRS = [
  // IPv4 Denied Ranges
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',

  // IPv6 Denied Ranges
  '::/128',
  '::1/128',
  '100::/64',
  '2001:db8::/32',
  '2002::/16',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];

export const DENIED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'instance-data',
]);

export function isBlockedIp(rawIp: string): boolean {
  const normalized = normalizeIp(rawIp);
  const isValid = net.isIP(normalized) !== 0;
  if (!isValid) return true; // Fail closed if unrecognized

  for (const cidr of DENIED_CIDRS) {
    if (isIpInCidr(normalized, cidr)) {
      return true;
    }
  }
  return false;
}

export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (DENIED_HOSTNAMES.has(lower)) return true;
  if (lower.endsWith('.localhost') || lower.endsWith('.local')) return true;
  return false;
}
```

#### `safe-client.ts`
```typescript
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { isBlockedIp, isBlockedHostname } from './blocklist.js';
import { isAllowlisted } from './allowlist.js';
import { SsrfBlockedError, DisallowedProtocolError } from './errors.js';

export interface SafeRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
  maxRedirects?: number;
  allowlist?: string[];
}

export interface SafeResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: string;
  json<T = unknown>(): T;
}

export class SafeHttpClient {
  private readonly defaultTimeout: number;

  constructor(timeoutMs = 10000) {
    this.defaultTimeout = timeoutMs;
  }

  public async fetch(urlStr: string, options: SafeRequestOptions = {}): Promise<SafeResponse> {
    return this.executeWithRedirects(urlStr, options, 0);
  }

  private async executeWithRedirects(
    urlStr: string,
    options: SafeRequestOptions,
    redirectHop: number
  ): Promise<SafeResponse> {
    const maxRedirects = options.maxRedirects ?? 5;
    if (redirectHop > maxRedirects) {
      throw new Error(`Max redirects (${maxRedirects}) exceeded.`);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlStr);
    } catch {
      throw new Error(`Invalid URL: ${urlStr}`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new DisallowedProtocolError(
        `Disallowed protocol: ${parsedUrl.protocol}. Only http: and https: are permitted.`
      );
    }

    const hostname = parsedUrl.hostname;
    const port = parsedUrl.port ? Number(parsedUrl.port) : parsedUrl.protocol === 'https:' ? 443 : 80;

    // Check allowlist
    const allowlisted = isAllowlisted(hostname, undefined, port, options.allowlist);
    let pinnedIp: string;

    if (!allowlisted) {
      if (isBlockedHostname(hostname)) {
        throw new SsrfBlockedError(`Access to hostname '${hostname}' is blocked by SSRF policy.`);
      }

      // Check if hostname is raw IP
      if (net.isIP(hostname)) {
        if (isBlockedIp(hostname)) {
          throw new SsrfBlockedError(`Access to IP address '${hostname}' is blocked by SSRF policy.`);
        }
        pinnedIp = hostname;
      } else {
        // Resolve DNS and validate ALL addresses
        let records;
        try {
          records = await dns.lookup(hostname, { all: true });
        } catch (err: any) {
          throw new Error(`DNS resolution failed for hostname '${hostname}': ${err.message}`);
        }

        if (!records || records.length === 0) {
          throw new Error(`No IP addresses found for hostname '${hostname}'.`);
        }

        for (const record of records) {
          if (isBlockedIp(record.address)) {
            throw new SsrfBlockedError(
              `Hostname '${hostname}' resolved to blocked IP '${record.address}'. Blocked by SSRF policy.`
            );
          }
        }
        pinnedIp = records[0].address;
      }
    } else {
      // In allowlist: resolve DNS without blocking
      const records = await dns.lookup(hostname);
      pinnedIp = records.address;
    }

    // Connect with socket IP pinning
    const isHttps = parsedUrl.protocol === 'https:';
    const agentOptions = {
      lookup: (_host: string, _opts: unknown, callback: (err: any, address: string, family: number) => void) => {
        callback(null, pinnedIp, pinnedIp.includes(':') ? 6 : 4);
      },
    };

    const agent = isHttps ? new https.Agent(agentOptions) : new http.Agent(agentOptions);

    const client = isHttps ? https : http;
    const reqOptions: https.RequestOptions = {
      method: options.method ?? 'GET',
      hostname, // Keeps SNI valid for HTTPS
      port,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        Host: parsedUrl.host,
        ...(options.headers ?? {}),
      },
      agent,
      timeout: options.timeoutMs ?? this.defaultTimeout,
    };

    return new Promise<SafeResponse>((resolve, reject) => {
      const req = client.request(reqOptions, async (res) => {
        const statusCode = res.statusCode ?? 200;

        // Redirect handling (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
          agent.destroy();
          try {
            const redirectTarget = new URL(res.headers.location, parsedUrl).toString();
            const redirectRes = await this.executeWithRedirects(redirectTarget, options, redirectHop + 1);
            resolve(redirectRes);
          } catch (err) {
            reject(err);
          }
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          agent.destroy();
          const raw = Buffer.concat(chunks).toString('utf8');
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              responseHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
            }
          }

          resolve({
            status: statusCode,
            statusText: res.statusMessage ?? '',
            headers: responseHeaders,
            data: raw,
            json<T = unknown>(): T {
              return JSON.parse(raw) as T;
            },
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        agent.destroy();
        reject(new Error(`Request timed out after ${options.timeoutMs ?? this.defaultTimeout}ms`));
      });

      req.on('error', (err) => {
        agent.destroy();
        reject(err);
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }
}
```

---

## 7. Comprehensive Unit & Adversarial Test Specifications

### 7.1 F04 Tests: Envelope Encryption (`packages/auth/test/encryption.test.ts`)
- `test('encrypt and decrypt roundtrip')`: Verifies string encrypted returns valid `EncryptedData` and decrypts identically.
- `test('encryptJson and decryptJson roundtrip')`: Verifies complex nested JSON structures decrypt with type fidelity.
- `test('IV is distinct per encryption call')`: Encrypts the same plaintext 100 times; verifies all IVs and ciphertexts are completely unique.
- `test('tampered ciphertext fails with DecryptionFailedError')`: Modifies 1 byte in `ciphertext`; verifies decryption rejects.
- `test('tampered authTag fails with DecryptionFailedError')`: Modifies 1 byte in `authTag`; verifies authentication tag mismatch rejection.
- `test('tampered IV fails with DecryptionFailedError')`: Modifies IV; verifies decryption failure.
- `test('context / AAD binding verification')`: Encrypts with context `"workspace:123"`; decrypting with `"workspace:456"` fails.
- `test('key rotation support')`: Encrypts with key version 1; loads key provider with version 1 and version 2; decrypts version 1 payload successfully; encrypts new payload with active version 2.
- `test('unknown key version throws KeyVersionNotFoundError')`.
- `test('invalid key length throws InvalidKeyError')`: Tests 16-byte, 31-byte, 65-char keys.
- `test('maskSecret produces correct redacted hints')`: Tests short secrets (<=4 chars -> `••••••••`), medium secrets, and long secrets (`••••••••4f2a`).

### 7.2 F03 Tests: RBAC & Identity (`packages/auth/test/rbac.test.ts` & `bootstrap.test.ts`)
- `test('OWNER role has all 18 permissions')`.
- `test('ADMIN has publication and member management, but cannot delete or transfer workspace')`.
- `test('EDITOR can create drafts, reference credentials, execute workflows, but CANNOT publish or manage members')`.
- `test('VIEWER is strictly read-only')`.
- `test('assertPermission throws ForbiddenError on unauthorized action')`.
- `test('PasswordHasher hashes and verifies with scrypt and bcrypt')`.
- `test('timingSafeEqual verification prevents timing attacks')`.
- `test('One-time bootstrap succeeds on fresh system')`.
- `test('One-time bootstrap rejects on subsequent call with AlreadyBootstrappedError')`.

### 7.3 F05 Tests: Secret Redaction (`packages/observability/test/redaction.test.ts`)
- `test('redacts sensitive keys in deeply nested objects')`: Tests `{ config: { auth: { password: "123", apiKey: "abc" } } }`.
- `test('redacts case-insensitive and fuzzy keys')`: `secret_token`, `PRIVATE-KEY`, `Api_Key`.
- `test('scrubs Bearer tokens from authorization header and arbitrary strings')`.
- `test('scrubs JWT tokens matching regex')`.
- `test('scrubs Telegram bot tokens')`: `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ123456789`.
- `test('scrubs AWS keys, Slack tokens, OpenAI keys, PEM private keys')`.
- `test('exact secret registration scrubs runtime credential values wherever they appear')`.
- `test('handles circular references gracefully without crashing')`: Verifies `[CIRCULAR]` insertion.
- `test('redacts Error objects including error stack traces')`.
- `test('Pino logger formatters automatically redact log payloads and req headers')`.

### 7.4 F06 Tests: SSRF Defense Engine (`packages/shared/test/ssrf.test.ts`)
- `test('blocks direct loopback IPs')`: `127.0.0.1`, `127.0.1.1`, `::1`.
- `test('blocks cloud metadata IP')`: `169.254.169.254` and `metadata.google.internal`.
- `test('blocks RFC 1918 private ranges')`: `10.0.0.1`, `172.16.0.1`, `172.31.255.254`, `192.168.1.1`.
- `test('blocks alternate IP notations')`:
  - Octal: `0177.0.0.1`
  - Hex: `0x7f000001`
  - DWORD / Decimal: `2130706433`
  - Mixed base: `0x7f.0.0.1`
- `test('blocks IPv4-mapped IPv6 loopback and private')`: `::ffff:127.0.0.1`, `::ffff:169.254.169.254`.
- `test('blocks non-HTTP protocols')`: `file:///etc/passwd`, `gopher://localhost:6379/`, `ftp://`.
- `test('defeats DNS rebinding via socket IP pinning')`: Simulates DNS query returning public IP then re-query returning private IP; verifies agent pins connection to initial verified IP.
- `test('intercepts 302 redirect to loopback and aborts')`: Server returns `302 Location: http://127.0.0.1/admin`; safe client aborts with `SsrfBlockedError`.
- `test('permits legitimate external URLs')`: Mock HTTP server returning public address succeeds.
- `test('respects SSRF_ALLOWLIST for admin-sanctioned internal endpoints')`: Tests `localhost:8080` or `192.168.1.50` with allowlist configured.

---

## 8. Implementation Sequence for Worker

```
[Phase 1: packages/auth]
  ├── Step 1.1: Create packages/auth/package.json & tsconfig.json
  ├── Step 1.2: Implement src/encryption (KeyProvider, AesGcmEncryptionService, masking, errors)
  ├── Step 1.3: Implement src/rbac (roles, permissions, matrix, policy engine, errors)
  ├── Step 1.4: Implement src/password (Bcrypt & Scrypt hashers)
  ├── Step 1.5: Implement src/bootstrap (BootstrapService & errors)
  ├── Step 1.6: Write packages/auth tests & verify passing with `pnpm test`
  └── Step 1.7: Run build & typecheck

[Phase 2: packages/observability]
  ├── Step 2.1: Create packages/observability/package.json & tsconfig.json
  ├── Step 2.2: Implement src/redaction (patterns, sensitive-keys, secret-registry, redactor)
  ├── Step 2.3: Implement src/logger (Pino wrapper with auto-redacting serializers & formatters)
  ├── Step 2.4: Write packages/observability tests & verify passing with `pnpm test`
  └── Step 2.5: Run build & typecheck

[Phase 3: packages/shared & SSRF Engine]
  ├── Step 3.1: Create packages/shared/src/ssrf/ (cidr, ip-normalizer, blocklist, allowlist, agent-pinning, safe-client, errors)
  ├── Step 3.2: Export SafeHttpClient from packages/shared/src/index.ts
  ├── Step 3.3: Write packages/shared/test/ssrf.test.ts (SSRF test suite)
  └── Step 3.4: Verify passing with `pnpm test`, build & typecheck
```
