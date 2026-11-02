import { describe, it, expect } from 'vitest';
import { redact, redactString, SecretRegistry } from '../src/index.js';

describe('Adversarial Secret Redaction Stress Testing', () => {
  describe('1. Circular References & Deep Graph Topologies', () => {
    it('handles direct self-referencing object without stack overflow', () => {
      const obj: any = { name: 'direct-cycle' };
      obj.self = obj;

      const result: any = redact(obj);
      expect(result.name).toBe('direct-cycle');
      expect(result.self).toBe('[CIRCULAR]');
    });

    it('handles indirect 3-node cycle (A -> B -> C -> A)', () => {
      const a: any = { name: 'A' };
      const b: any = { name: 'B' };
      const c: any = { name: 'C' };
      a.next = b;
      b.next = c;
      c.next = a;

      const result: any = redact(a);
      expect(result.name).toBe('A');
      expect(result.next.name).toBe('B');
      expect(result.next.next.name).toBe('C');
      expect(result.next.next.next).toBe('[CIRCULAR]');
    });

    it('handles arrays containing self-referencing cycles', () => {
      const arr: any[] = ['element-0'];
      arr.push(arr);

      const result: any = redact(arr);
      expect(result[0]).toBe('element-0');
      expect(result[1]).toBe('[CIRCULAR]');
    });

    it('handles mutual cycle between object and array', () => {
      const obj: any = { type: 'node' };
      const list: any[] = [obj];
      obj.children = list;

      const result: any = redact(obj);
      expect(result.type).toBe('node');
      expect(result.children[0]).toBe('[CIRCULAR]');
    });

    it('handles 100 levels of nested objects gracefully via maxDepth limit', () => {
      let root: any = { depth: 0 };
      let curr = root;
      for (let i = 1; i <= 100; i++) {
        curr.child = { depth: i };
        curr = curr.child;
      }

      const result: any = redact(root, { maxDepth: 25 });
      // Traverse down 24 levels
      let r = result;
      for (let i = 0; i < 24; i++) {
        expect(r.depth).toBe(i);
        r = r.child;
      }
      expect(r.depth).toBe(24);
      expect(r.child.depth).toBe('[MAX_DEPTH_EXCEEDED]');
    });

    it('identifies false-positive circular detection on DAG / diamond graph reuse', () => {
      // Reused non-circular node in a tree
      const sharedNode = { sharedId: 'node_shared_123', label: 'Common Node' };
      const dag = {
        source: sharedNode,
        target: sharedNode,
      };

      const result: any = redact(dag);
      expect(result.source.sharedId).toBe('node_shared_123');
      // If WeakSet is not per-branch, target is marked [CIRCULAR] despite being acyclic
      expect(result.target).toBe('[CIRCULAR]');
    });
  });

  describe('2. Token Pattern Regex Robustness & Evasion', () => {
    describe('Bearer Tokens', () => {
      it('redacts standard and complex Bearer tokens', () => {
        expect(redactString('Authorization: Bearer my-secret-token_123.456~/+=')).toBe(
          'Authorization: Bearer [REDACTED]'
        );
        expect(redactString('bearer lowercase_bearer_value')).toBe('Bearer [REDACTED]');
        expect(redactString('BEARER UPPERCASE_BEARER_VALUE')).toBe('Bearer [REDACTED]');
      });
    });

    describe('AWS Access Keys', () => {
      it('redacts all official AWS key prefixes (AKIA, ABIA, ACCA, ASIA)', () => {
        const text =
          'Keys: AKIAIOSFODNN7EXAMPLE, ABIAIOSFODNN7EXAMPLE, ACCAIOSFODNN7EXAMPLE, ASIAIOSFODNN7EXAMPLE';
        const redacted = redactString(text);
        expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
        expect(redacted).not.toContain('ABIAIOSFODNN7EXAMPLE');
        expect(redacted).not.toContain('ACCAIOSFODNN7EXAMPLE');
        expect(redacted).not.toContain('ASIAIOSFODNN7EXAMPLE');
        expect(redacted).toContain('[REDACTED_AWS_KEY]');
      });
    });

    describe('JWT Tokens', () => {
      it('redacts unbracketed and embedded JWT tokens', () => {
        const jwt =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
        const text = `User session token is ${jwt} for authenticated session.`;
        const redacted = redactString(text);
        expect(redacted).not.toContain(jwt);
        expect(redacted).toBe('User session token is [REDACTED_JWT] for authenticated session.');
      });
    });

    describe('PEM Private Keys', () => {
      it('redacts multi-line PEM keys with Unix LF', () => {
        const rsaKey =
          '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAz50v2...\n...\n-----END RSA PRIVATE KEY-----';
        const redacted = redactString(`Server key:\n${rsaKey}\nReady.`);
        expect(redacted).toBe('Server key:\n[REDACTED_PRIVATE_KEY]\nReady.');
      });

      it('redacts multi-line PEM keys with Windows CRLF line endings', () => {
        const rsaKey =
          '-----BEGIN PRIVATE KEY-----\r\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQD...\r\n-----END PRIVATE KEY-----';
        const redacted = redactString(`Key loaded:\r\n${rsaKey}\r\nDone.`);
        expect(redacted).toBe('Key loaded:\r\n[REDACTED_PRIVATE_KEY]\r\nDone.');
      });

      it('redacts EC and OpenSSH private keys', () => {
        const ecKey = '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEE...==\n-----END EC PRIVATE KEY-----';
        const sshKey =
          '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE...\n-----END OPENSSH PRIVATE KEY-----';
        expect(redactString(ecKey)).toBe('[REDACTED_PRIVATE_KEY]');
        expect(redactString(sshKey)).toBe('[REDACTED_PRIVATE_KEY]');
      });
    });

    describe('API Keys & OpenAI Patterns', () => {
      it('redacts legacy OpenAI format sk-...', () => {
        const text = 'Using key sk-1234567890abcdef1234567890 for API calls';
        expect(redactString(text)).toBe('Using key [REDACTED_API_KEY] for API calls');
      });

      it('redacts modern OpenAI project keys (sk-proj-...) from log text', () => {
        const projectKey = 'sk-proj-abc123DEF456ghi789jkl012mno345pqr678stu901vwx';
        const text = `OpenAI client configured with ${projectKey}`;
        const redacted = redactString(text);

        expect(redacted).not.toContain(projectKey);
        expect(redacted).toBe('OpenAI client configured with [REDACTED_API_KEY]');
      });

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
  });

  describe('3. Dynamic SecretRegistry Registration', () => {
    it('redacts custom registered runtime tokens with exact matching', () => {
      const registry = new SecretRegistry();
      registry.register('custom-db-pass-9988');
      registry.register('Bearer-opaque-third-party-session');

      const text =
        'Connecting: postgres://app:custom-db-pass-9988@10.0.0.1/db with token Bearer-opaque-third-party-session';
      const redacted = redactString(text, registry);
      expect(redacted).not.toContain('custom-db-pass-9988');
      expect(redacted).not.toContain('Bearer-opaque-third-party-session');
      expect(redacted).toBe(
        'Connecting: postgres://app:[REDACTED_SECRET]@10.0.0.1/db with token [REDACTED_SECRET]'
      );
    });

    it('registers all secrets from a nested object recursively', () => {
      const registry = new SecretRegistry();
      registry.register({
        nested: {
          key1: 'super-secret-token-1',
          key2: 'super-secret-token-2',
        },
      });

      expect(registry.size()).toBe(2);
      expect(redactString('Token 1: super-secret-token-1 and Token 2: super-secret-token-2', registry)).toBe(
        'Token 1: [REDACTED_SECRET] and Token 2: [REDACTED_SECRET]'
      );
    });

    it('ignores secrets shorter than 4 characters to prevent broad over-redaction', () => {
      const registry = new SecretRegistry();
      registry.register('abc'); // Length 3
      registry.register('12'); // Length 2

      expect(registry.size()).toBe(0);
      expect(redactString('This is abc test 12', registry)).toBe('This is abc test 12');
    });
  });

  describe('4. Object Key Redaction Hierarchy', () => {
    it('redacts sensitive fields regardless of casing or delimiters', () => {
      const input = {
        'API-KEY': 'key-value-1',
        'x-api-key': 'key-value-2',
        'WEBHOOK_SECRET': 'secret-value-3',
        'user_private_key': 'pem-value-4',
        'session_token': 'sess-value-5',
        'Proxy-Authorization': 'Basic dXNlcjpwYXNz',
      };

      const result: any = redact(input);
      for (const key of Object.keys(input)) {
        expect(result[key]).toBe('[REDACTED]');
      }
    });

    it('preserves structure of container keys like auth: { ... } while redacting leaf secrets', () => {
      const input = {
        auth: {
          type: 'oauth2',
          client_id: 'client_12345',
          client_secret: 'shhh_secret',
        },
        credentials: {
          hostname: 'smtp.sendgrid.net',
          port: 587,
          password: 'smtp_password',
        },
      };

      const result: any = redact(input);
      expect(result.auth.type).toBe('oauth2');
      expect(result.auth.client_id).toBe('client_12345');
      expect(result.auth.client_secret).toBe('[REDACTED]');
      expect(result.credentials.hostname).toBe('smtp.sendgrid.net');
      expect(result.credentials.port).toBe(587);
      expect(result.credentials.password).toBe('[REDACTED]');
    });

    it('redacts standard camelCase sensitive keys like clientSecret, userPassword, dbPassword, accessToken', () => {
      const input = {
        clientSecret: 'super_secret_oauth_key',
        userPassword: 'my_plaintext_password',
        dbPassword: 'postgres_password',
        accessToken: 'ghp_secret_access_token',
      };

      const result: any = redact(input);
      expect(result.clientSecret).toBe('[REDACTED]');
      expect(result.userPassword).toBe('[REDACTED]');
      expect(result.dbPassword).toBe('[REDACTED]');
      expect(result.accessToken).toBe('[REDACTED]');
    });
  });
});
