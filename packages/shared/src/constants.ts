export const PORT_TYPES = [
  'trigger',
  'json',
  'string',
  'number',
  'boolean',
  'binary',
  'any',
  'text',
  'context',
  'prompt',
  'imageAsset',
  'imageCollection',
  'document',
  'modelConfig',
] as const;

export type PortType = (typeof PORT_TYPES)[number];

export const PORT_DIRECTIONS = ['input', 'output'] as const;
export type PortDirection = (typeof PORT_DIRECTIONS)[number];

export const WORKFLOW_MAX_NODES = 250;
export const WORKFLOW_MAX_EDGES = 500;
export const WORKFLOW_DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
export const NODE_DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
