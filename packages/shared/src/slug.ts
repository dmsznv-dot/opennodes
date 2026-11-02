// prettier-ignore
const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
};

/** FNV-1a 32-bit, base36 — short deterministic suffix for names that have no Latin form. */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (const ch of input) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

/**
 * Unicode-safe workspace slug. Cyrillic is transliterated, Latin diacritics are stripped,
 * and names with no Latin representation (e.g. CJK) get a stable hash-based slug instead of
 * collapsing to a shared `primary`. Collisions with `existingSlugs` get a numeric suffix.
 */
export function slugifyWorkspaceName(name: string, existingSlugs: Iterable<string> = []): string {
  const transliterated = Array.from(name.trim().toLowerCase())
    .map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

  let base = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (!base) base = `ws-${shortHash(name.trim())}`;

  const taken = new Set(existingSlugs);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}
