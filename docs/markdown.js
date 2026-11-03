/**
 * Everyday Markdown as DOM, for “how the post will look” previews: **bold**, *italic*,
 * ~~struck~~, `code`, ``` blocks ```, [link](url), # headings, lists and > quotes — the same
 * rules the server uses to send Telegram posts. Built from DOM nodes only (no innerHTML).
 */
import { h } from './dom.js';

const INLINE = [
  { re: /`([^`\n]+)`/, make: (m) => h('code', {}, m[1]) },
  {
    re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/,
    make: (m) => h('a', { href: m[2], target: '_blank', rel: 'noopener noreferrer' }, inline(m[1])),
  },
  { re: /\*\*(?=\S)([\s\S]*?\S)\*\*/, make: (m) => h('b', {}, inline(m[1])) },
  { re: /(?<!\w)__(?=\S)([\s\S]*?\S)__(?!\w)/, make: (m) => h('b', {}, inline(m[1])) },
  { re: /~~(?=\S)([\s\S]*?\S)~~/, make: (m) => h('s', {}, inline(m[1])) },
  {
    re: /(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*]|[^\s*])\*(?![\w*])/,
    make: (m) => h('i', {}, inline(m[1])),
  },
  {
    re: /(?<!\w)_(?=[^\s_])([^_\n]*?[^\s_]|[^\s_])_(?!\w)/,
    make: (m) => h('i', {}, inline(m[1])),
  },
  {
    re: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?»"']/,
    make: (m) => h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]),
  },
];

function inline(text) {
  const out = [];
  let rest = String(text);
  while (rest) {
    let best = null;
    for (const p of INLINE) {
      const m = p.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { p, m };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index) out.push(rest.slice(0, best.m.index));
    out.push(best.p.make(best.m));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

/** Markdown → an array of DOM nodes (lines separated by line breaks). */
export function markdownNodes(md) {
  const out = [];
  const lines = String(md ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const br = () => out.length && out.push(h('br'));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      out.push(h('pre', {}, code.join('\n')));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) {
        if (quote.length) quote.push(h('br'));
        quote.push(...inline(lines[i].replace(/^>\s?/, '')));
      }
      i--;
      out.push(h('blockquote', {}, quote));
      continue;
    }
    br();
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) out.push(h('b', {}, inline(heading[1])));
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) out.push('———');
    else {
      const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
      out.push(...(bullet ? [`${bullet[1]}• `, ...inline(bullet[2])] : inline(line)));
    }
  }
  return out;
}
