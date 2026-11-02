import type { PrimitiveDefinition } from './types.js';
import { branchIfPrimitive } from './branch-if.js';
import { filterPrimitive } from './filter.js';
import { mapPrimitive } from './map.js';
import { delayPrimitive } from './delay.js';
import { forEachPrimitive } from './for-each.js';
import { mergePrimitive } from './merge.js';

export class PrimitiveRegistry {
  private readonly definitions = new Map<string, PrimitiveDefinition<any>>();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.register(branchIfPrimitive);
      this.register(filterPrimitive);
      this.register(mapPrimitive);
      this.register(delayPrimitive);
      this.register(forEachPrimitive);
      this.register(mergePrimitive);
    }
  }

  register<TConfig>(definition: PrimitiveDefinition<TConfig>): void {
    this.definitions.set(definition.type, definition);
    if (definition.aliases) {
      for (const alias of definition.aliases) {
        this.definitions.set(alias, definition);
      }
    }
  }

  get(typeOrAlias: string): PrimitiveDefinition<any> | undefined {
    return this.definitions.get(typeOrAlias);
  }

  has(typeOrAlias: string): boolean {
    return this.definitions.has(typeOrAlias);
  }

  listCanonical(): PrimitiveDefinition<any>[] {
    const unique = new Set<PrimitiveDefinition<any>>(this.definitions.values());
    return Array.from(unique);
  }
}

export const defaultPrimitiveRegistry = new PrimitiveRegistry(true);
