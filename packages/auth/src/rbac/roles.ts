export const ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_HIERARCHY: Record<Role, number> = {
  OWNER: 4,
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};
