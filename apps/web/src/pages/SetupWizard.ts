import { slugifyWorkspaceName } from '@localflow/shared';
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

export { slugifyWorkspaceName } from '@localflow/shared';

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
