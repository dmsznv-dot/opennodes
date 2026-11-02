/**
 * LocalFlow E2E Test Suite - Specialized Assertion Helpers
 * Provides verification helpers for step statuses, timings, payload redaction, and execution journals.
 */

import * as nodeAssert from 'node:assert';
import type { WorkflowRunResult, StepExecutionRecord } from './types.ts';
import type { NodeExecutionStatus } from './types.ts';

export function assertExecutionSucceeded(result: WorkflowRunResult): void {
  nodeAssert.strictEqual(
    result.execution.status,
    'SUCCEEDED',
    `Expected execution to SUCCEED, but status was "${result.execution.status}". Error: ${result.execution.errorMessage}`
  );
}

export function assertExecutionFailed(result: WorkflowRunResult, expectedErrorSubstr?: string): void {
  nodeAssert.strictEqual(
    result.execution.status,
    'FAILED',
    `Expected execution to FAIL, but status was "${result.execution.status}"`
  );
  if (expectedErrorSubstr) {
    const errorMsg = result.execution.errorMessage || '';
    nodeAssert.ok(
      errorMsg.includes(expectedErrorSubstr),
      `Expected error message "${errorMsg}" to contain "${expectedErrorSubstr}"`
    );
  }
}

export function assertStepStatus(result: WorkflowRunResult, nodeId: string, expectedStatus: NodeExecutionStatus): StepExecutionRecord {
  const step = result.stepRecords.find(s => s.nodeId === nodeId);
  nodeAssert.ok(step, `Step record for nodeId "${nodeId}" not found in execution results`);
  nodeAssert.strictEqual(
    step.status,
    expectedStatus,
    `Expected step "${nodeId}" to have status "${expectedStatus}", but got "${step.status}"`
  );
  return step;
}

export function assertStepSucceeded(result: WorkflowRunResult, nodeId: string): StepExecutionRecord {
  return assertStepStatus(result, nodeId, 'SUCCEEDED');
}

export function assertStepSkipped(result: WorkflowRunResult, nodeId: string): StepExecutionRecord {
  return assertStepStatus(result, nodeId, 'SKIPPED');
}

export function assertStepFailed(result: WorkflowRunResult, nodeId: string): StepExecutionRecord {
  return assertStepStatus(result, nodeId, 'FAILED');
}

export function assertNodeTiming(result: WorkflowRunResult, nodeId: string, minDurationMs: number = 0, maxDurationMs?: number): void {
  const step = result.stepRecords.find(s => s.nodeId === nodeId);
  nodeAssert.ok(step, `Step record for nodeId "${nodeId}" not found`);
  nodeAssert.ok(
    step.durationMs !== undefined && step.durationMs >= minDurationMs,
    `Step "${nodeId}" duration (${step.durationMs}ms) was below expected min (${minDurationMs}ms)`
  );
  if (maxDurationMs !== undefined) {
    nodeAssert.ok(
      step.durationMs <= maxDurationMs,
      `Step "${nodeId}" duration (${step.durationMs}ms) exceeded expected max (${maxDurationMs}ms)`
    );
  }
}

export function assertPayloadRedacted(payload: unknown, sensitiveKeys: string[] = ['password', 'secret', 'token', 'apiKey', 'authorization']): void {
  const checkRedaction = (obj: unknown, path: string = ''): void => {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => checkRedaction(item, `${path}[${idx}]`));
      return;
    }

    const rec = obj as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      const val = rec[key];
      const currentPath = path ? `${path}.${key}` : key;
      const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()));

      if (isSensitive) {
        nodeAssert.strictEqual(
          val,
          '[REDACTED]',
          `Security violation: Field "${currentPath}" contains raw unredacted secret: ${JSON.stringify(val)}`
        );
      } else if (typeof val === 'object') {
        checkRedaction(val, currentPath);
      }
    }
  };

  checkRedaction(payload);
}
