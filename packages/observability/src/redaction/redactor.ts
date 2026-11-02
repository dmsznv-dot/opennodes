import { TOKEN_PATTERNS } from './patterns.js';
import { isSensitiveKey, isSensitiveContainerKey } from './sensitive-keys.js';
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
        stack: current.stack
          ? redactString(current.stack, options.secretRegistry)
          : undefined,
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
        const isObjectVal = val !== null && typeof val === 'object' && !Buffer.isBuffer(val);
        if (isSensitiveKey(key)) {
          if (isObjectVal && isSensitiveContainerKey(key)) {
            // Container key like auth: { ... }, traverse into children
            out[key] = traverse(val, depth + 1);
          } else {
            out[key] = mask;
          }
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
