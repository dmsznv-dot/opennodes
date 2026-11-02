import { LocalFlowError } from '@localflow/shared';

export class EncryptionError extends LocalFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ERR_ENCRYPTION_FAILED', 500, details);
  }
}

export class DecryptionFailedError extends LocalFlowError {
  constructor(message = 'Decryption failed: integrity check or authentication tag mismatch.') {
    super(message, 'ERR_DECRYPTION_FAILED', 400);
  }
}

export class InvalidKeyError extends LocalFlowError {
  constructor(message: string) {
    super(message, 'ERR_INVALID_KEY', 500);
  }
}

export class KeyVersionNotFoundError extends LocalFlowError {
  constructor(message: string) {
    super(message, 'ERR_KEY_VERSION_NOT_FOUND', 500);
  }
}
