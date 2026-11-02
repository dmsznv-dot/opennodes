import {
  arePortsCompatible,
  computeWorkflowChecksum,
  detectCycles,
  validateWorkflowGraph,
  type NodePort,
  type WorkflowEdge,
  type WorkflowNode,
} from '@localflow/workflow-schema';
import { unslopTokens } from '@localflow/ui';

export type PortType = NodePort['type'];

export interface ViewportTransform {
  x: number;
  y: number;
  zoom: number;
}

export interface ConnectAttempt {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface ConnectResult {
  allowed: boolean;
  reason?: string;
  code?: string;
  edge?: WorkflowEdge;
}

export interface PublishedSnapshot {
  version: number;
  checksum: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  publishedAt: string;
}

/**
 * React Flow Visual Workflow Editor & Canvas Controller
 * Manages nodes, typed port handles, real-time cycle prevention, pan/zoom transforms,
 * and Draft vs. Published immutable snapshot isolation.
 */
export class WorkflowCanvasController {
  private draftNodes: WorkflowNode[] = [];
  private draftEdges: WorkflowEdge[] = [];
  private selectedNodeId: string | null = null;
  private viewport: ViewportTransform = { x: 0, y: 0, zoom: 1 };
  private publishedVersions: PublishedSnapshot[] = [];
  private activeVersionNumber: number | null = null;

  constructor(initialNodes: WorkflowNode[] = [], initialEdges: WorkflowEdge[] = []) {
    this.draftNodes = structuredClone(initialNodes);
    this.draftEdges = structuredClone(initialEdges);
  }

  public getDraftState(): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
    return {
      nodes: structuredClone(this.draftNodes),
      edges: structuredClone(this.draftEdges),
    };
  }

  public getActivePublishedSnapshot(): PublishedSnapshot | null {
    if (this.activeVersionNumber === null) return null;
    const found = this.publishedVersions.find((v) => v.version === this.activeVersionNumber);
    return found ? structuredClone(found) : null;
  }

  public getPublishedVersions(): PublishedSnapshot[] {
    return structuredClone(this.publishedVersions);
  }

  public addNode(node: WorkflowNode): void {
    if (this.draftNodes.some((n) => n.id === node.id)) {
      throw new Error(`Node with ID '${node.id}' already exists on canvas.`);
    }
    this.draftNodes.push(structuredClone(node));
  }

