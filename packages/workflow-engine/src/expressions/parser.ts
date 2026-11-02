import { Token, TokenType } from './lexer.js';
import {
  ASTNode,
  LiteralNode,
  IdentifierNode,
  MemberExpressionNode,
  CallExpressionNode,
  UnaryExpressionNode,
  BinaryExpressionNode,
  LogicalExpressionNode,
  ConditionalExpressionNode,
  ArrayExpressionNode,
} from './types.js';
import { ExpressionEvaluationError } from './errors.js';
import { isForbiddenIdentifier } from './builtins.js';

export class Parser {
  private current = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ASTNode {
    if (this.isAtEnd()) {
      return {
        type: 'Literal',
        value: undefined,
        raw: 'undefined',
      };
    }
    const expr = this.parseExpression();
    if (!this.isAtEnd()) {
      const tok = this.peek();
      throw new ExpressionEvaluationError(
        `Unexpected token "${tok.raw}" at position ${tok.start}`
      );
    }
    return expr;
  }

  private parseExpression(): ASTNode {
    return this.parseConditional();
  }

  // Ternary: test ? consequent : alternate
  private parseConditional(): ASTNode {
    let expr = this.parseLogicalOr();

    if (this.matchOperator('?')) {
      const consequent = this.parseExpression();
      this.consumeOperator(':', 'Expected ":" in ternary expression');
      const alternate = this.parseExpression();
      const conditionalNode: ConditionalExpressionNode = {
        type: 'ConditionalExpression',
        test: expr,
        consequent,
        alternate,
      };
      return conditionalNode;
    }

    return expr;
  }

  // Logical OR: a || b, a ?? b
  private parseLogicalOr(): ASTNode {
    let expr = this.parseLogicalAnd();

    while (this.matchOperator('||', '??')) {
      const operator = this.previous().value as '||' | '??';
      const right = this.parseLogicalAnd();
      const logicalNode: LogicalExpressionNode = {
        type: 'LogicalExpression',
        operator,
        left: expr,
        right,
      };
      expr = logicalNode;
    }

    return expr;
  }

  // Logical AND: a && b
  private parseLogicalAnd(): ASTNode {
    let expr = this.parseEquality();

    while (this.matchOperator('&&')) {
      const right = this.parseEquality();
      const logicalNode: LogicalExpressionNode = {
        type: 'LogicalExpression',
        operator: '&&',
        left: expr,
        right,
      };
      expr = logicalNode;
    }

    return expr;
  }

  // Equality: ===, !==, ==, !=
  private parseEquality(): ASTNode {
    let expr = this.parseRelational();

    while (this.matchOperator('===', '!==', '==', '!=')) {
      const operator = this.previous().value as '===' | '!==' | '==' | '!=';
      const right = this.parseRelational();
      const binaryNode: BinaryExpressionNode = {
        type: 'BinaryExpression',
        operator,
        left: expr,
        right,
      };
      expr = binaryNode;
    }

    return expr;
  }

  // Relational: <, <=, >, >=
  private parseRelational(): ASTNode {
    let expr = this.parseAdditive();

    while (this.matchOperator('<', '<=', '>', '>=')) {
      const operator = this.previous().value as '<' | '<=' | '>' | '>=';
      const right = this.parseAdditive();
      const binaryNode: BinaryExpressionNode = {
        type: 'BinaryExpression',
        operator,
        left: expr,
        right,
      };
      expr = binaryNode;
    }

    return expr;
  }

  // Additive: +, -
  private parseAdditive(): ASTNode {
    let expr = this.parseMultiplicative();

    while (this.matchOperator('+', '-')) {
      const operator = this.previous().value as '+' | '-';
      const right = this.parseMultiplicative();
      const binaryNode: BinaryExpressionNode = {
        type: 'BinaryExpression',
        operator,
        left: expr,
        right,
      };
      expr = binaryNode;
    }

    return expr;
  }

  // Multiplicative: *, /, %
  private parseMultiplicative(): ASTNode {
    let expr = this.parseUnary();

    while (this.matchOperator('*', '/', '%')) {
      const operator = this.previous().value as '*' | '/' | '%';
      const right = this.parseUnary();
      const binaryNode: BinaryExpressionNode = {
        type: 'BinaryExpression',
        operator,
        left: expr,
        right,
      };
      expr = binaryNode;
    }

    return expr;
  }

  // Unary: !, -, +
  private parseUnary(): ASTNode {
    if (this.matchOperator('!', '-', '+')) {
      const operator = this.previous().value as '!' | '-' | '+';
      // Optimization: if unary - followed immediately by number literal, fuse them
      if (operator === '-' && this.check('Number')) {
        const numToken = this.advance();
        return {
          type: 'Literal',
          value: -Number(numToken.value),
          raw: `-${numToken.raw}`,
        };
      }
      const argument = this.parseUnary();
      const unaryNode: UnaryExpressionNode = {
        type: 'UnaryExpression',
        operator,
        argument,
      };
      return unaryNode;
    }

    return this.parsePostfix();
  }

