import { SSRFError } from '../errors.js';

export class SsrfBlockedError extends SSRFError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class DisallowedProtocolError extends SSRFError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}
