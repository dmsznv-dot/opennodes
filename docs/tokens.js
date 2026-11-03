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

  const chip = (expr) => {
    const d = opts.describe(expr);
    const el = h(
      'span',
      {
        class: ['token', d.broken && 'broken'],
        contenteditable: 'false',
        'data-expr': expr,
        title: d.title,
        tabindex: '-1',
      },
      d.icon,
      d.step != null ? h('span', { class: 'token-step' }, String(d.step)) : null,
      h('span', { class: 'token-label' }, d.label)
    );
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', () => opts.onChipClick?.(el, field));
    return el;
  };

  const render = (value) => {
    field.replaceChildren(
      ...splitTemplate(value).map((p) => (p.expr ? chip(p.expr) : document.createTextNode(p.text)))
    );
    field.classList.toggle('empty', !field.textContent && !field.querySelector('.token'));
  };

  const read = (node) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) out += c.textContent;
      else if (c.dataset?.expr) out += `{{ ${c.dataset.expr} }}`;
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
    field.focus();
    const sel = window.getSelection();
    let range = saved && field.contains(saved.startContainer) ? saved : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(field);
      range.collapse(false);
    }
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    saved = range.cloneRange();
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
    for (const p of splitTemplate(text))
      insertNode(p.expr ? chip(p.expr) : document.createTextNode(p.text));
    changed();
  });

  /** A ready-made block: text with tokens, e.g. `**{{ $item.title }}**\n{{ $item.link }}`. */
  field.insertTemplate = (template) => {
    remember();
    for (const p of splitTemplate(template))
      insertNode(p.expr ? chip(p.expr) : document.createTextNode(p.text));
    changed();
  };
  field.insertToken = (expr) => {
    insertNode(chip(expr));
    changed();
  };
  /** A chip becomes a template, e.g. the link chip → `[Read more]({{ … }})`. */
  field.replaceWithTemplate = (el, template) => {
    const frag = document.createDocumentFragment();
    for (const p of splitTemplate(template))
      frag.append(p.expr ? chip(p.expr) : document.createTextNode(p.text));
    el.replaceWith(frag);
    changed();
  };
  field.replaceToken = (el, expr) => {
    el.replaceWith(chip(expr));
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
