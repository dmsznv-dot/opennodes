import { WorkflowNode, WorkflowEdge } from '../types.js';
import { detectCycles } from './cycle-detector.js';
import { arePortsCompatible } from './port-validator.js';
import { isSafePortBinding, isSafePortValuePath } from '../schemas/node.js';

export interface GraphValidationError {
  code:
    | 'ERR_CYCLIC_DEPENDENCY_DETECTED'
    | 'ERR_SOURCE_NODE_NOT_FOUND'
    | 'ERR_TARGET_NODE_NOT_FOUND'
    | 'ERR_SOURCE_HANDLE_NOT_FOUND'
    | 'ERR_TARGET_HANDLE_NOT_FOUND'
    | 'ERR_PORT_DIRECTION_INVALID'
    | 'ERR_PORT_INCOMPATIBLE'
    | 'ERR_MISSING_TRIGGER'
    | 'ERR_MULTIPLE_TRIGGERS'
    | 'ERR_DUPLICATE_NODE_ID'
    | 'ERR_DUPLICATE_EDGE_ID'
    | 'ERR_INPUT_ALREADY_CONNECTED'
    | 'ERR_REQUIRED_INPUT_MISSING'
    | 'ERR_INVALID_PORT_CONFIGURATION'
    | 'ERR_CONTEXT_LINK';
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
  details?: Record<string, unknown>;
}

export interface GraphValidationWarning {
  code: 'WARN_DISCONNECTED_NODE' | 'WARN_UNUSED_TRIGGER';
  message: string;
  nodeIds?: string[];
}

export interface GraphValidationResult {
  valid: boolean;
  errors: GraphValidationError[];
  warnings: GraphValidationWarning[];
  topologicalOrder?: string[];
}

/**
 * Context steps (a brand voice, a prompt template) give settings to the steps they lead
 * into, not data. Which steps may take each one, and whether it takes anything itself.
 * The editor derives the same rules from its catalog (docs/engine.js `linkProblem`).
 */
export const CONTEXT_LINKS: Record<string, { consumers: readonly string[]; inputs: boolean }> = {
  'context.voice': { consumers: ['ai.process', 'ai.review'], inputs: false },
  'context.prompt': { consumers: ['ai.process'], inputs: true },
  'context.model': { consumers: ['ai.process', 'ai.review'], inputs: false },
};

const isContext = (type: string | undefined) => Boolean(type && CONTEXT_LINKS[type]);

export interface ValidateGraphOptions {
  requireSingleTrigger?: boolean; // Default true for publication/execution
}

/**
 * Performs full validation of a workflow graph:
 * - Duplicate IDs
 * - Dangling edges (missing node or missing port handles)
 * - Port directions (output -> input only)
 * - Port type compatibility
 * - Single trigger rule (Manual, Cron, Webhook, Telegram Polling)
 * - Cycle detection via Kahn's algorithm
 */
