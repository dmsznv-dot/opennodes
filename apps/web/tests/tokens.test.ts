import { describe, it, expect } from 'vitest';
import { splitForField } from '../../../docs/tokens.js';

describe('text fields — what shows as a tag', () => {
  it('a link with words is one link tag; a bold tag is one bold tag; the rest stays text', () => {
    const value =
      '**{{ $item.postTitle }}**\n\n{{ $item.postText }}\n\n[Читать далее]({{ $item.link }}) **жирный текст**';
    expect(splitForField(value)).toEqual([
      { expr: '$item.postTitle', bold: true },
      { text: '\n\n' },
      { expr: '$item.postText' },
      { text: '\n\n' },
      { expr: '$item.link', linkText: 'Читать далее' },
      { text: ' **жирный текст**' },
    ]);
  });

  it('a link to a plain address stays text (only data can be a link tag)', () => {
    expect(splitForField('[сайт](https://example.com)')).toEqual([
      { text: '[сайт](https://example.com)' },
    ]);
  });
});
