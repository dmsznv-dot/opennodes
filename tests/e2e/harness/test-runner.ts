/**
 * LocalFlow E2E Test Suite - Universal Test Runner Adapter
 * Provides describe, it, test, beforeEach, afterEach, expect bridging node:test and vitest.
 */

import * as nodeTest from 'node:test';
import { expect, Expectation } from './expect.ts';

export { expect, Expectation };

export const describe = nodeTest.describe;
export const it = nodeTest.it;
export const test = nodeTest.test;
export const beforeEach = nodeTest.beforeEach;
export const afterEach = nodeTest.afterEach;
export const before = nodeTest.before;
export const after = nodeTest.after;