  // Postfix: member access, call expressions, optional chaining
  private parsePostfix(): ASTNode {
    let expr = this.parsePrimary();

    while (true) {
      if (this.matchOperator('.')) {
        // Dot access: expr.prop
        if (!this.check('Identifier') && !this.check('Number')) {
          throw new ExpressionEvaluationError(
            `Expected property identifier after "." at position ${this.peek().start}`
          );
        }
        const propToken = this.advance();
        if (isForbiddenIdentifier(propToken.value)) {
          throw new ExpressionEvaluationError(
            `Access to property "${propToken.value}" is blocked`
          );
        }
        const property: IdentifierNode = {
          type: 'Identifier',
          name: propToken.value,
        };
        const memberNode: MemberExpressionNode = {
          type: 'MemberExpression',
          object: expr,
          property,
          computed: false,
          optional: false,
        };
        expr = memberNode;
      } else if (this.matchOperator('?.')) {
        // Optional dot access: expr?.prop
        if (!this.check('Identifier')) {
          throw new ExpressionEvaluationError(
            `Expected property identifier after "?." at position ${this.peek().start}`
          );
        }
        const propToken = this.advance();
        if (isForbiddenIdentifier(propToken.value)) {
          throw new ExpressionEvaluationError(
            `Access to property "${propToken.value}" is blocked`
          );
        }
        const property: IdentifierNode = {
          type: 'Identifier',
          name: propToken.value,
        };
        const memberNode: MemberExpressionNode = {
          type: 'MemberExpression',
          object: expr,
          property,
          computed: false,
          optional: true,
        };
        expr = memberNode;
      } else if (this.matchPunctuation('[')) {
        // Computed access: expr[prop]
        const propExpr = this.parseExpression();
        this.consumePunctuation(']', 'Expected "]" after array subscript');

        // Check if static string/identifier is forbidden
        if (propExpr.type === 'Literal' && typeof propExpr.value === 'string' && isForbiddenIdentifier(propExpr.value)) {
          throw new ExpressionEvaluationError(
            `Access to property "${propExpr.value}" is blocked`
          );
        }

        const memberNode: MemberExpressionNode = {
          type: 'MemberExpression',
          object: expr,
          property: propExpr,
          computed: true,
          optional: false,
        };
        expr = memberNode;
      } else if (this.matchPunctuation('(')) {
        // Method / Function call: expr(arg1, arg2)
        if (expr.type !== 'MemberExpression' && expr.type !== 'Identifier') {
          throw new ExpressionEvaluationError(
            'Invalid callee in call expression'
          );
        }
        const args: ASTNode[] = [];
        if (!this.checkPunctuation(')')) {
          do {
            args.push(this.parseExpression());
          } while (this.matchPunctuation(','));
        }
        this.consumePunctuation(')', 'Expected ")" after argument list');

        const callNode: CallExpressionNode = {
          type: 'CallExpression',
          callee: expr,
          arguments: args,
        };
        expr = callNode;
      } else {
        break;
      }
    }

    return expr;
  }

  // Primary: Literals, Identifiers, Arrays, Parentheses
  private parsePrimary(): ASTNode {
    if (this.match('Number')) {
      const tok = this.previous();
      return {
        type: 'Literal',
        value: Number(tok.value),
        raw: tok.raw,
      };
    }

    if (this.match('String')) {
      const tok = this.previous();
      return {
        type: 'Literal',
        value: tok.value,
        raw: tok.raw,
      };
    }

    if (this.match('Boolean')) {
      const tok = this.previous();
      return {
        type: 'Literal',
        value: tok.value === 'true',
        raw: tok.raw,
      };
    }

    if (this.match('Null')) {
      const tok = this.previous();
      return {
        type: 'Literal',
        value: null,
        raw: tok.raw,
      };
    }

    if (this.match('Undefined')) {
      const tok = this.previous();
      return {
        type: 'Literal',
        value: undefined,
        raw: tok.raw,
      };
    }

    if (this.match('Identifier')) {
      const tok = this.previous();
      if (isForbiddenIdentifier(tok.value)) {
        throw new ExpressionEvaluationError(
          `Access to forbidden identifier "${tok.value}" is blocked`
        );
      }
      return {
        type: 'Identifier',
        name: tok.value,
      };
    }

    // Array literal: [elem1, elem2]
    if (this.matchPunctuation('[')) {
      const elements: ASTNode[] = [];
      if (!this.checkPunctuation(']')) {
        do {
          elements.push(this.parseExpression());
        } while (this.matchPunctuation(','));
      }
      this.consumePunctuation(']', 'Expected "]" after array elements');
      const arrayNode: ArrayExpressionNode = {
        type: 'ArrayExpression',
        elements,
      };
      return arrayNode;
    }

    // Grouping: (expr)
    if (this.matchPunctuation('(')) {
      const expr = this.parseExpression();
      this.consumePunctuation(')', 'Expected ")" after grouped expression');
      return expr;
    }

    const tok = this.peek();
    throw new ExpressionEvaluationError(
      `Unexpected token "${tok.raw}" at position ${tok.start}`
    );
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private matchOperator(...ops: string[]): boolean {
    if (this.check('Operator')) {
      const tok = this.peek();
      if (ops.includes(tok.value)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private matchPunctuation(...puncs: string[]): boolean {
    if (this.check('Punctuation')) {
      const tok = this.peek();
      if (puncs.includes(tok.value)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private consumeOperator(op: string, errorMsg: string): Token {
    if (this.check('Operator') && this.peek().value === op) {
      return this.advance();
    }
    throw new ExpressionEvaluationError(`${errorMsg} at position ${this.peek().start}`);
  }

  private consumePunctuation(punc: string, errorMsg: string): Token {
    if (this.check('Punctuation') && this.peek().value === punc) {
      return this.advance();
    }
    throw new ExpressionEvaluationError(`${errorMsg} at position ${this.peek().start}`);
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private checkPunctuation(punc: string): boolean {
    if (this.isAtEnd()) return false;
    const tok = this.peek();
    return tok.type === 'Punctuation' && tok.value === punc;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private peek(): Token {
    return this.tokens[this.current]!;
  }

  private previous(): Token {
    return this.tokens[this.current - 1]!;
  }
}
