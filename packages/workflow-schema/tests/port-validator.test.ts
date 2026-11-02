import { describe, it, expect } from 'vitest';
import { arePortsCompatible } from '../src/validation/port-validator.js';

describe('Port Validator', () => {
  it('allows same type connections', () => {
    expect(arePortsCompatible('string', 'string')).toBe(true);
    expect(arePortsCompatible('json', 'json')).toBe(true);
    expect(arePortsCompatible('number', 'number')).toBe(true);
    expect(arePortsCompatible('boolean', 'boolean')).toBe(true);
    expect(arePortsCompatible('trigger', 'trigger')).toBe(true);
  });

  it('allows any to connect to anything and anything to any', () => {
    expect(arePortsCompatible('any', 'json')).toBe(true);
    expect(arePortsCompatible('string', 'any')).toBe(true);
    expect(arePortsCompatible('any', 'trigger')).toBe(true);
  });

  it('allows primitive types to feed JSON input', () => {
    expect(arePortsCompatible('string', 'json')).toBe(true);
    expect(arePortsCompatible('number', 'json')).toBe(true);
    expect(arePortsCompatible('boolean', 'json')).toBe(true);
  });

  it('rejects trigger connecting to non-trigger non-any', () => {
    expect(arePortsCompatible('trigger', 'json')).toBe(false);
    expect(arePortsCompatible('trigger', 'string')).toBe(false);
    expect(arePortsCompatible('json', 'trigger')).toBe(false);
  });

  it('rejects incompatible types', () => {
    expect(arePortsCompatible('string', 'number')).toBe(false);
    expect(arePortsCompatible('number', 'string')).toBe(false);
    expect(arePortsCompatible('binary', 'number')).toBe(false);
  });
});
