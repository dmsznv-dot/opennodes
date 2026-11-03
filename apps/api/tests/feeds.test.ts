import { describe, it, expect } from 'vitest';
import { parseRssXml } from '@localflow/connectors-core';
import { pageImage } from '@localflow/execution-runtime';

describe('feeds — where an item’s picture comes from', () => {
  it('Atom: the picture in <content> next to a plain-text <summary> (It’s Nice That and others)', () => {
    const xml = `<feed><entry><id>a</id><title>T</title>
      <content type="html"><![CDATA[<img src="https://cdn.x/a.png" class="webfeedsFeaturedVisual"><p>Body</p>]]></content>
      <summary><![CDATA[Short text]]></summary>
      <link href="https://x/a" rel="alternate"></link></entry></feed>`;
    const [item] = parseRssXml(xml);
    expect(item).toMatchObject({ description: 'Short text', image: 'https://cdn.x/a.png' });
  });

  it('RSS: the picture in content:encoded when the description has none', () => {
    const xml = `<rss><channel><item><title>T</title><link>https://x/b</link><description>Short</description>
      <content:encoded><![CDATA[<p><img src="https://cdn.x/b.jpg"></p>]]></content:encoded></item></channel></rss>`;
    expect(parseRssXml(xml)[0]!.image).toBe('https://cdn.x/b.jpg');
  });

  it('a page’s share picture, made absolute', () => {
    expect(pageImage('<meta property="og:image" content="/i.jpg">', 'https://x.test/a/b')).toBe(
      'https://x.test/i.jpg'
    );
    expect(pageImage('<meta content="https://c/t.png" name="twitter:image">', 'https://x')).toBe(
      'https://c/t.png'
    );
    expect(pageImage('<p>none</p>', 'https://x')).toBeUndefined();
  });
});
