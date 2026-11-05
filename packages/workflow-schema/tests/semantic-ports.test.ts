import { describe, it, expect } from 'vitest';
import { NodePortSchema, WorkflowDefinitionSchema, arePortsCompatible } from '../src/index.js';

describe('semantic ports', () => {
  for (const type of ['text', 'context', 'prompt', 'imageAsset', 'imageCollection', 'document', 'modelConfig']) {
    it(`accepts ${type} as a first-class port`, () => {
      expect(NodePortSchema.safeParse({ id: 'x', name: 'Input', type, direction: 'input' }).success).toBe(true);
    });
  }
  it('maps text to legacy string without converting text into an image', () => {
    expect(arePortsCompatible('text' as never, 'string')).toBe(true);
    expect(arePortsCompatible('string', 'text' as never)).toBe(true);
    expect(arePortsCompatible('text' as never, 'imageAsset' as never)).toBe(false);
    expect(arePortsCompatible('json', 'imageAsset' as never)).toBe(false);
  });
  it('reads both schema versions without upgrading an existing snapshot implicitly', () => {
    const input = { id: 'w', workspaceId: 'ws', name: 'old', nodes: [], edges: [] };
    expect(WorkflowDefinitionSchema.parse(input).schemaVersion).toBe('1.0');
    expect(WorkflowDefinitionSchema.parse({ ...input, schemaVersion: '1.1' }).schemaVersion).toBe('1.1');
  });
});
