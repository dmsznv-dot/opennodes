import type { WorkflowEdge, WorkflowNode } from '@localflow/workflow-schema';
import { UNSLOP_THEME } from '../theme/unslop.js';

export interface ConfigFieldDefinition {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'select' | 'secret_ref';
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface CredentialVaultOption {
  id: string;
  name: string;
  type: string;
  maskedHint: string;
}

export interface ConfigDrawerViewModel {
  isOpen: boolean;
  widthPx: number;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  fields: ConfigFieldDefinition[];
  values: Record<string, unknown>;
  selectedCredentialId?: string;
  availableCredentials: CredentialVaultOption[];
  autocompleteSuggestions: string[];
  validationErrors: Record<string, string>;
}

/**
 * 480px Right-Side Node Configuration Drawer Controller
 * Generates schema-driven fields, computes upstream `$trigger.*` and `$nodes.<id>.output.*`
 * expression autocomplete suggestions, and validates required fields before save.
 */
export class NodeConfigDrawerController {
  public static readonly WIDTH_PX = UNSLOP_THEME.drawerWidthPx; // 480px

  public static buildUpstreamSuggestions(
    targetNodeId: string,
    nodes: readonly WorkflowNode[],
    edges: readonly WorkflowEdge[]
  ): string[] {
    const suggestions: string[] = [
      '{{ $trigger.payload }}',
      '{{ $trigger.headers }}',
      '{{ $execution.id }}',
      '{{ $vars.environment }}',
    ];

    // Traverse ancestors via reverse edges
    const visited = new Set<string>();
    const queue = [targetNodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.target === current && !visited.has(edge.source)) {
          visited.add(edge.source);
          queue.push(edge.source);
          const upstreamNode = nodes.find((n) => n.id === edge.source);
          if (upstreamNode) {
            suggestions.push(`{{ $nodes.${upstreamNode.id}.output }}`);
            for (const port of upstreamNode.outputs ?? []) {
              suggestions.push(`{{ $nodes.${upstreamNode.id}.output.${port.id} }}`);
            }
          }
        }
      }
    }

    return suggestions;
  }

  public static validateConfig(
    fields: readonly ConfigFieldDefinition[],
    values: Record<string, unknown>
  ): { valid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const val = values[field.key];
      if (field.required && (val === undefined || val === null || val === '')) {
        errors[field.key] = `Field '${field.label}' is required.`;
      }
    }
    return {
      valid: Object.keys(errors).length === 0,
      errors,
    };
  }

  public static createViewModel(params: {
    node: WorkflowNode;
    allNodes: readonly WorkflowNode[];
    allEdges: readonly WorkflowEdge[];
    fields: ConfigFieldDefinition[];
    credentials: CredentialVaultOption[];
  }): ConfigDrawerViewModel {
    const suggestions = this.buildUpstreamSuggestions(
      params.node.id,
      params.allNodes,
      params.allEdges
    );
    const nodeConfig = params.node.data?.config ?? {};
    const validation = this.validateConfig(params.fields, nodeConfig);
    return {
      isOpen: true,
      widthPx: this.WIDTH_PX,
      nodeId: params.node.id,
      nodeName: params.node.data?.label ?? params.node.id,
      nodeType: params.node.type,
      fields: params.fields,
      values: structuredClone(nodeConfig),
      selectedCredentialId: params.node.data?.credentialId,
      availableCredentials: params.credentials,
      autocompleteSuggestions: suggestions,
      validationErrors: validation.errors,
    };
  }
}
