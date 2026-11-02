/**
 * LocalFlow E2E Test Suite - Expect Assertion Library
 * Provides Jest/Vitest-compatible assertions with full support for both Vitest and Node native test runner.
 */

import * as nodeAssert from 'node:assert';

export class AssertionPromiseHandler<T> {
  private promise: Promise<T>;
  private isNot: boolean;

  constructor(promise: Promise<T>, isNot: boolean = false) {
    this.promise = promise;
    this.isNot = isNot;
  }

  async toThrow(expectedError?: string | RegExp | ErrorConstructor): Promise<void> {
    let thrownError: unknown = null;
    try {
      await this.promise;
    } catch (err) {
      thrownError = err;
    }

    if (this.isNot) {
      if (thrownError) {
        throw new nodeAssert.AssertionError({
          message: `Expected promise NOT to throw, but it threw: ${String(thrownError)}`,
          actual: thrownError,
          expected: undefined
        });
      }
      return;
    }

    if (!thrownError) {
      throw new nodeAssert.AssertionError({
        message: 'Expected promise to throw an error, but it resolved successfully',
        actual: undefined,
        expected: expectedError || 'Error'
      });
    }

    if (expectedError) {
      const msg = thrownError instanceof Error ? thrownError.message : String(thrownError);
      if (typeof expectedError === 'string') {
        if (!msg.includes(expectedError)) {
          throw new nodeAssert.AssertionError({
            message: `Expected error message "${msg}" to contain "${expectedError}"`,
            actual: msg,
            expected: expectedError
          });
        }
      } else if (expectedError instanceof RegExp) {
        if (!expectedError.test(msg)) {
          throw new nodeAssert.AssertionError({
            message: `Expected error message "${msg}" to match regex ${expectedError}`,
            actual: msg,
            expected: expectedError
          });
        }
      } else if (typeof expectedError === 'function') {
        if (!(thrownError instanceof expectedError)) {
          throw new nodeAssert.AssertionError({
            message: `Expected thrown error to be instance of ${expectedError.name}`,
            actual: thrownError,
            expected: expectedError.name
          });
        }
      }
    }
  }
}

export class Expectation<T = unknown> {
  private actual: T;
  private isNot: boolean;

  constructor(actual: T, isNot: boolean = false) {
    this.actual = actual;
    this.isNot = isNot;
  }

  get not(): Expectation<T> {
    return new Expectation(this.actual, !this.isNot);
  }

  get rejects(): AssertionPromiseHandler<unknown> {
    if (!(this.actual instanceof Promise)) {
      throw new Error('rejects can only be called on a Promise');
    }
    return new AssertionPromiseHandler(this.actual, this.isNot);
  }

  get resolves(): Expectation<Promise<unknown>> {
    // Returns un-awaited wrapper
    return this as unknown as Expectation<Promise<unknown>>;
  }

