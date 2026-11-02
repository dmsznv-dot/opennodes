/**
 * Base domain error for all LocalFlow errors
 */
export class LocalFlowError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code = 'ERR_INTERNAL', statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
    };
  }
}

export class ValidationError extends LocalFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ERR_VALIDATION', 400, details);
  }
}

export class CycleError extends LocalFlowError {
  public readonly cycleNodes: string[];

  constructor(message: string, cycleNodes: string[] = [], details?: Record<string, unknown>) {
    super(message, 'ERR_CYCLIC_DEPENDENCY_DETECTED', 400, { ...details, cycleNodes });
    this.cycleNodes = cycleNodes;
  }
}

export class NotFoundError extends LocalFlowError {
  constructor(resource: string, id: string) {
    super(`${resource} with ID '${id}' not found`, 'ERR_NOT_FOUND', 404, { resource, id });
  }
}

export class UnauthorizedError extends LocalFlowError {
  constructor(message = 'Unauthorized') {
    super(message, 'ERR_UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends LocalFlowError {
  constructor(message = 'Forbidden: Insufficient workspace permissions') {
    super(message, 'ERR_FORBIDDEN', 403);
  }
}

export class SSRFError extends LocalFlowError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ERR_SSRF_BLOCKED', 403, details);
  }
}
