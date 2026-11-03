/**
 * Fields with data from earlier steps. Values stay plain engine templates
 * (`Hi {{ $trigger.fromName }}`), but the field shows each `{{ … }}` as a chip — service
 * icon, step number, short name — that is inserted from a picker and deleted as a unit.
 * No innerHTML anywhere: chips and text are built as DOM nodes (BUG-06).
 */
import { h } from './dom.js';

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * `$nodes.rss_1.output.digest.toUpperCase()` → its parts, or null for any other expression.
 * `$item.title` is a field of the item a step repeats for ("for each item").
 */
export function parseExpr(expr) {
  const m = String(expr)
    .trim()
    .match(
      /^\$(trigger|nodes|now|run|item)(?:\.([\w-]+)\.output)?\.(\w+)((?:\.(?:toUpperCase|toLowerCase|trim)\(\)|\.slice\(0,\s*\d+\))?)$/
    );
  if (!m) return null;
  const [, scope, nodeId, key, fmtRaw] = m;
  if (scope === 'nodes' && !nodeId) return null;
  const n = fmtRaw.match(/slice\(0,\s*(\d+)\)/)?.[1];
  const fmt = fmtRaw.includes('toUpperCase')
    ? 'upper'
    : fmtRaw.includes('toLowerCase')
      ? 'lower'
      : fmtRaw.includes('trim')
        ? 'trim'
        : n
          ? `first:${n}`
          : '';
  return { scope, nodeId: nodeId ?? null, key, fmt };
}

export function buildExpr({ scope, nodeId, key, fmt = '' }) {
  const base = scope === 'nodes' ? `$nodes.${nodeId}.output.${key}` : `$${scope}.${key}`;
  const suffix =
    fmt === 'upper'
      ? '.toUpperCase()'
      : fmt === 'lower'
        ? '.toLowerCase()'
        : fmt === 'trim'
          ? '.trim()'
          : fmt.startsWith('first:')
            ? `.slice(0, ${Number(fmt.slice(6)) || 200})`
            : '';
  return `${base}${suffix}`; // the expression inside {{ }}, as chips store it
}

/** The text position under a point (Chrome/Safari and Firefox spell it differently). */
function caretAt(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  const p = document.caretPositionFromPoint?.(x, y);
  if (!p) return null;
  const r = document.createRange();
  r.setStart(p.offsetNode, p.offset);
  r.collapse(true);
  return r;
}

/**
 * Parts of a template as a field shows them: text, `{{ … }}` tokens, links with words —
 * `[Read more]({{ … }})`, one link chip with those words — and bold tags `**{{ … }}**`.
 */
export function splitForField(value) {
  const parts = [];
  // `[words]({{ … }})` — a link with words; `**{{ … }}**` — a tag in bold.
  const re = /\[([^\]\n]+)\]\(\{\{\s*([^{}]+?)\s*\}\}\)|\*\*\{\{\s*([^{}]+?)\s*\}\}\*\*/g;
  let last = 0;
  const str = String(value ?? '');
  for (const m of str.matchAll(re)) {
    if (m.index > last) parts.push(...splitTemplate(str.slice(last, m.index)));
    parts.push(m[3] ? { expr: m[3], bold: true } : { expr: m[2], linkText: m[1] });
    last = m.index + m[0].length;
  }
  if (last < str.length) parts.push(...splitTemplate(str.slice(last)));
  return parts;
}

/** Parts of a template: text and `{{ … }}` tokens, in order. */
export function splitTemplate(value) {
  const parts = [];
  let last = 0;
  for (const m of String(value ?? '').matchAll(TOKEN_RE)) {
    if (m.index > last) parts.push({ text: value.slice(last, m.index) });
    parts.push({ expr: m[1] });
    last = m.index + m[0].length;
  }
  if (last < String(value ?? '').length) parts.push({ text: String(value).slice(last) });
  return parts;
}

/**
 * A text field that shows tokens as chips.
 * @param {{ value: string, multiline?: boolean, placeholder?: string, id?: string,
 *   describe: (expr: string) => { icon: Node, step: string|number|null, label: string,
 *     title: string, broken?: boolean },
 *   onChange?: () => void, onChipClick?: (chip: HTMLElement, field: HTMLElement) => void,
 *   onOpenPicker?: (field: HTMLElement) => void }} opts
 */
