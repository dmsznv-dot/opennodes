import { createTranslator, type Locale } from '../i18n/index.js';

export interface SetupWizardFormInput {
  email: string;
  password: string;
  fullName: string;
  workspaceName: string;
}

export interface SetupWizardSubmissionResult {
  valid: boolean;
  redirectPath?: string;
  workspaceSlug?: string;
  errors: Record<string, string>;
  /** Stable error codes per field; the UI may localize these itself. */
  errorCodes: Record<string, string>;
}

const MIN_PASSWORD_LENGTH = 8;

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

/**
 * `/setup` Initial Instance Bootstrap & Owner Onboarding Wizard Controller
 */
export class SetupWizardController {
  public static validateAndPrepareRedirect(
    input: SetupWizardFormInput,
    alreadyBootstrapped = false,
    options: { locale?: Locale; existingSlugs?: Iterable<string> } = {}
  ): SetupWizardSubmissionResult {
    const t = createTranslator(options.locale);

    if (alreadyBootstrapped) {
      return {
        valid: false,
        redirectPath: '/login',
        errors: { form: t('setup.error.alreadyBootstrapped') },
        errorCodes: { form: 'setup.error.alreadyBootstrapped' },
      };
    }

    const errorCodes: Record<string, string> = {};
    if (!input.email || !input.email.includes('@')) {
      errorCodes.email = 'setup.error.email';
    }
    if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) {
      errorCodes.password = 'setup.error.password';
    }
    if (!input.workspaceName || input.workspaceName.trim().length < 2) {
      errorCodes.workspaceName = 'setup.error.workspaceName';
    }

    if (Object.keys(errorCodes).length > 0) {
      const errors: Record<string, string> = {};
      for (const [field, code] of Object.entries(errorCodes)) {
        errors[field] = t(code as Parameters<typeof t>[0], { min: MIN_PASSWORD_LENGTH });
      }
      return { valid: false, errors, errorCodes };
    }

    const slug = slugifyWorkspaceName(input.workspaceName, options.existingSlugs);

    return {
      valid: true,
      redirectPath: `/workspaces/${slug}/workflows`,
      workspaceSlug: slug,
      errors: {},
      errorCodes: {},
    };
  }
}
