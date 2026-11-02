import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { ExpressionEvaluationError } from './errors.js';
import { isForbiddenIdentifier, isSafeMethod } from './builtins.js';
import type {
  ASTNode,
  EvaluationScope,
  IExpressionEvaluator,
  MemberExpressionNode,
} from './types.js';

const SINGLE_EXPRESSION_RE = /^\{\{\s*([\s\S]+?)\s*\}\}$/;
const TEMPLATE_EXPRESSION_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g;

function normalizeScope(scope: EvaluationScope): Record<string, unknown> {
  const triggerVal = scope.$trigger !== undefined ? scope.$trigger : scope.trigger;
  const nodesVal =
    scope.$nodes !== undefined
      ? scope.$nodes
      : scope.steps !== undefined
        ? scope.steps
        : scope.nodes ?? {};
  const envVal = scope.$env !== undefined ? scope.$env : scope.env ?? {};
  const itemVal = scope.$item !== undefined ? scope.$item : scope.item;
  const indexVal = scope.$index !== undefined ? scope.$index : scope.index;

  return {
    ...scope,
    $trigger: triggerVal,
    trigger: triggerVal,
    $nodes: nodesVal,
    steps: nodesVal,
    nodes: nodesVal,
    $env: envVal,
    env: envVal,
    $item: itemVal,
    item: itemVal,
    $index: indexVal,
    index: indexVal,
  };
}

export class ExpressionEvaluator implements IExpressionEvaluator {
  parse(expressionString: string): ASTNode {
    const trimmed = expressionString.trim();
    const singleMatch = SINGLE_EXPRESSION_RE.exec(trimmed);
    const rawExpr = singleMatch ? singleMatch[1]! : trimmed;
    const lexer = new Lexer(rawExpr);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parse();
  }

  evaluate(expression: string, scope: EvaluationScope = {}): unknown {
    if (typeof expression !== 'string') {
      return expression;
    }

    if (!expression.includes('{{')) {
      return expression;
    }

    const normalized = normalizeScope(scope);

    // Check if the entire string is a single {{ expr }} (with no other "{{")
    const trimmed = expression.trim();
    if (
      trimmed.startsWith('{{') &&
      trimmed.endsWith('}}') &&
      trimmed.indexOf('}}') === trimmed.length - 2
    ) {
      const inner = trimmed.slice(2, -2).trim();
      const ast = this.parseRaw(inner);
      return this.evalNode(ast, normalized);
    }

    // Mixed template interpolation: replace each {{ ... }} with stringified value
    return expression.replace(TEMPLATE_EXPRESSION_RE, (_full, innerExpr: string) => {
      const ast = this.parseRaw(innerExpr.trim());
      const val = this.evalNode(ast, normalized);
      if (val === null || val === undefined) {
        return '';
      }
      if (typeof val === 'object') {
        return JSON.stringify(val);
      }
      return String(val);
    });
  }

