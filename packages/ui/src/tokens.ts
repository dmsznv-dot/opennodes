/**
 * Unslop Design Tokens for LocalFlow
 * - Calm neutral Ink/Graphite ramp
 * - Electric Cobalt accent (<2% surface area)
 * - 4px spacing scale
 * - Nested geometric radii
 * - Zero decorative slop / gradients / neon glows
 */
export const unslopTokens = {
  colors: {
    // Neutral ramp (Ink / Graphite)
    ink: {
      950: '#090a0b', // Root canvas dark background
      900: '#121417', // Surface / Card base
      850: '#1a1d21', // Surface elevated / Drawer
      800: '#22262c', // Border default
      700: '#333942', // Border strong / Active node border
      600: '#4e5664', // Muted text / Placeholder
      400: '#8b94a5', // Secondary text
      200: '#cbd1dc', // Body text
      50: '#f8f9fa',  // Primary heading text
    },
    // Accent (Electric Cobalt - used strictly for focus rings & primary CTA)
    accent: {
      cobalt: '#3b82f6',
      cobaltHover: '#2563eb',
      cobaltSubtle: 'rgba(59, 130, 246, 0.12)',
    },
    // Semantic Status Colors (Desaturated, calm indicators)
    status: {
      queued: '#8b94a5',
      running: '#3b82f6',
      waiting: '#eab308',
      succeeded: '#10b981',
      failed: '#ef4444',
      cancelled: '#6b7280',
    },
    // Port Type Colors (React Flow handle accents)
    port: {
      trigger: '#f59e0b', // Amber
      json: '#3b82f6',    // Blue
      string: '#10b981',  // Emerald
      number: '#8b5cf6',  // Purple
      boolean: '#ec4899', // Pink
      binary: '#6366f1',  // Indigo
      any: '#94a3b8',     // Slate
    },
  },
  typography: {
    fontSans:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontMono:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    6: '24px',
    8: '32px',
  },
  radii: {
    sm: '4px',
    md: '6px',
    lg: '8px',
    full: '9999px',
  },
} as const;

export type UnslopTokens = typeof unslopTokens;
