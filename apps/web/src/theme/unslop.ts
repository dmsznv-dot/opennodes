import { unslopTokens } from '@localflow/ui';

export const UNSLOP_THEME = {
  ...unslopTokens,
  spacingScalePx: [4, 8, 12, 16, 24, 32, 48] as const,
  nestedRadiiPx: {
    sm: 4,
    md: 8,
    lg: 12,
  } as const,
  drawerWidthPx: 480,
  accentMaxSurfaceRatio: 0.02,
  tabularNumeralCss: 'font-variant-numeric: tabular-nums;',
} as const;

export interface UnslopAuditReport {
  compliant: boolean;
  violations: string[];
}

/**
 * Verifies that any style definition or component configuration adheres to Unslop rules:
 * - Zero linear/radial purple gradients or neon box-shadows
 * - Spacing values strictly on the 4px scale [4, 8, 12, 16, 24, 32, 48]
 * - Nested radii child <= parent
 */
export function auditUnslopCompliance(input: {
  cssText?: string;
  spacingPx?: number[];
  outerRadiusPx?: number;
  innerRadiusPx?: number;
}): UnslopAuditReport {
  const violations: string[] = [];

  if (input.cssText) {
    if (/linear-gradient|radial-gradient/i.test(input.cssText)) {
      violations.push('Decorative gradients are forbidden by Unslop design rules.');
    }
    if (/blur\(\s*(?:[2-9]\d|\d{3,})px\s*\)/i.test(input.cssText)) {
      violations.push('Heavy decorative neon glow blurs are forbidden.');
    }
  }

  if (input.spacingPx) {
    const allowed = new Set<number>(UNSLOP_THEME.spacingScalePx);
    for (const val of input.spacingPx) {
      if (!allowed.has(val)) {
        violations.push(`Spacing value ${val}px is off the Unslop 4px rhythm scale.`);
      }
    }
  }

  if (
    typeof input.outerRadiusPx === 'number' &&
    typeof input.innerRadiusPx === 'number' &&
    input.innerRadiusPx > input.outerRadiusPx
  ) {
    violations.push(
      `Nested radius violation: inner radius (${input.innerRadiusPx}px) exceeds outer radius (${input.outerRadiusPx}px).`
    );
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}
