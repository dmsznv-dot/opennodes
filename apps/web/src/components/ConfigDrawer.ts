import type { WorkflowEdge, WorkflowNode } from '@localflow/workflow-schema';
import { UNSLOP_THEME } from '../theme/unslop.js';
import { createTranslator, type Locale } from '../i18n/index.js';

export interface ConfigFieldDefinition {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json' | 'select' | 'secret_ref';
  required: boolean;
  placeholder?: string;
  options?: string[];
  /** Shown by default; non-basic fields live under the collapsed "Advanced" section. */
  basic?: boolean;
}

export type FieldParseResult =
  | { ok: true; value: unknown; omitted?: boolean }
  | { ok: false; code: 'field.error.required' | 'field.error.number' | 'field.error.json' | 'field.error.select'; reason?: string };

const EXPRESSION_RE = /^\s*\{\{[\s\S]*\}\}\s*$/;

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

  /**
   * Converts a raw form control value into the field's declared type. Expressions
   * (`{{ ... }}`) stay strings for any type; empty optional values are omitted rather
   * than stored as `""`; `false`, `0`, `[]` and `{}` round-trip unchanged.
   */
  public static parseFieldInput(field: ConfigFieldDefinition, raw: unknown): FieldParseResult {
    if (field.type === 'boolean') {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' };
    }

    const isEmpty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
    if (isEmpty) {
      return field.required ? { ok: false, code: 'field.error.required' } : { ok: true, value: undefined, omitted: true };
    }
    if (typeof raw === 'string' && EXPRESSION_RE.test(raw)) return { ok: true, value: raw.trim() };

    switch (field.type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, code: 'field.error.number' };
      }
      case 'boolean':
        return { ok: true, value: Boolean(raw) };
      case 'json': {
        if (typeof raw !== 'string') return { ok: true, value: raw };
        try {
          return { ok: true, value: JSON.parse(raw) };
        } catch (err) {
          return { ok: false, code: 'field.error.json', reason: (err as Error).message };
        }
      }
      case 'select':
        return !field.options || field.options.includes(String(raw))
          ? { ok: true, value: String(raw) }
          : { ok: false, code: 'field.error.select' };
      default:
        return { ok: true, value: typeof raw === 'string' ? raw : String(raw) };
    }
  }

  /** Parses every field of a form submission; returns typed config or localized errors. */
  public static coerceConfig(
    fields: readonly ConfigFieldDefinition[],
    rawValues: Record<string, unknown>,
    locale?: Locale
  ): { valid: boolean; config: Record<string, unknown>; errors: Record<string, string> } {
    const t = createTranslator(locale);
    const config: Record<string, unknown> = {};
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const res = this.parseFieldInput(field, rawValues[field.key]);
      if (!res.ok) {
        errors[field.key] = t(res.code, { label: field.label, reason: res.reason ?? '' });
      } else if (!res.omitted) {
        config[field.key] = res.value;
      }
    }
    return { valid: Object.keys(errors).length === 0, config, errors };
  }

  public static validateConfig(
    fields: readonly ConfigFieldDefinition[],
    values: Record<string, unknown>,
    locale?: Locale
  ): { valid: boolean; errors: Record<string, string> } {
    const t = createTranslator(locale);
    const errors: Record<string, string> = {};
    for (const field of fields) {
      const val = values[field.key];
      // `false` and `0` are valid values; only absent/empty counts as missing.
      if (field.required && (val === undefined || val === null || val === '')) {
        errors[field.key] = t('field.error.required', { label: field.label });
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
    locale?: Locale;
  }): ConfigDrawerViewModel {
    const suggestions = this.buildUpstreamSuggestions(
      params.node.id,
      params.allNodes,
      params.allEdges
    );
    const nodeConfig = params.node.data?.config ?? {};
    const validation = this.validateConfig(params.fields, nodeConfig, params.locale);
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
