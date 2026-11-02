import type { NodeExecutor } from './node-executor.js';

export class NodeExecutorRegistry {
  private readonly executors = new Map<string, NodeExecutor>();

  register(nodeType: string, executor: NodeExecutor): void {
    this.executors.set(nodeType, executor);
  }

  get(nodeType: string): NodeExecutor | undefined {
    return this.executors.get(nodeType);
  }

  has(nodeType: string): boolean {
    return this.executors.has(nodeType);
  }
}
