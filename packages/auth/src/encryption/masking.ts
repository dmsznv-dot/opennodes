export function maskSecret(secret: string): string {
  if (!secret) return '';
  const len = secret.length;
  if (len <= 4) {
    return '••••••••';
  }
  if (len <= 8) {
    return '••••' + secret.slice(-2);
  }
  return '••••••••' + secret.slice(-4);
}

export interface SanitizedCredentialSummary {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  maskedHint: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function sanitizeCredentialEntity(
  raw: {
    id: string;
    workspaceId: string;
    name: string;
    type: string;
    createdAt: Date | string;
    updatedAt: Date | string;
  },
  sampleSecret?: string
): SanitizedCredentialSummary {
  return {
    id: raw.id,
    workspaceId: raw.workspaceId,
    name: raw.name,
    type: raw.type,
    maskedHint: sampleSecret ? maskSecret(sampleSecret) : '••••••••',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}
