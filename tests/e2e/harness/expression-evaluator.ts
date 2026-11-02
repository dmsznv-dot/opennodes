/**
 * LocalFlow E2E Test Suite - Safe AST Expression Evaluator
 * Evaluates template expressions {{ ... }} deterministically without eval() or Function().
 * Enforces strict sandbox isolation: prototype pollution defense, no access to Node globals.
 */

export interface EvaluationScope {
  $trigger?: unknown;
  $nodes?: Record<string, { input?: unknown; output?: unknown }>;
  $env?: Record<string, string>;
  [key: string]: unknown;
}

export class ExpressionEvaluationError extends Error {
  public code = 'ERR_EXPRESSION_EVALUATION';
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionEvaluationError';
  }
}

export class SafeExpressionEvaluator {
  private forbiddenTokens = ['__proto__', 'constructor', 'prototype', 'process', 'global', 'window', 'require', 'import'];

  evaluate(expression: string, scope: EvaluationScope): unknown {
    if (!expression || typeof expression !== 'string') {
      return expression;
    }

    // Check if the entire string is a single expression {{ expr }}
    const singleMatch = expression.trim().match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    if (singleMatch) {
      return this.evaluateExpressionString(singleMatch[1], scope);
    }

    // Otherwise, perform string template interpolation
    return expression.replace(/\{\{\s*(.+?)\s*\}\}/g, (_, innerExpr) => {
      const val = this.evaluateExpressionString(innerExpr, scope);
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });
  }

  evaluateExpressionString(expr: string, scope: EvaluationScope): unknown {
    const trimmed = expr.trim();

    // Security check for forbidden property identifiers
    for (const token of this.forbiddenTokens) {
      const regex = new RegExp(`\\b${token}\\b`);
      if (regex.test(trimmed)) {
        throw new ExpressionEvaluationError(`Access to forbidden identifier "${token}" is blocked`);
      }
    }

    // Ternary operator: cond ? a : b
    const ternaryMatch = trimmed.match(/^(.+?)\s*\?\s*(.+?)\s*:\s*(.+)$/);
    if (ternaryMatch) {
      const conditionVal = this.evaluateExpressionString(ternaryMatch[1], scope);
      return conditionVal
        ? this.evaluateExpressionString(ternaryMatch[2], scope)
        : this.evaluateExpressionString(ternaryMatch[3], scope);
    }

    // Logical OR: a || b
    if (trimmed.includes('||')) {
      const parts = trimmed.split('||');
      for (const part of parts) {
        const val = this.evaluateExpressionString(part, scope);
        if (val) return val;
      }
      return false;
    }

    // Logical AND: a && b
    if (trimmed.includes('&&')) {
      const parts = trimmed.split('&&');
      let lastVal: unknown = true;
      for (const part of parts) {
        lastVal = this.evaluateExpressionString(part, scope);
        if (!lastVal) return false;
      }
      return lastVal;
    }

    // Comparisons
    const compRegex = /^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/;
    const compMatch = trimmed.match(compRegex);
    if (compMatch) {
      const left = this.evaluateExpressionString(compMatch[1], scope);
      const op = compMatch[2];
      const right = this.evaluateExpressionString(compMatch[3], scope);

      switch (op) {
        case '===': return left === right;
        case '!==': return left !== right;
        case '==': return left == right; // eslint-disable-line eqeqeq
        case '!=': return left != right; // eslint-disable-line eqeqeq
        case '>': return (left as number) > (right as number);
        case '<': return (left as number) < (right as number);
        case '>=': return (left as number) >= (right as number);
        case '<=': return (left as number) <= (right as number);
      }
    }

    // Literals
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed === 'null') return null;
    if (trimmed === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

    // Quoted strings
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    // Path resolution: e.g. $trigger.body.user.id or $nodes.http_1.output.data[0]
    return this.resolvePath(trimmed, scope);
  }

  private resolvePath(pathStr: string, scope: EvaluationScope): unknown {
    // Normalise array indexing from a[0] to a.0
    const normalized = pathStr.replace(/\[(\w+)\]/g, '.$1').replace(/\?\. /g, '.');
    const segments = normalized.split('.').filter(Boolean);

    let current: unknown = scope;
    for (const segment of segments) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== 'object' && typeof current !== 'string' && typeof current !== 'number') {
        return undefined;
      }

      // Block prototype pollution
      if (this.forbiddenTokens.includes(segment)) {
        throw new ExpressionEvaluationError(`Access to property "${segment}" is blocked`);
      }

      // Safe method call support: e.g. startsWith("a"), includes("foo")
      const methodMatch = segment.match(/^([a-zA-Z0-9_$]+)\((.*)\)$/);
      if (methodMatch) {
        const methodName = methodMatch[1];
        if (this.forbiddenTokens.includes(methodName)) {
          throw new ExpressionEvaluationError(`Access to method "${methodName}" is blocked`);
        }
        const argRaw = methodMatch[2].trim();
        let arg: unknown = argRaw;
        if ((argRaw.startsWith('"') && argRaw.endsWith('"')) || (argRaw.startsWith("'") && argRaw.endsWith("'"))) {
          arg = argRaw.slice(1, -1);
        } else if (/^\d+$/.test(argRaw)) {
          arg = Number(argRaw);
        }
        const fn = (current as any)[methodName];
        if (typeof fn === 'function') {
          current = fn.call(current, arg);
          continue;
        }
      }

      const rec = current as Record<string, unknown>;
      current = rec[segment];
    }

    return current;
  }
}

export const expressionEvaluator = new SafeExpressionEvaluator();
