/**
 * LocalFlow E2E Test Suite - Tier 2: Safe Expression Evaluator Boundaries
 * Verifies edge cases, deep undefined access, prototype pollution attempts, large strings, and Unicode.
 */

import { describe, it, expect } from '../harness/index.ts';
import { expressionEvaluator, ExpressionEvaluationError } from '../harness/expression-evaluator.ts';

describe('Tier 2: Boundary - Expression Evaluator Boundaries', () => {
  it('B-EXP-1: should resolve deep undefined properties safely without throwing TypeError', () => {
    const scope = {
      $trigger: {
        existing: { level1: null }
      }
    };

    const res1 = expressionEvaluator.evaluate('{{ $trigger.existing.level1.deep.property }}', scope);
    expect(res1).toBeUndefined();

    const res2 = expressionEvaluator.evaluate('{{ $trigger.nonExistentRoot.level1 }}', scope);
    expect(res2).toBeUndefined();
  });

  it('B-EXP-2: should strictly block prototype pollution attempts across all syntax variations', () => {
    const scope = { $trigger: { data: 'test' } };
    expect(() => expressionEvaluator.evaluate('{{ __proto__.polluted = 1 }}', scope)).toThrow(ExpressionEvaluationError);
    expect(() => expressionEvaluator.evaluate('{{ constructor.prototype.polluted = 1 }}', scope)).toThrow(ExpressionEvaluationError);
    expect(() => expressionEvaluator.evaluate('{{ $trigger.__proto__ }}', scope)).toThrow(ExpressionEvaluationError);
    expect(() => expressionEvaluator.evaluate('{{ $trigger.constructor }}', scope)).toThrow(ExpressionEvaluationError);
  });

  it('B-EXP-3: should handle large string template interpolation (100,000 characters) efficiently', () => {
    const largeText = 'A'.repeat(50000);
    const scope = { $trigger: { segment: largeText } };

    const interpolated = expressionEvaluator.evaluate('Prefix-{{ $trigger.segment }}-{{ $trigger.segment }}-Suffix', scope) as string;
    expect(interpolated.startsWith('Prefix-AAAA')).toBe(true);
    expect(interpolated.endsWith('AAAA-Suffix')).toBe(true);
    expect(interpolated.length).toBe(100015); // 50000 * 2 + 15 chars prefix/suffix
  });

  it('B-EXP-4: should preserve multi-byte Unicode, Cyrillic, Asian scripts, and emojis in expressions', () => {
    const unicodeScope = {
      $trigger: {
        greetingRu: 'Привет, мир!',
        greetingJa: 'こんにちは世界',
        emoji: '🚀⚡️🛡️',
        arabic: 'مرحبا بالعالم'
      }
    };

    const res = expressionEvaluator.evaluate('{{ $trigger.greetingRu }} | {{ $trigger.greetingJa }} | {{ $trigger.emoji }} | {{ $trigger.arabic }}', unicodeScope);
    expect(res).toBe('Привет, мир! | こんにちは世界 | 🚀⚡️🛡️ | مرحبا بالعالم');
  });

  it('B-EXP-5: should evaluate multi-condition boolean expressions with comparisons and strings', () => {
    const scope = {
      $trigger: {
        score: 85,
        status: 'active',
        verified: true,
        attempts: 1
      }
    };

    const res1 = expressionEvaluator.evaluate('{{ $trigger.score >= 80 && $trigger.status === "active" }}', scope);
    expect(res1).toBe(true);

    const res2 = expressionEvaluator.evaluate('{{ $trigger.attempts > 3 || $trigger.verified === false }}', scope);
    expect(res2).toBe(false);
  });

  it('B-EXP-6: should handle expressions with numbers formatted as negative and decimals', () => {
    const scope = {
      $trigger: {
        temperature: -15.5,
        threshold: 0
      }
    };

    const isFreezing = expressionEvaluator.evaluate('{{ $trigger.temperature < $trigger.threshold }}', scope);
    expect(isFreezing).toBe(true);

    const diff = expressionEvaluator.evaluate('{{ $trigger.temperature }}', scope);
    expect(diff).toBe(-15.5);
  });
});
