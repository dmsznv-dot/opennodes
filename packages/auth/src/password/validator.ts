export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];
  if (!password || password.length < 8) {
    errors.push('Password must be at least 8 characters in length.');
  }
  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters.');
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