export function validateWorkflowGraph(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  options: ValidateGraphOptions = { requireSingleTrigger: true }
): GraphValidationResult {
  const errors: GraphValidationError[] = [];
  const warnings: GraphValidationWarning[] = [];

  // 1. Check duplicate node IDs
  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    if (nodeMap.has(node.id)) {
      errors.push({
        code: 'ERR_DUPLICATE_NODE_ID',
        message: `Duplicate node ID detected: '${node.id}'`,
        nodeIds: [node.id],
      });
    } else {
      nodeMap.set(node.id, node);
    }
    for (const port of [...(node.inputs ?? []), ...(node.outputs ?? [])]) {
      if (
        (port.binding !== undefined &&
          (!isSafePortBinding(port.binding) || port.direction !== 'input')) ||
        (port.valuePath !== undefined &&
          (!isSafePortValuePath(port.valuePath) || port.direction !== 'output'))
      ) {
        errors.push({
          code: 'ERR_INVALID_PORT_CONFIGURATION',
          message: `Node '${node.id}' port '${port.id}' has an invalid binding or value path`,
          nodeIds: [node.id],
        });
      }
    }
    for (const port of (node.inputs ?? []).filter((p) => p.binding)) {
      const connected = edges.filter(
        (e) =>
          e.target === node.id &&
          node.inputs.find((p) => p.id === e.targetHandle)?.binding === port.binding
      );
      if (connected.length > 1 && connected[0]?.targetHandle === port.id) {
        errors.push({
          code: 'ERR_INPUT_ALREADY_CONNECTED',
          message: `Input '${node.id}:${port.id}' (${port.binding}) accepts only one connection`,
          nodeIds: [node.id],
          edgeIds: connected.map((e) => e.id),
        });
      }
      const configured =
        Object.prototype.hasOwnProperty.call(node.data.config, port.binding!) &&
        node.data.config[port.binding!] !== undefined &&
        node.data.config[port.binding!] !== null &&
        node.data.config[port.binding!] !== '';
      if (port.required && !node.data.disabled && connected.length === 0 && !configured) {
        errors.push({
          code: 'ERR_REQUIRED_INPUT_MISSING',
          message: `Required input '${node.id}:${port.id}' (${port.binding}) needs a connection or a configured value`,
          nodeIds: [node.id],
        });
      }
    }
  }

  // 2. Check duplicate edge IDs
  const edgeIdSet = new Set<string>();
  for (const edge of edges) {
    if (edgeIdSet.has(edge.id)) {
      errors.push({
        code: 'ERR_DUPLICATE_EDGE_ID',
        message: `Duplicate edge ID detected: '${edge.id}'`,
        edgeIds: [edge.id],
      });
    } else {
      edgeIdSet.add(edge.id);
    }
  }

  // 3. Check trigger constraint
  const triggerNodes = nodes.filter((n) =>
    Boolean(n.type?.startsWith('trigger.') || n.type?.startsWith('trigger_'))
  );
  if (options.requireSingleTrigger) {
    if (triggerNodes.length === 0) {
      errors.push({
        code: 'ERR_MISSING_TRIGGER',
        message:
          'Workflow must contain exactly one trigger node (Manual, Cron, Webhook, or Telegram Polling).',
      });
    } else if (triggerNodes.length > 1) {
      errors.push({
        code: 'ERR_MULTIPLE_TRIGGERS',
        message: `Workflow contains ${triggerNodes.length} triggers. Exactly one root trigger is permitted.`,
        nodeIds: triggerNodes.map((n) => n.id),
      });
    }
  }

  // 4. Validate edges, handles, and port compatibility
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    if (!sourceNode) {
      errors.push({
        code: 'ERR_SOURCE_NODE_NOT_FOUND',
        message: `Edge '${edge.id}' references non-existent source node '${edge.source}'`,
        edgeIds: [edge.id],
      });
      continue;
    }

    if (!targetNode) {
      errors.push({
        code: 'ERR_TARGET_NODE_NOT_FOUND',
        message: `Edge '${edge.id}' references non-existent target node '${edge.target}'`,
        edgeIds: [edge.id],
      });
      continue;
    }

    const sourcePort = sourceNode.outputs?.find((p) => p.id === edge.sourceHandle);
    if (!sourcePort) {
      errors.push({
        code: 'ERR_SOURCE_HANDLE_NOT_FOUND',
        message: `Edge '${edge.id}' references non-existent output handle '${edge.sourceHandle}' on node '${edge.source}'`,
        nodeIds: [edge.source],
        edgeIds: [edge.id],
      });
    } else if (sourcePort.direction !== 'output') {
      errors.push({
        code: 'ERR_PORT_DIRECTION_INVALID',
        message: `Edge '${edge.id}' connects from handle '${edge.sourceHandle}' which is not an output port`,
        nodeIds: [edge.source],
        edgeIds: [edge.id],
      });
    }

    const targetPort = targetNode.inputs?.find((p) => p.id === edge.targetHandle);
    if (!targetPort) {
      errors.push({
        code: 'ERR_TARGET_HANDLE_NOT_FOUND',
        message: `Edge '${edge.id}' references non-existent input handle '${edge.targetHandle}' on node '${edge.target}'`,
        nodeIds: [edge.target],
        edgeIds: [edge.id],
      });
    } else if (targetPort.direction !== 'input') {
      errors.push({
        code: 'ERR_PORT_DIRECTION_INVALID',
        message: `Edge '${edge.id}' connects to handle '${edge.targetHandle}' which is not an input port`,
        nodeIds: [edge.target],
        edgeIds: [edge.id],
      });
    }

    // Context steps: only into the steps that use them; a voice takes nothing itself.
    const contextProblem =
      edge.kind === 'context' && !isContext(sourceNode.type)
        ? 'a context dependency must originate from a context step'
        : isContext(sourceNode.type)
          ? isContext(targetNode.type)
            ? 'a context step cannot lead into another context step'
            : !CONTEXT_LINKS[sourceNode.type]!.consumers.includes(targetNode.type)
              ? `'${sourceNode.type}' links only to ${CONTEXT_LINKS[sourceNode.type]!.consumers.join(', ')}`
              : null
          : isContext(targetNode.type) && !CONTEXT_LINKS[targetNode.type]!.inputs
            ? `'${targetNode.type}' takes no data from other steps`
            : null;
    if (contextProblem) {
      errors.push({
        code: 'ERR_CONTEXT_LINK',
        message: `Edge '${edge.id}' from '${edge.source}' to '${edge.target}': ${contextProblem}`,
        nodeIds: [edge.source, edge.target],
        edgeIds: [edge.id],
      });
    }

    // Port compatibility check
    if (sourcePort && targetPort) {
      if (!arePortsCompatible(sourcePort.type, targetPort.type)) {
        errors.push({
          code: 'ERR_PORT_INCOMPATIBLE',
          message: `Incompatible port connection between '${edge.source}:${sourcePort.id}' (${sourcePort.type}) and '${edge.target}:${targetPort.id}' (${targetPort.type})`,
          nodeIds: [edge.source, edge.target],
          edgeIds: [edge.id],
          details: {
            sourceType: sourcePort.type,
            targetType: targetPort.type,
          },
        });
      }
    }
  }

  // 5. Run Kahn's Cycle Detection
  const cycleResult = detectCycles(nodes, edges);
  if (cycleResult.hasCycle) {
    errors.push({
      code: 'ERR_CYCLIC_DEPENDENCY_DETECTED',
      message: `Cycle detected involving nodes: ${cycleResult.cycleNodes.join(', ')}. Path: ${cycleResult.cyclePath.join(' -> ')}`,
      nodeIds: cycleResult.cycleNodes,
      details: {
        cycleNodes: cycleResult.cycleNodes,
        cyclePath: cycleResult.cyclePath,
      },
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    topologicalOrder: cycleResult.hasCycle ? undefined : cycleResult.topologicalOrder,
  };
}
