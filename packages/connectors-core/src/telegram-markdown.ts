/**
 * Everyday Markdown — what people type and what AI models write — as Telegram HTML:
 * **bold**, __bold__, *italic*, _italic_, ~~struck~~, `code`, ``` blocks ```, [text](url),
 * # headings (bold), "- " / "* " lists (•) and "> " quotes. Everything else is escaped, so
 * the result always parses: a stray "*" or "<" in data never breaks a post.
 */
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

function inline(text: string): string {
  return (
    text
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<b>$2</b>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
      .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<i>$2</i>')
      // Single letters too: *a*; but never inside words or URLs (snake_case stays).
      .replace(/(^|[^\w*])\*([^\s*])\*(?![\w*])/g, '$1<i>$2</i>')
      .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<i>$2</i>')
  );
}

export function markdownToTelegramHtml(md: string): string {
  const kept: string[] = [];
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;

  let s = String(md ?? '');
  // Code first: nothing inside it is formatting.
  s = s.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_m, code: string) =>
    keep(`<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`)
  );
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) => keep(`<code>${escapeHtml(code)}</code>`));
  // Links and bare URLs: their underscores and asterisks are not formatting.
  s = s.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|tg:\/\/[^\s)]+)\)/g,
    (_m, label: string, url: string) =>
      keep(`<a href="${escapeAttr(url)}">${inline(escapeHtml(label))}</a>`)
  );
  s = s.replace(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?»"']/g, (url) => keep(escapeHtml(url)));

  const lines = escapeHtml(s).split('\n');
  const out: string[] = [];
  let quote: string[] = [];
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.join('\n')}</blockquote>`);
    quote = [];
  };
  for (const line of lines) {
    const q = line.match(/^&gt;\s?(.*)$/);
    if (q) {
      quote.push(inline(q[1]!));
      continue;
    }
    flushQuote();
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      out.push(`<b>${inline(heading[1]!.replace(/^\*\*([\s\S]*)\*\*$/, '$1'))}</b>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('———');
      continue;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    out.push(bullet ? `${bullet[1]}• ${inline(bullet[2]!)}` : inline(line));
  }
  flushQuote();
  let html = out.join('\n');
  while (html.includes('\u0000')) {
    html = html.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)]!);
  }
  return html;
}
