import { Role } from './roles.js';
import { Permission } from './permissions.js';
import { ROLE_PERMISSIONS } from './matrix.js';
import { ForbiddenError } from './errors.js';

export class RbacPolicyEngine {
  public static hasPermission(role: Role, permission: Permission): boolean {
    const perms = ROLE_PERMISSIONS[role];
    return perms ? perms.has(permission) : false;
  }

  public static assertPermission(role: Role, permission: Permission): void {
    if (!this.hasPermission(role, permission)) {
      throw new ForbiddenError(
        `Role '${role}' is not authorized to perform action requiring permission '${permission}'.`
      );
    }
  }

  public static hasAllPermissions(role: Role, permissions: Permission[]): boolean {
    return permissions.every((p) => this.hasPermission(role, p));
  }

  public static hasAnyPermission(role: Role, permissions: Permission[]): boolean {
    return permissions.some((p) => this.hasPermission(role, p));
  }

  public static getPermissionsForRole(role: Role): ReadonlySet<Permission> {
    return ROLE_PERMISSIONS[role] ?? new Set();
  }
}
