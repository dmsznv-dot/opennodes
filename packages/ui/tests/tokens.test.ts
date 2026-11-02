import { describe, it, expect } from 'vitest';
import { unslopTokens } from '../src/tokens.js';

describe('Unslop Design Tokens', () => {
  it('defines calm Ink neutral ramp', () => {
    expect(unslopTokens.colors.ink[950]).toBe('#090a0b');
    expect(unslopTokens.colors.ink[900]).toBe('#121417');
    expect(unslopTokens.colors.ink[50]).toBe('#f8f9fa');
  });

  it('defines Electric Cobalt accent', () => {
    expect(unslopTokens.colors.accent.cobalt).toBe('#3b82f6');
  });

  it('defines all required port colors', () => {
    expect(unslopTokens.colors.port.trigger).toBe('#f59e0b');
    expect(unslopTokens.colors.port.json).toBe('#3b82f6');
    expect(unslopTokens.colors.port.string).toBe('#10b981');
    expect(unslopTokens.colors.port.number).toBe('#8b5cf6');
    expect(unslopTokens.colors.port.boolean).toBe('#ec4899');
    expect(unslopTokens.colors.port.binary).toBe('#6366f1');
    expect(unslopTokens.colors.port.any).toBe('#94a3b8');
  });

  it('defines 4px spacing scale', () => {
    expect(unslopTokens.spacing[1]).toBe('4px');
    expect(unslopTokens.spacing[2]).toBe('8px');
    expect(unslopTokens.spacing[4]).toBe('16px');
  });
});