  evaluateObject<T>(target: T, scope: EvaluationScope = {}): T {
    if (typeof target === 'string') {
      return this.evaluate(target, scope) as unknown as T;
    }
    if (Array.isArray(target)) {
      return target.map((item) => this.evaluateObject(item, scope)) as unknown as T;
    }
    if (target !== null && typeof target === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(target as Record<string, unknown>)) {
        out[k] = this.evaluateObject(v, scope);
      }
      return out as T;
    }
    return target;
  }

  private parseRaw(rawExpr: string): ASTNode {
    if (!rawExpr) {
      return { type: 'Literal', value: undefined, raw: 'undefined' };
    }
    const lexer = new Lexer(rawExpr);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    return parser.parse();
  }

  private evalNode(node: ASTNode, scope: Record<string, unknown>): unknown {
    switch (node.type) {
      case 'Literal':
        return node.value;

      case 'Identifier': {
        if (isForbiddenIdentifier(node.name)) {
          throw new ExpressionEvaluationError(
            `Access to forbidden identifier "${node.name}" is blocked`
          );
        }
        if (Object.prototype.hasOwnProperty.call(scope, node.name)) {
          return scope[node.name];
        }
        return undefined;
      }

      case 'ArrayExpression':
        return node.elements.map((el) => this.evalNode(el, scope));

      case 'MemberExpression':
        return this.evalMember(node, scope).value;

      case 'CallExpression': {
        if (node.callee.type === 'Identifier') {
          throw new ExpressionEvaluationError(
            `Global function call "${node.callee.name}()" is blocked`
          );
        }
        const { objectVal, propName } = this.evalMemberTarget(node.callee, scope);
        if (objectVal === null || objectVal === undefined) {
          if (node.callee.optional) {
            return undefined;
          }
          return undefined;
        }
        const methodName = String(propName);
        if (!isSafeMethod(objectVal, methodName)) {
          throw new ExpressionEvaluationError(
            `Method "${methodName}" is not whitelisted for safe execution`
          );
        }
        const fn = (objectVal as Record<string, unknown>)[methodName];
        if (typeof fn !== 'function') {
          throw new ExpressionEvaluationError(
            `Property "${methodName}" is not a callable method`
          );
        }
        const evaluatedArgs = node.arguments.map((arg) => this.evalNode(arg, scope));
        return (fn as (...args: unknown[]) => unknown).apply(objectVal, evaluatedArgs);
      }

      case 'UnaryExpression': {
        const argVal = this.evalNode(node.argument, scope);
        switch (node.operator) {
          case '!':
            return !argVal;
          case '-':
            return -Number(argVal);
          case '+':
            return +Number(argVal);
        }
        break;
      }

      case 'BinaryExpression': {
        const left = this.evalNode(node.left, scope);
        const right = this.evalNode(node.right, scope);
        switch (node.operator) {
          case '+':
            if (typeof left === 'string' || typeof right === 'string') {
              return String(left ?? '') + String(right ?? '');
            }
            return Number(left) + Number(right);
          case '-':
            return Number(left) - Number(right);
          case '*':
            return Number(left) * Number(right);
          case '/':
            return Number(left) / Number(right);
          case '%':
            return Number(left) % Number(right);
          case '===':
            return left === right;
          case '!==':
            return left !== right;
          case '==':
            return left == right;
          case '!=':
            return left != right;
          case '<':
            return (left as number) < (right as number);
          case '<=':
            return (left as number) <= (right as number);
          case '>':
            return (left as number) > (right as number);
          case '>=':
            return (left as number) >= (right as number);
        }
        break;
      }

      case 'LogicalExpression': {
        const left = this.evalNode(node.left, scope);
        switch (node.operator) {
          case '&&':
            return left ? this.evalNode(node.right, scope) : left;
          case '||':
            return left ? left : this.evalNode(node.right, scope);
          case '??':
            return left !== null && left !== undefined
              ? left
              : this.evalNode(node.right, scope);
        }
        break;
      }

      case 'ConditionalExpression': {
        const test = this.evalNode(node.test, scope);
        return test
          ? this.evalNode(node.consequent, scope)
          : this.evalNode(node.alternate, scope);
      }
    }
    return undefined;
  }

  private evalMemberTarget(
    node: MemberExpressionNode,
    scope: Record<string, unknown>
  ): { objectVal: unknown; propName: string | number } {
    const objectVal = this.evalNode(node.object, scope);
    let propKey: unknown;
    if (node.computed) {
      propKey = this.evalNode(node.property, scope);
    } else if (node.property.type === 'Identifier') {
      propKey = node.property.name;
    } else if (node.property.type === 'Literal') {
      propKey = node.property.value;
    }

    if (typeof propKey !== 'string' && typeof propKey !== 'number') {
      throw new ExpressionEvaluationError('Invalid member property key type');
    }

    if (isForbiddenIdentifier(String(propKey))) {
      throw new ExpressionEvaluationError(
        `Access to forbidden property "${String(propKey)}" is blocked`
      );
    }

    return { objectVal, propName: propKey };
  }

  private evalMember(
    node: MemberExpressionNode,
    scope: Record<string, unknown>
  ): { value: unknown } {
    const { objectVal, propName } = this.evalMemberTarget(node, scope);
    if (objectVal === null || objectVal === undefined) {
      return { value: undefined };
    }

    if (typeof objectVal === 'string' || Array.isArray(objectVal)) {
      if (propName === 'length') {
        return { value: objectVal.length };
      }
      if (typeof propName === 'number' || /^\d+$/.test(String(propName))) {
        const idx = Number(propName);
        return { value: objectVal[idx] };
      }
    }

    if (typeof objectVal === 'object') {
      if (Object.prototype.hasOwnProperty.call(objectVal, propName)) {
        return { value: (objectVal as Record<string | number, unknown>)[propName] };
      }
      return { value: undefined };
    }

    return { value: undefined };
  }
}

export const defaultExpressionEvaluator = new ExpressionEvaluator();

export function evaluateExpression(expression: string, scope: EvaluationScope = {}): unknown {
  return defaultExpressionEvaluator.evaluate(expression, scope);
}

export function evaluateObject<T>(target: T, scope: EvaluationScope = {}): T {
  return defaultExpressionEvaluator.evaluateObject(target, scope);
}
