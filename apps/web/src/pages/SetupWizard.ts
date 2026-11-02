export interface SetupWizardFormInput {
  email: string;
  password: string;
  fullName: string;
  workspaceName: string;
}

export interface SetupWizardSubmissionResult {
  valid: boolean;
  redirectPath?: string;
  errors: Record<string, string>;
}

/**
 * `/setup` Initial Instance Bootstrap & Owner Onboarding Wizard Controller
 */
export class SetupWizardController {
  public static validateAndPrepareRedirect(
    input: SetupWizardFormInput,
    alreadyBootstrapped = false
  ): SetupWizardSubmissionResult {
    if (alreadyBootstrapped) {
      return {
        valid: false,
        redirectPath: '/login',
        errors: { form: 'Instance is already bootstrapped. Redirecting to login.' },
      };
    }

    const errors: Record<string, string> = {};
    if (!input.email || !input.email.includes('@')) {
      errors.email = 'Enter a valid owner email address.';
    }
    if (!input.password || input.password.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    }
    if (!input.workspaceName || input.workspaceName.trim().length < 2) {
      errors.workspaceName = 'Workspace name is required.';
    }

    if (Object.keys(errors).length > 0) {
      return { valid: false, errors };
    }

    const slug =
      input.workspaceName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'primary';

    return {
      valid: true,
      redirectPath: `/workspaces/${slug}/workflows`,
      errors: {},
    };
  }
}
