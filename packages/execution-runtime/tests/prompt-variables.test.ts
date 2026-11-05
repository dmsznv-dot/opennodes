import { describe, it, expect } from 'vitest';
import { fillPrompt } from '../src/context.js';

describe('Prompt Template required values', () => {
  const prompt = { name: 'Post', template: 'Write about {{ $trigger.article.title }}', version: 2 };
  it('reports a missing nested field even when the trigger itself exists', () => {
    expect(() => fillPrompt(prompt, { $trigger: { article: {} } })).toThrow(/article.title/);
  });
  for (const value of ['', null, 0, false]) {
    it(`preserves a present value: ${String(value)}`, () => {
      expect(() => fillPrompt(prompt, { $trigger: { article: { title: value } } })).not.toThrow();
    });
  }
  it('evaluates expressions once, including supported array transformations', () => {
    expect(fillPrompt({ name: 'Order', version: 1, template: '{{ $trigger.items.reverse().join(",") }}' }, {
      $trigger: { items: ['a', 'b'] },
    })).toBe('b,a');
  });
});