  toBe(expected: unknown): void {
    const pass = Object.is(this.actual, expected);
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${JSON.stringify(this.actual)} NOT to be ${JSON.stringify(expected)}`,
        actual: this.actual,
        expected
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${JSON.stringify(this.actual)} to be ${JSON.stringify(expected)}`,
        actual: this.actual,
        expected
      });
    }
  }

  toEqual(expected: unknown): void {
    let pass = true;
    try {
      nodeAssert.deepStrictEqual(this.actual, expected);
    } catch {
      pass = false;
    }

    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected deep inequality, but values are strictly equal: ${JSON.stringify(this.actual)}`,
        actual: this.actual,
        expected
      });
    } else if (!this.isNot && !pass) {
      nodeAssert.deepStrictEqual(this.actual, expected);
    }
  }

  toBeDefined(): void {
    const pass = this.actual !== undefined;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: 'Expected value to be undefined, but it was defined',
        actual: this.actual,
        expected: undefined
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: 'Expected value to be defined, but received undefined',
        actual: this.actual,
        expected: 'defined'
      });
    }
  }

  toBeUndefined(): void {
    const pass = this.actual === undefined;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: 'Expected value NOT to be undefined',
        actual: this.actual,
        expected: 'defined'
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected undefined, but received ${JSON.stringify(this.actual)}`,
        actual: this.actual,
        expected: undefined
      });
    }
  }

  toBeTruthy(): void {
    const pass = Boolean(this.actual);
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected value NOT to be truthy, but got ${this.actual}`,
        actual: this.actual,
        expected: false
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected value to be truthy, but got ${this.actual}`,
        actual: this.actual,
        expected: true
      });
    }
  }

  toBeFalsy(): void {
    const pass = !this.actual;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected value NOT to be falsy, but got ${this.actual}`,
        actual: this.actual,
        expected: true
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected value to be falsy, but got ${this.actual}`,
        actual: this.actual,
        expected: false
      });
    }
  }

  toBeNull(): void {
    const pass = this.actual === null;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: 'Expected value NOT to be null',
        actual: this.actual,
        expected: 'not null'
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected null, but received ${JSON.stringify(this.actual)}`,
        actual: this.actual,
        expected: null
      });
    }
  }

  toBeGreaterThan(expected: number): void {
    const pass = (this.actual as number) > expected;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${this.actual} NOT to be greater than ${expected}`,
        actual: this.actual,
        expected
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${this.actual} to be greater than ${expected}`,
        actual: this.actual,
        expected
      });
    }
  }

  toBeGreaterThanOrEqual(expected: number): void {
    const pass = (this.actual as number) >= expected;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${this.actual} NOT to be greater than or equal to ${expected}`,
        actual: this.actual,
        expected
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${this.actual} to be greater than or equal to ${expected}`,
        actual: this.actual,
        expected
      });
    }
  }

  toBeLessThan(expected: number): void {
    const pass = (this.actual as number) < expected;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${this.actual} NOT to be less than ${expected}`,
        actual: this.actual,
        expected
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${this.actual} to be less than ${expected}`,
        actual: this.actual,
        expected
      });
    }
  }

  toBeLessThanOrEqual(expected: number): void {
    const pass = (this.actual as number) <= expected;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${this.actual} NOT to be less than or equal to ${expected}`,
        actual: this.actual,
        expected
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${this.actual} to be less than or equal to ${expected}`,
        actual: this.actual,
        expected
      });
    }
  }

  toContain(item: unknown): void {
    let pass = false;
    if (typeof this.actual === 'string' && typeof item === 'string') {
      pass = this.actual.includes(item);
    } else if (Array.isArray(this.actual)) {
      pass = this.actual.some(el => {
        try {
          nodeAssert.deepStrictEqual(el, item);
          return true;
        } catch {
          return false;
        }
      });
    } else if (this.actual instanceof Set) {
      pass = this.actual.has(item);
    }

    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected collection NOT to contain ${JSON.stringify(item)}`,
        actual: this.actual,
        expected: item
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected ${JSON.stringify(this.actual)} to contain ${JSON.stringify(item)}`,
        actual: this.actual,
        expected: item
      });
    }
  }

  toContainEqual(item: unknown): void {
    this.toContain(item);
  }

  toHaveLength(expectedLen: number): void {
    const len = (this.actual as { length?: number })?.length;
    const pass = len === expectedLen;
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected length NOT to be ${expectedLen}`,
        actual: len,
        expected: expectedLen
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected length to be ${expectedLen}, got ${len}`,
        actual: len,
        expected: expectedLen
      });
    }
  }

  toMatch(regex: RegExp | string): void {
    const r = typeof regex === 'string' ? new RegExp(regex) : regex;
    const pass = r.test(String(this.actual));
    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected "${this.actual}" NOT to match ${r}`,
        actual: this.actual,
        expected: r
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected "${this.actual}" to match ${r}`,
        actual: this.actual,
        expected: r
      });
    }
  }

  toHaveProperty(prop: string, expectedVal?: unknown): void {
    const obj = this.actual as Record<string, unknown>;
    const hasProp = obj != null && Object.prototype.hasOwnProperty.call(obj, prop);
    let pass = hasProp;
    if (pass && expectedVal !== undefined) {
      try {
        nodeAssert.deepStrictEqual(obj[prop], expectedVal);
      } catch {
        pass = false;
      }
    }

    if (this.isNot && pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected object NOT to have property "${prop}" with matching value`,
        actual: obj,
        expected: prop
      });
    } else if (!this.isNot && !pass) {
      throw new nodeAssert.AssertionError({
        message: `Expected object to have property "${prop}" (expected: ${JSON.stringify(expectedVal)}, actual: ${JSON.stringify(obj?.[prop])})`,
        actual: obj?.[prop],
        expected: expectedVal
      });
    }
  }

  toThrow(expectedError?: string | RegExp | ErrorConstructor): void {
    if (typeof this.actual !== 'function') {
      throw new Error('toThrow requires a function as actual value');
    }

    let thrownError: unknown = null;
    try {
      (this.actual as () => void)();
    } catch (err) {
      thrownError = err;
    }

    if (this.isNot) {
      if (thrownError) {
        throw new nodeAssert.AssertionError({
          message: `Expected function NOT to throw, but it threw: ${String(thrownError)}`,
          actual: thrownError,
          expected: undefined
        });
      }
      return;
    }

    if (!thrownError) {
      throw new nodeAssert.AssertionError({
        message: 'Expected function to throw an error, but it returned without throwing',
        actual: undefined,
        expected: expectedError || 'Error'
      });
    }

    if (expectedError) {
      const msg = thrownError instanceof Error ? thrownError.message : String(thrownError);
      if (typeof expectedError === 'string') {
        if (!msg.includes(expectedError)) {
          throw new nodeAssert.AssertionError({
            message: `Expected error message "${msg}" to contain "${expectedError}"`,
            actual: msg,
            expected: expectedError
          });
        }
      } else if (expectedError instanceof RegExp) {
        if (!expectedError.test(msg)) {
          throw new nodeAssert.AssertionError({
            message: `Expected error message "${msg}" to match ${expectedError}`,
            actual: msg,
            expected: expectedError
          });
        }
      } else if (typeof expectedError === 'function') {
        if (!(thrownError instanceof expectedError)) {
          throw new nodeAssert.AssertionError({
            message: `Expected error to be instance of ${expectedError.name}`,
            actual: thrownError,
            expected: expectedError.name
          });
        }
      }
    }
  }
}

export function expect<T = unknown>(actual: T): Expectation<T> {
  return new Expectation(actual);
}
