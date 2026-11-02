import { PortType } from '@localflow/shared';

/**
 * Validates whether data from an output port of source type
 * can be accepted by an input port of target type.
 */
export function arePortsCompatible(sourceType: PortType, targetType: PortType): boolean {
  // 'any' port accepts and feeds any type
  if (sourceType === 'any' || targetType === 'any') {
    return true;
  }

  // Exact type match is always allowed
  if (sourceType === targetType) {
    return true;
  }

  // Trigger output can only feed trigger or any
  if (sourceType === 'trigger' || targetType === 'trigger') {
    return false;
  }

  // JSON can accept string, number, boolean as valid JSON values
  if (
    targetType === 'json' &&
    (sourceType === 'string' || sourceType === 'number' || sourceType === 'boolean')
  ) {
    return true;
  }

  return false;
}
