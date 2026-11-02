import { z } from 'zod';
import {
  NodePortSchema,
  NodeExecutionPolicySchema,
  WorkflowNodeDataSchema,
  WorkflowNodeSchema,
  NodePositionSchema,
} from './schemas/node.js';
import { WorkflowEdgeSchema } from './schemas/edge.js';
import {
  WorkflowExecutionPolicySchema,
  WorkflowDefinitionSchema,
  WorkflowGraphSchema,
  WorkflowVersionSchema,
} from './schemas/workflow.js';
import {
  ExecutionStatusSchema,
  NodeStatusSchema,
  ExecutionEventSchema,
} from './schemas/events.js';

export type NodePort = z.infer<typeof NodePortSchema>;
export type NodeExecutionPolicy = z.infer<typeof NodeExecutionPolicySchema>;
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;
export type NodePosition = z.infer<typeof NodePositionSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export type WorkflowExecutionPolicy = z.infer<typeof WorkflowExecutionPolicySchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;

export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;