  public updateNodePosition(nodeId: string, position: { x: number; y: number }): void {
    const node = this.draftNodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node '${nodeId}' not found.`);
    node.position = { x: Math.round(position.x), y: Math.round(position.y) };
  }

  public updateNodeConfig(nodeId: string, config: Record<string, unknown>, credentialId?: string): void {
    const node = this.draftNodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node '${nodeId}' not found.`);
    node.data.config = structuredClone(config);
    if (credentialId !== undefined) {
      node.data.credentialId = credentialId;
    }
  }

  public removeNode(nodeId: string): void {
    this.draftNodes = this.draftNodes.filter((n) => n.id !== nodeId);
    // Cascade delete connected edges
    this.draftEdges = this.draftEdges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    );
    if (this.selectedNodeId === nodeId) {
      this.selectedNodeId = null;
    }
  }

  public selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
  }

  public getSelectedNode(): WorkflowNode | null {
    if (!this.selectedNodeId) return null;
    return this.draftNodes.find((n) => n.id === this.selectedNodeId) ?? null;
  }

  /**
   * Validates and connects two ports on the React Flow canvas.
   * Rejects self-loops, incompatible port types, and cyclic dependencies in real time.
   */
  public connectPorts(attempt: ConnectAttempt): ConnectResult {
    if (attempt.source === attempt.target) {
      return {
        allowed: false,
        code: 'ERR_SELF_LOOP',
        reason: 'A node cannot connect to itself.',
      };
    }

    const sourceNode = this.draftNodes.find((n) => n.id === attempt.source);
    const targetNode = this.draftNodes.find((n) => n.id === attempt.target);
    if (!sourceNode || !targetNode) {
      return {
        allowed: false,
        code: 'ERR_NODE_NOT_FOUND',
        reason: 'Source or target node does not exist.',
      };
    }

    const sourcePort = sourceNode.outputs?.find((p) => p.id === attempt.sourceHandle);
    const targetPort = targetNode.inputs?.find((p) => p.id === attempt.targetHandle);
    if (!sourcePort || !targetPort) {
      return {
        allowed: false,
        code: 'ERR_HANDLE_NOT_FOUND',
        reason: 'Source output handle or target input handle not found.',
      };
    }

    if (!arePortsCompatible(sourcePort.type, targetPort.type)) {
      return {
        allowed: false,
        code: 'ERR_PORT_INCOMPATIBLE',
        reason: `Port type '${sourcePort.type}' is incompatible with '${targetPort.type}'.`,
      };
    }

    const newEdge: WorkflowEdge = {
      id: `edge_${attempt.source}_${attempt.sourceHandle}_${attempt.target}_${attempt.targetHandle}`,
      source: attempt.source,
      sourceHandle: attempt.sourceHandle,
      target: attempt.target,
      targetHandle: attempt.targetHandle,
    };

    const candidateEdges = [...this.draftEdges, newEdge];
    const cycleCheck = detectCycles(this.draftNodes, candidateEdges);
    if (cycleCheck.hasCycle) {
      return {
        allowed: false,
        code: 'ERR_CYCLIC_DEPENDENCY_DETECTED',
        reason: `Connection rejected: creates cycle (${cycleCheck.cyclePath.join(' -> ')}).`,
      };
    }

    this.draftEdges.push(newEdge);
    return { allowed: true, edge: newEdge };
  }

  public setViewport(transform: Partial<ViewportTransform>): ViewportTransform {
    const nextZoom =
      transform.zoom !== undefined ? Math.min(2.0, Math.max(0.25, transform.zoom)) : this.viewport.zoom;
    this.viewport = {
      x: transform.x ?? this.viewport.x,
      y: transform.y ?? this.viewport.y,
      zoom: nextZoom,
    };
    return { ...this.viewport };
  }

  public screenToCanvasCoordinates(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.viewport.x) / this.viewport.zoom,
      y: (screenY - this.viewport.y) / this.viewport.zoom,
    };
  }

  public static getPortAccentColor(portType: PortType): string {
    const colors = unslopTokens.colors.port as Record<string, string>;
    return colors[portType] ?? unslopTokens.colors.port.any;
  }

  /**
   * Publishes the current Draft into an immutable versioned snapshot with SHA-256 checksum.
   * Subsequent edits to Draft never mutate published versions.
   */
  public publishDraft(): {
    ok: boolean;
    snapshot?: PublishedSnapshot;
    errors?: Array<{ code: string; message: string }>;
  } {
    const validation = validateWorkflowGraph(this.draftNodes, this.draftEdges, {
      requireSingleTrigger: true,
    });
    if (!validation.valid) {
      return {
        ok: false,
        errors: validation.errors.map((e) => ({ code: e.code, message: e.message })),
      };
    }

    const version = this.publishedVersions.length + 1;
    const nodesCopy = structuredClone(this.draftNodes);
    const edgesCopy = structuredClone(this.draftEdges);
    const checksum = computeWorkflowChecksum({ nodes: nodesCopy, edges: edgesCopy });
    const snapshot: PublishedSnapshot = {
      version,
      checksum,
      nodes: nodesCopy,
      edges: edgesCopy,
      publishedAt: new Date().toISOString(),
    };
    this.publishedVersions.push(snapshot);
    this.activeVersionNumber = version;
    return { ok: true, snapshot: structuredClone(snapshot) };
  }

  public rollbackToVersion(version: number): PublishedSnapshot {
    const target = this.publishedVersions.find((v) => v.version === version);
    if (!target) {
      throw new Error(`Published version v${version} not found.`);
    }
    this.activeVersionNumber = target.version;
    return structuredClone(target);
  }
}