export function tokenField(opts) {
  const field = h('div', {
    id: opts.id,
    class: ['input', 'token-field', opts.multiline && 'multiline'],
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': opts.multiline ? 'true' : 'false',
    spellcheck: 'true',
    'data-placeholder': opts.placeholder ?? '',
  });
  let saved = null;

  const chip = (expr, linkText, bold) => {
    const d = opts.describe(expr);
    // A link with words shows the words: “🔗 Read more”; its address is the tag inside.
    const el = h(
      'span',
      {
        class: [
          'token',
          d.broken && 'broken',
          linkText ? 'token-link' : d.kind && `token-${d.kind}`,
          bold && 'token-bold',
        ],
        contenteditable: 'false',
        'data-expr': expr,
        'data-link-text': linkText || null,
        'data-bold': bold ? '1' : null,
        title: linkText ? `«${linkText}» → ${d.title}` : d.title,
        tabindex: '-1',
      },
      linkText ? h('span', { class: 'token-sys' }, '🔗') : d.icon,
      !linkText && d.step != null ? h('span', { class: 'token-step' }, String(d.step)) : null,
      h('span', { class: 'token-label' }, linkText || d.label)
    );
    el.addEventListener('mousedown', (e) => e.preventDefault());
    // Drag a chip to another place in the text; a plain click opens its menu.
    let dragged = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const start = { x: e.clientX, y: e.clientY };
      let moving = false;
      const spot = (ev) => {
        const r = caretAt(ev.clientX, ev.clientY);
        return r && field.contains(r.startContainer) && !el.contains(r.startContainer) ? r : null;
      };
      const move = (ev) => {
        if (!moving && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
        if (!moving) {
          moving = true;
          el.classList.add('dragging');
          field.focus();
        }
        ev.preventDefault();
        const r = spot(ev);
        if (r) {
          // The text caret shows where the chip will land.
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        }
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        el.classList.remove('dragging');
        if (!moving) return;
        dragged = true;
        const r = spot(ev);
        if (!r) return;
        r.insertNode(el); // moves the chip
        r.setStartAfter(el);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        saved = r.cloneRange();
        changed();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    el.addEventListener('click', () => {
      if (dragged) {
        dragged = false;
        return;
      }
      opts.onChipClick?.(el, field);
    });
    return el;
  };

  const render = (value) => {
    field.replaceChildren(
      ...splitForField(value).map((p) =>
        p.expr ? chip(p.expr, p.linkText, p.bold) : document.createTextNode(p.text)
      )
    );
    field.classList.toggle('empty', !field.textContent && !field.querySelector('.token'));
  };

  const read = (node) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) out += c.textContent;
      else if (c.dataset?.linkText) out += `[${c.dataset.linkText}]({{ ${c.dataset.expr} }})`;
      else if (c.dataset?.bold) out += `**{{ ${c.dataset.expr} }}**`;
      else if (c.dataset?.expr) out += `{{ ${c.dataset.expr} }}`;
      else if (c.dataset?.tail)
        continue; // keeps a trailing line break visible; not text
      else if (c.nodeName === 'BR') out += '\n';
      else {
        // Browsers wrap new lines in <div>; each one starts a line.
        if (out && !out.endsWith('\n')) out += '\n';
        out += read(c);
      }
    }
    return out;
  };

  const changed = () => {
    field.classList.toggle('empty', !field.textContent && !field.querySelector('.token'));
    opts.onChange?.();
  };

  const remember = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && field.contains(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange();
  };

  const insertNode = (node) => {
    const sel = window.getSelection();
    // Where the caret is now; the remembered spot only when focus is elsewhere (a picker).
    const live =
      sel?.rangeCount && field.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    field.focus();
    let range = live ?? (saved && field.contains(saved.startContainer) ? saved : null);
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(field);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    // A line break at the very end shows (and takes the caret) only with something after
    // it. The helper is moved before the caret is placed, so the caret does not shift.
    field.querySelectorAll('br[data-tail]').forEach((b) => b.remove());
    // Splitting a text node leaves empty ones behind; they would hide that this is the end.
    for (const c of [...field.childNodes]) {
      if (c !== node && c.nodeType === Node.TEXT_NODE && c.textContent === '') c.remove();
    }
    const last = node.nodeType === Node.TEXT_NODE && !node.nextSibling;
    if (last && node.textContent.endsWith('\n')) node.after(h('br', { 'data-tail': '1' }));
    const caret = document.createRange();
    caret.setStartAfter(node);
    caret.collapse(true);
    sel.removeAllRanges();
    sel.addRange(caret);
    saved = caret.cloneRange();
  };

  const insertText = (text) => insertNode(document.createTextNode(text));

  field.addEventListener('keyup', remember);
  field.addEventListener('mouseup', remember);
  field.addEventListener('blur', remember);
  field.addEventListener('input', changed);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!opts.multiline) return;
      insertText('\n');
      // A trailing newline needs something after it to show as a line.
      if (!field.lastChild?.textContent?.length || field.lastChild.textContent.endsWith('\n')) {
        // keep caret visible on the new line
      }
      changed();
    } else if (e.key === '{' || (e.key === '/' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      remember();
      opts.onOpenPicker?.(field);
    }
  });
  field.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    // Pasted templates keep their tokens.
    remember();
    for (const p of splitForField(text))
      insertNode(p.expr ? chip(p.expr, p.linkText, p.bold) : document.createTextNode(p.text));
    changed();
  });

  /** A ready-made block: text with tokens, e.g. `**{{ $item.title }}**\n{{ $item.link }}`. */
  field.insertTemplate = (template) => {
    remember();
    for (const p of splitForField(template))
      insertNode(p.expr ? chip(p.expr, p.linkText, p.bold) : document.createTextNode(p.text));
    changed();
  };
  field.insertToken = (expr) => {
    insertNode(chip(expr));
    changed();
  };
  /** A chip becomes a template, e.g. the link chip → `[Read more]({{ … }})`. */
  field.replaceWithTemplate = (el, template) => {
    const frag = document.createDocumentFragment();
    for (const p of splitForField(template))
      frag.append(p.expr ? chip(p.expr, p.linkText, p.bold) : document.createTextNode(p.text));
    el.replaceWith(frag);
    changed();
  };
  field.replaceToken = (el, expr) => {
    // A link keeps its words, a bold tag stays bold.
    el.replaceWith(chip(expr, el.dataset.linkText, el.dataset.bold));
    changed();
  };
  field.removeToken = (el) => {
    el.remove();
    changed();
  };
  Object.defineProperty(field, 'value', {
    get: () => read(field),
    set: (v) => render(v),
  });

  render(opts.value ?? '');
  return field;
}
