import { describe, it, expect } from 'vitest';
import {
  RbacPolicyEngine,
  PERMISSIONS,
  ROLES,
  Role,
  Permission,
  ForbiddenError,
  BootstrapService,
  BootstrapDatabaseAdapter,
  AlreadyBootstrappedError,
  ScryptPasswordHasher,
} from '../src/index.js';

describe('Adversarial RBAC & Bootstrap Security Stress Testing', () => {
  const allPermissions = Object.values(PERMISSIONS) as Permission[];

  describe('1. Exhaustive 4-Tier Permission Matrix Validation', () => {
    it('verifies OWNER role possesses 100% of defined permissions', () => {
      for (const perm of allPermissions) {
        expect(
          RbacPolicyEngine.hasPermission('OWNER', perm),
          `OWNER must possess ${perm}`
        ).toBe(true);
        expect(() => RbacPolicyEngine.assertPermission('OWNER', perm)).not.toThrow();
      }
    });

    it('strictly forbids ADMIN from WORKSPACE_DELETE and WORKSPACE_TRANSFER_OWNER', () => {
      const forbiddenForAdmin: Permission[] = [
        PERMISSIONS.WORKSPACE_DELETE,
        PERMISSIONS.WORKSPACE_TRANSFER_OWNER,
      ];

      for (const perm of forbiddenForAdmin) {
        expect(RbacPolicyEngine.hasPermission('ADMIN', perm)).toBe(false);
        expect(() => RbacPolicyEngine.assertPermission('ADMIN', perm)).toThrow(ForbiddenError);
      }

      // ADMIN has remaining 18 permissions
      const allowedCount = allPermissions.filter((p) =>
        RbacPolicyEngine.hasPermission('ADMIN', p)
      ).length;
      expect(allowedCount).toBe(allPermissions.length - 2);
    });

    it('strictly forbids EDITOR from publishing, deleting workspace, and managing credentials', () => {
      const forbiddenForEditor: Permission[] = [
        PERMISSIONS.WORKSPACE_DELETE,
        PERMISSIONS.WORKSPACE_TRANSFER_OWNER,
        PERMISSIONS.WORKSPACE_UPDATE,
        PERMISSIONS.WORKSPACE_MANAGE_MEMBERS,
        PERMISSIONS.CREDENTIAL_CREATE,
        PERMISSIONS.CREDENTIAL_UPDATE,
        PERMISSIONS.CREDENTIAL_DELETE,
        PERMISSIONS.WORKFLOW_PUBLISH,
        PERMISSIONS.WORKFLOW_ROLLBACK,
        PERMISSIONS.AUDIT_LOG_VIEW,
      ];

      for (const perm of forbiddenForEditor) {
        expect(
          RbacPolicyEngine.hasPermission('EDITOR', perm),
          `EDITOR must NOT possess ${perm}`
        ).toBe(false);
        expect(() => RbacPolicyEngine.assertPermission('EDITOR', perm)).toThrow(ForbiddenError);
      }
    });

    it('strictly restricts VIEWER to read-only metadata and execution inspection', () => {
      const allowedForViewer = new Set<Permission>([
        PERMISSIONS.WORKSPACE_VIEW,
        PERMISSIONS.CREDENTIAL_VIEW_METADATA,
        PERMISSIONS.WORKFLOW_VIEW,
        PERMISSIONS.EXECUTION_VIEW,
      ]);

      for (const perm of allPermissions) {
        const shouldHave = allowedForViewer.has(perm);
        expect(
          RbacPolicyEngine.hasPermission('VIEWER', perm),
          `VIEWER ${shouldHave ? 'must have' : 'must NOT have'} ${perm}`
        ).toBe(shouldHave);

        if (shouldHave) {
          expect(() => RbacPolicyEngine.assertPermission('VIEWER', perm)).not.toThrow();
        } else {
          expect(() => RbacPolicyEngine.assertPermission('VIEWER', perm)).toThrow(ForbiddenError);
        }
      }
    });
  });

  describe('2. Role Tampering & Privilege Escalation Evasion', () => {
    it('fails closed for unknown or crafted role strings', () => {
      const maliciousRoles = ['SUPERADMIN', 'ROOT', 'GUEST', 'ANONYMOUS', '', 'admin', 'owner'];

      for (const fakeRole of maliciousRoles) {
        for (const perm of allPermissions) {
          expect(RbacPolicyEngine.hasPermission(fakeRole as Role, perm)).toBe(false);
          expect(() => RbacPolicyEngine.assertPermission(fakeRole as Role, perm)).toThrow(
            ForbiddenError
          );
        }
      }
    });

    it('fails closed for invalid permission strings', () => {
      const bogusPermissions = ['system:root', 'workspace:*', '*', 'delete:everything'] as any[];

      for (const role of ROLES) {
        for (const bogus of bogusPermissions) {
          expect(RbacPolicyEngine.hasPermission(role, bogus)).toBe(false);
          expect(() => RbacPolicyEngine.assertPermission(role, bogus)).toThrow(ForbiddenError);
        }
      }
    });
  });

  describe('3. One-Time Bootstrap Security & Re-Bootstrapping Prevention', () => {
    let bootstrapped = false;
    let savedOwner: any = null;

    const mockDb: BootstrapDatabaseAdapter = {
      async isSystemBootstrapped() {
        return bootstrapped;
      },
      async createOwnerAndWorkspace(user) {
        if (bootstrapped) {
          throw new AlreadyBootstrappedError('Lock collision: already bootstrapped');
        }
        bootstrapped = true;
        savedOwner = {
          userId: 'user_first_owner',
          email: user.email,
          workspaceId: 'ws_root',
          workspaceName: user.workspaceName,
          role: 'OWNER' as const,
        };
        return savedOwner;
      },
    };

    const hasher = new ScryptPasswordHasher();
    const service = new BootstrapService(mockDb, hasher);

    it('rejects bootstrap attempts with invalid or empty emails', async () => {
      bootstrapped = false;
      await expect(
        service.bootstrapOwner({ email: '', password: 'valid-password-123' })
      ).rejects.toThrow(/Valid email/);

      await expect(
        service.bootstrapOwner({ email: 'notanemail', password: 'valid-password-123' })
      ).rejects.toThrow(/Valid email/);
    });

    it('rejects bootstrap attempts with weak passwords (< 8 chars)', async () => {
      bootstrapped = false;
      await expect(
        service.bootstrapOwner({ email: 'admin@localflow.dev', password: 'short' })
      ).rejects.toThrow(/at least 8 characters/);

      await expect(
        service.bootstrapOwner({ email: 'admin@localflow.dev', password: '' })
      ).rejects.toThrow(/at least 8 characters/);
    });

    it('bootstraps initial owner and normalizes email casing', async () => {
      bootstrapped = false;
      const result = await service.bootstrapOwner({
        email: '  INITIAL.OWNER@LOCALFLOW.DEV  ',
        password: 'secure-master-password-123',
        fullName: 'System Founder',
        workspaceName: 'LocalFlow Core',
      });

      expect(result.email).toBe('initial.owner@localflow.dev');
      expect(result.role).toBe('OWNER');
      expect(await service.isBootstrapped()).toBe(true);
    });

    it('permanently blocks subsequent bootstrap attempts', async () => {
      expect(await service.isBootstrapped()).toBe(true);

      // Malicious attempt to bootstrap secondary owner
      await expect(
        service.bootstrapOwner({
          email: 'attacker@evil.corp',
          password: 'attacker-master-password',
        })
      ).rejects.toThrow(AlreadyBootstrappedError);
    });
  });
});
