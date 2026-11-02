import { describe, it, expect } from 'vitest';
import {
  LocalFlowError,
  ValidationError,
  CycleError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  SSRFError,
} from '../src/errors.js';

describe('LocalFlowError classes', () => {
  it('instantiates LocalFlowError with default code and status', () => {
    const err = new LocalFlowError('Something went wrong');
    expect(err.message).toBe('Something went wrong');
    expect(err.code).toBe('ERR_INTERNAL');
    expect(err.statusCode).toBe(500);
    expect(err.toJSON()).toEqual({
      name: 'LocalFlowError',
      code: 'ERR_INTERNAL',
      message: 'Something went wrong',
      statusCode: 500,
      details: undefined,
    });
  });

  it('instantiates ValidationError with 400 status', () => {
    const err = new ValidationError('Invalid node configuration', { field: 'url' });
    expect(err.code).toBe('ERR_VALIDATION');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: 'url' });
  });

  it('instantiates CycleError with cycleNodes', () => {
    const err = new CycleError('Cycle detected', ['nodeA', 'nodeB', 'nodeA']);
    expect(err.code).toBe('ERR_CYCLIC_DEPENDENCY_DETECTED');
    expect(err.statusCode).toBe(400);
    expect(err.cycleNodes).toEqual(['nodeA', 'nodeB', 'nodeA']);
  });

  it('instantiates NotFoundError with 404', () => {
    const err = new NotFoundError('Workflow', '123');
    expect(err.code).toBe('ERR_NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('instantiates UnauthorizedError and ForbiddenError', () => {
    const unauth = new UnauthorizedError();
    expect(unauth.statusCode).toBe(401);
    const forb = new ForbiddenError();
    expect(forb.statusCode).toBe(403);
    const ssrf = new SSRFError('Blocked target');
    expect(ssrf.statusCode).toBe(403);
  });
});
