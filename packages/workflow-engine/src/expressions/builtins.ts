export const FORBIDDEN_IDENTIFIERS = new Set<string>([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'process',
  'global',
  'globalThis',
  'window',
  'require',
  'import',
  'Function',
  'eval',
  'Object',
  'Reflect',
  'Symbol',
  'Promise',
]);

export const SAFE_STRING_METHODS = new Set<string>([
  'startsWith',
  'endsWith',
  'includes',
  'indexOf',
  'lastIndexOf',
  'toLowerCase',
  'toUpperCase',
  'trim',
  'trimStart',
  'trimEnd',
  'slice',
  'substring',
  'substr',
  'replace',
  'replaceAll',
  'split',
  'charAt',
  'charCodeAt',
  'concat',
  'padStart',
  'padEnd',
  'repeat',
]);

export const SAFE_ARRAY_METHODS = new Set<string>([
  'includes',
  'indexOf',
  'lastIndexOf',
  'slice',
  'concat',
  'join',
  'reverse',
  'flat',
  'filter',
  'map',
  'find',
  'findIndex',
  'some',
  'every',
]);

export const SAFE_NUMBER_METHODS = new Set<string>([
  'toFixed',
  'toPrecision',
  'toString',
  'valueOf',
]);

export function isForbiddenIdentifier(name: string): boolean {
  return FORBIDDEN_IDENTIFIERS.has(name);
}

export function isSafeMethod(target: unknown, methodName: string): boolean {
  if (isForbiddenIdentifier(methodName)) return false;
  if (typeof target === 'string') {
    return SAFE_STRING_METHODS.has(methodName);
  }
  if (Array.isArray(target)) {
    return SAFE_ARRAY_METHODS.has(methodName);
  }
  if (typeof target === 'number') {
    return SAFE_NUMBER_METHODS.has(methodName);
  }
  return false;
}
