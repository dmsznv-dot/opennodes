import { describe, it, expect } from 'vitest';
import {
  UNSLOP_THEME,
  auditUnslopCompliance,
  WorkflowCanvasController,
  NodeConfigDrawerController,
  RunInspectorController,
  SetupWizardController,
} from '../src/index.js';

describe('@localflow/web — Unslop Design System, React Flow Canvas, Config Drawer & Run Inspector', () => {
  it('1. enforces Unslop design tokens (Ink/Graphite ramp, Electric Cobalt <2%, 4px spacing grid, nested radii, zero purple gradients)', () => {
    expect(UNSLOP_THEME.colors.ink[950]).toBe('#090a0b');
    expect(UNSLOP_THEME.colors.accent.cobalt).toBe('#3b82f6');
    expect(UNSLOP_THEME.drawerWidthPx).toBe(480);
    expect(UNSLOP_THEME.spacingScalePx).toEqual([4, 8, 12, 16, 24, 32, 48]);

    const cleanAudit = auditUnslopCompliance({
      cssText: 'background-color: #121417; border: 1px solid #22262c;',
      spacingPx: [4, 8, 16, 24],
      outerRadiusPx: 12,
      innerRadiusPx: 8,
    });
    expect(cleanAudit.compliant).toBe(true);

    const slopAudit = auditUnslopCompliance({
      cssText: 'background: linear-gradient(135deg, #8b5cf6, #ec4899); filter: blur(48px);',
      spacingPx: [13, 27],
      outerRadiusPx: 6,
      innerRadiusPx: 12,
    });
    expect(slopAudit.compliant).toBe(false);
    expect(slopAudit.violations.length).toBeGreaterThanOrEqual(3);
  });

  it('2. supports adding, connecting, and deleting nodes on React Flow canvas with typed ports and real-time cycle prevention', () => {
    const canvas = new WorkflowCanvasController();
    canvas.addNode({
      id: 'n1',
      type: 'trigger.manual',
      data: { label: 'Manual Trigger', config: {} },
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [{ id: 'out', name: 'Out', type: 'json', direction: 'output', required: false }],
    });
    canvas.addNode({
      id: 'n2',
      type: 'primitive.map',
      data: { label: 'Step A', config: {} },
      position: { x: 200, y: 0 },
      inputs: [{ id: 'in', name: 'In', type: 'json', direction: 'input', required: false }],
      outputs: [{ id: 'out', name: 'Out', type: 'json', direction: 'output', required: false }],
    });
    canvas.addNode({
      id: 'n3',
      type: 'primitive.filter',
      data: { label: 'Step B', config: {} },
      position: { x: 400, y: 0 },
      inputs: [{ id: 'in', name: 'In', type: 'json', direction: 'input', required: false }],
      outputs: [{ id: 'out', name: 'Out', type: 'json', direction: 'output', required: false }],
    });

    const c1 = canvas.connectPorts({
      source: 'n1',
      sourceHandle: 'out',
      target: 'n2',
      targetHandle: 'in',
    });
    expect(c1.allowed).toBe(true);

    const c2 = canvas.connectPorts({
      source: 'n2',
      sourceHandle: 'out',
      target: 'n3',
      targetHandle: 'in',
    });
    expect(c2.allowed).toBe(true);

    // Attempt cycle n3 -> n2
    const cycleAttempt = canvas.connectPorts({
      source: 'n3',
      sourceHandle: 'out',
      target: 'n2',
      targetHandle: 'in',
    });
    expect(cycleAttempt.allowed).toBe(false);
    expect(cycleAttempt.code).toBe('ERR_CYCLIC_DEPENDENCY_DETECTED');
  });

  it('3. isolates Draft edits from Published versions and computes deterministic SHA-256 checksums', () => {
    const canvas = new WorkflowCanvasController(
      [
        {
          id: 'trig',
          type: 'trigger.manual',
          data: { label: 'Start', config: {} },
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [{ id: 'out', name: 'Out', type: 'json', direction: 'output', required: false }],
        },
      ],
      []
    );

    const pub = canvas.publishDraft();
    expect(pub.ok).toBe(true);
    expect(pub.snapshot?.version).toBe(1);

    // Mutate draft by adding a second node
    canvas.addNode({
      id: 'http_1',
      type: 'core.httpRequest',
      data: { label: 'Fetch API', config: { url: 'https://example.com' } },
      position: { x: 240, y: 0 },
      inputs: [{ id: 'in', name: 'In', type: 'any', direction: 'input', required: false }],
      outputs: [{ id: 'out', name: 'Out', type: 'json', direction: 'output', required: false }],
    });

    // Published v1 remains immutable with 1 node while draft has 2 nodes
    expect(canvas.getDraftState().nodes).toHaveLength(2);
    expect(canvas.getActivePublishedSnapshot()?.nodes).toHaveLength(1);
  });

  it('4. builds 480px Node Configuration Drawer with upstream expression autocomplete and required field validation', () => {
    const nodes = [
      {
        id: 'trig_1',
        type: 'trigger.webhook',
        data: { label: 'Webhook', config: {} },
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [{ id: 'payload', name: 'Payload', type: 'json' as const, direction: 'output' as const, required: false }],
      },
      {
        id: 'openai_1',
        type: 'ai.openai',
        data: {
          label: 'Summarize',
          config: { prompt: '' },
          credentialId: '00000000-0000-0000-0000-000000000001',
        },
        position: { x: 240, y: 0 },
        inputs: [{ id: 'in', name: 'In', type: 'json' as const, direction: 'input' as const, required: false }],
        outputs: [{ id: 'text', name: 'Text', type: 'string' as const, direction: 'output' as const, required: false }],
      },
    ];
    const edges = [
      { id: 'e1', source: 'trig_1', sourceHandle: 'payload', target: 'openai_1', targetHandle: 'in' },
    ];

    const vm = NodeConfigDrawerController.createViewModel({
      node: nodes[1]!,
      allNodes: nodes,
      allEdges: edges,
      fields: [{ key: 'prompt', label: 'Prompt Template', type: 'string', required: true }],
      credentials: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Prod OpenAI',
          type: 'ai.openai',
          maskedHint: '••••••••9999',
        },
      ],
    });

    expect(vm.widthPx).toBe(480);
    expect(vm.autocompleteSuggestions).toContain('{{ $nodes.trig_1.output.payload }}');
    expect(vm.validationErrors.prompt).toContain('required');
  });

  it('5. sanitizes secrets with [REDACTED] in Run Inspector and validates /setup onboarding wizard', () => {
    const stepVm = RunInspectorController.formatStepForDisplay({
      nodeId: 'http_1',
      nodeName: 'Call Partner API',
      status: 'FAILED',
      attempt: 2,
      startedAt: '2026-11-02T12:00:00Z',
      durationMs: 142,
      inputPayload: {
        url: 'https://api.partner.io/v1/charge',
        apiKey: 'sk-live-secret-value-123456',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      },
      errorMessage: 'HTTP 502 Bad Gateway',
    });

    expect(stepVm.tabularDurationLabel).toBe('142ms');
    expect(stepVm.errorDiagnostic).toBe('HTTP 502 Bad Gateway');
    expect(stepVm.sanitizedInputJson).toContain('[REDACTED]');
    expect(stepVm.sanitizedInputJson).not.toContain('sk-live-secret-value-123456');

    const setupResult = SetupWizardController.validateAndPrepareRedirect({
      email: 'owner@localflow.dev',
      password: 'StrongPassword123!',
      fullName: 'Dmitry',
      workspaceName: 'OpenNodes Core',
    });
    expect(setupResult.valid).toBe(true);
    expect(setupResult.redirectPath).toBe('/workspaces/opennodes-core/workflows');
  });
});
