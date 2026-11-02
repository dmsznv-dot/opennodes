import { describe, it, expect } from 'vitest';
import {
  NodePortSchema,
  WorkflowNodeSchema,
  WorkflowEdgeSchema,
  WorkflowDefinitionSchema,
  WorkflowVersionSchema,
} from '../src/index.js';

describe('Workflow Zod Schemas', () => {
  it('validates a correct NodePort', () => {
    const port = {
      id: 'main_out',
      name: 'Output',
      type: 'json',
      direction: 'output',
      required: false,
    };
    const parsed = NodePortSchema.parse(port);
    expect(parsed.id).toBe('main_out');
    expect(parsed.type).toBe('json');
  });

  it('rejects invalid port type', () => {
    const badPort = {
      id: 'main',
      name: 'Bad',
      type: 'invalid_type',
      direction: 'output',
    };
    expect(() => NodePortSchema.parse(badPort)).toThrow();
  });

  it('validates a complete WorkflowNode', () => {
    const node = {
      id: 'node_1',
      type: 'core.httpRequest',
      data: {
        label: 'Fetch User',
        config: { url: 'https://api.example.com/users' },
      },
      inputs: [
        {
          id: 'trigger',
          name: 'Trigger',
          type: 'trigger',
          direction: 'input',
        },
      ],
      outputs: [
        {
          id: 'data',
          name: 'Data',
          type: 'json',
          direction: 'output',
        },
      ],
      position: { x: 100, y: 200 },
    };
    const parsed = WorkflowNodeSchema.parse(node);
    expect(parsed.id).toBe('node_1');
    expect(parsed.inputs).toHaveLength(1);
    expect(parsed.outputs).toHaveLength(1);
  });

  it('validates WorkflowEdge', () => {
    const edge = {
      id: 'edge_1',
      source: 'node_1',
      sourceHandle: 'data',
      target: 'node_2',
      targetHandle: 'input',
    };
    const parsed = WorkflowEdgeSchema.parse(edge);
    expect(parsed.source).toBe('node_1');
  });

  it('validates WorkflowDefinition', () => {
    const wf = {
      id: 'wf_123',
      workspaceId: 'ws_456',
      name: 'Customer Onboarding',
      nodes: [
        {
          id: 'trigger_1',
          type: 'trigger.manual',
          data: { label: 'Start', config: {} },
          inputs: [],
          outputs: [{ id: 'out', name: 'Out', type: 'trigger', direction: 'output' }],
        },
      ],
      edges: [],
    };
    const parsed = WorkflowDefinitionSchema.parse(wf);
    expect(parsed.name).toBe('Customer Onboarding');
    expect(parsed.schemaVersion).toBe('1.0');
  });

  it('validates WorkflowVersion with 64-char SHA-256 checksum', () => {
    const checksum = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const version = {
      id: 'ver_1',
      workflowId: 'wf_123',
      versionNumber: 1,
      isDraft: false,
      snapshot: {
        id: 'wf_123',
        workspaceId: 'ws_456',
        name: 'Workflow 1',
        nodes: [],
        edges: [],
      },
      checksum,
    };
    const parsed = WorkflowVersionSchema.parse(version);
    expect(parsed.versionNumber).toBe(1);
    expect(parsed.checksum).toBe(checksum);
  });
});
