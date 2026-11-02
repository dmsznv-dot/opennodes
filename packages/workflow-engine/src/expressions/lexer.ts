import { ExpressionEvaluationError } from './errors.js';
import { isForbiddenIdentifier } from './builtins.js';

export type TokenType =
  | 'Identifier'
  | 'Number'
  | 'String'
  | 'Boolean'
  | 'Null'
  | 'Undefined'
  | 'Operator'
  | 'Punctuation'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  raw: string;
  start: number;
  end: number;
}

export class Lexer {
  private pos = 0;
  private readonly len: number;

  constructor(private readonly input: string) {
    this.len = input.length;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.len) {
      this.skipWhitespace();
      if (this.pos >= this.len) break;

      const char = this.input[this.pos]!;
      const start = this.pos;

      // Punctuation
      if (char === '(' || char === ')' || char === '[' || char === ']' || char === ',') {
        this.pos++;
        tokens.push({
          type: 'Punctuation',
          value: char,
          raw: char,
          start,
          end: this.pos,
        });
        continue;
      }

      // Strings ('...' or "...")
      if (char === "'" || char === '"') {
        tokens.push(this.readString(char));
        continue;
      }

      // Numbers (digits or decimal point followed by digits, or negative number if context permits)
      if (this.isDigit(char)) {
        tokens.push(this.readNumber());
        continue;
      }

      // Dot or optional chaining (?.)
      if (char === '.') {
        this.pos++;
        tokens.push({
          type: 'Operator',
          value: '.',
          raw: '.',
          start,
          end: this.pos,
        });
        continue;
      }

      // Operators
      if (this.isOperatorStart(char)) {
        tokens.push(this.readOperator());
        continue;
      }

      // Identifiers / Keywords
      if (this.isIdentifierStart(char)) {
        const idToken = this.readIdentifier();
        if (isForbiddenIdentifier(idToken.value)) {
          throw new ExpressionEvaluationError(
            `Access to forbidden identifier "${idToken.value}" is blocked`
          );
        }
        tokens.push(idToken);
        continue;
      }

      throw new ExpressionEvaluationError(
        `Unexpected character "${char}" at position ${this.pos}`
      );
    }

    tokens.push({
      type: 'EOF',
      value: '',
      raw: '',
      start: this.pos,
      end: this.pos,
    });

    return tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.len) {
      const c = this.input.charCodeAt(this.pos);
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private isDigit(char: string): boolean {
    const code = char.charCodeAt(0);
    return code >= 48 && code <= 57;
  }

  private isIdentifierStart(char: string): boolean {
    return char === '$' || char === '_' || /[a-zA-Z]/.test(char);
  }

  private isIdentifierPart(char: string): boolean {
    return char === '$' || char === '_' || /[a-zA-Z0-9]/.test(char);
  }

  private isOperatorStart(char: string): boolean {
    return ['=', '!', '<', '>', '&', '|', '?', ':', '+', '-', '*', '/', '%'].includes(char);
  }

  private readString(quote: string): Token {
    const start = this.pos;
    this.pos++; // skip opening quote
    let value = '';

    while (this.pos < this.len) {
      const char = this.input[this.pos]!;
      if (char === quote) {
        this.pos++; // skip closing quote
        const raw = this.input.slice(start, this.pos);
        return {
          type: 'String',
          value,
          raw,
          start,
          end: this.pos,
        };
      }
      if (char === '\\') {
        this.pos++;
        if (this.pos >= this.len) {
          throw new ExpressionEvaluationError('Unterminated escape sequence in string');
        }
        const esc = this.input[this.pos]!;
        this.pos++;
        switch (esc) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case "'": value += "'"; break;
          case '"': value += '"'; break;
          case 'u': {
            const hex = this.input.slice(this.pos, this.pos + 4);
            if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new ExpressionEvaluationError('Invalid unicode escape sequence');
            }
            value += String.fromCharCode(parseInt(hex, 16));
            this.pos += 4;
            break;
          }
          default:
            value += esc;
        }
      } else {
        value += char;
        this.pos++;
      }
    }

    throw new ExpressionEvaluationError('Unterminated string literal');
  }

  private readNumber(): Token {
    const start = this.pos;
    while (this.pos < this.len && this.isDigit(this.input[this.pos]!)) {
      this.pos++;
    }

    if (this.pos < this.len && this.input[this.pos] === '.' && this.isDigit(this.input[this.pos + 1] ?? '')) {
      this.pos++; // skip decimal point
      while (this.pos < this.len && this.isDigit(this.input[this.pos]!)) {
        this.pos++;
      }
    }

    // Optional exponent
    if (this.pos < this.len && (this.input[this.pos] === 'e' || this.input[this.pos] === 'E')) {
      this.pos++;
      if (this.pos < this.len && (this.input[this.pos] === '+' || this.input[this.pos] === '-')) {
        this.pos++;
      }
      while (this.pos < this.len && this.isDigit(this.input[this.pos]!)) {
        this.pos++;
      }
    }

    const raw = this.input.slice(start, this.pos);
    return {
      type: 'Number',
      value: raw,
      raw,
      start,
      end: this.pos,
    };
  }

  private readOperator(): Token {
    const start = this.pos;
    const two = this.input.slice(this.pos, this.pos + 2);
    const three = this.input.slice(this.pos, this.pos + 3);

    if (three === '===' || three === '!==') {
      this.pos += 3;
      return { type: 'Operator', value: three, raw: three, start, end: this.pos };
    }

    if (['==', '!=', '<=', '>=', '&&', '||', '??', '?.'].includes(two)) {
      this.pos += 2;
      return { type: 'Operator', value: two, raw: two, start, end: this.pos };
    }

    const single = this.input[this.pos]!;
    this.pos++;

    if (single === '=') {
      throw new ExpressionEvaluationError(
        'Assignment operator "=" is blocked for security'
      );
    }

    return { type: 'Operator', value: single, raw: single, start, end: this.pos };
  }

  private readIdentifier(): Token {
    const start = this.pos;
    while (this.pos < this.len && this.isIdentifierPart(this.input[this.pos]!)) {
      this.pos++;
    }
    const val = this.input.slice(start, this.pos);

    if (val === 'true' || val === 'false') {
      return { type: 'Boolean', value: val, raw: val, start, end: this.pos };
    }
    if (val === 'null') {
      return { type: 'Null', value: val, raw: val, start, end: this.pos };
    }
    if (val === 'undefined') {
      return { type: 'Undefined', value: val, raw: val, start, end: this.pos };
    }

    return { type: 'Identifier', value: val, raw: val, start, end: this.pos };
  }
}
