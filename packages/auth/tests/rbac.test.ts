import { describe, it, expect } from 'vitest';
import { RbacPolicyEngine, PERMISSIONS, ForbiddenError } from '../src/index.js';

describe('4-Tier RBAC Policy Engine', () => {
  it('OWNER role has all permissions including workspace delete and transfer', () => {
    expect(RbacPolicyEngine.hasPermission('OWNER', PERMISSIONS.WORKSPACE_DELETE)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('OWNER', PERMISSIONS.WORKSPACE_TRANSFER_OWNER)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('OWNER', PERMISSIONS.WORKFLOW_PUBLISH)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('OWNER', PERMISSIONS.CREDENTIAL_CREATE)).toBe(true);
  });

  it('ADMIN can manage members, credentials, and publish, but cannot delete workspace', () => {
    expect(RbacPolicyEngine.hasPermission('ADMIN', PERMISSIONS.WORKSPACE_DELETE)).toBe(false);
    expect(RbacPolicyEngine.hasPermission('ADMIN', PERMISSIONS.WORKSPACE_TRANSFER_OWNER)).toBe(false);
    expect(RbacPolicyEngine.hasPermission('ADMIN', PERMISSIONS.WORKSPACE_MANAGE_MEMBERS)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('ADMIN', PERMISSIONS.WORKFLOW_PUBLISH)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('ADMIN', PERMISSIONS.CREDENTIAL_CREATE)).toBe(true);
  });

  it('EDITOR can create/edit/execute workflows and reference credentials, but cannot publish or create credentials', () => {
    expect(RbacPolicyEngine.hasPermission('EDITOR', PERMISSIONS.WORKFLOW_CREATE)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('EDITOR', PERMISSIONS.WORKFLOW_EDIT)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('EDITOR', PERMISSIONS.WORKFLOW_EXECUTE)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('EDITOR', PERMISSIONS.CREDENTIAL_REFERENCE)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('EDITOR', PERMISSIONS.CREDENTIAL_VIEW_METADATA)).toBe(true);

    // Forbidden for Editor
    expect(RbacPolicyEngine.hasPermission('EDITOR', PERMISSIONS.WORKFLOW_PUBLISH)).toBe(false);
    expect(RbacPolicyEngine.hasPermission('EDITOR', PERMISSIONS.CREDENTIAL_CREATE)).toBe(false);
    expect(RbacPolicyEngine.hasPermission('EDITOR', PERMISSIONS.WORKSPACE_MANAGE_MEMBERS)).toBe(false);
  });

  it('VIEWER is strictly read-only', () => {
    expect(RbacPolicyEngine.hasPermission('VIEWER', PERMISSIONS.WORKSPACE_VIEW)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('VIEWER', PERMISSIONS.WORKFLOW_VIEW)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('VIEWER', PERMISSIONS.EXECUTION_VIEW)).toBe(true);
    expect(RbacPolicyEngine.hasPermission('VIEWER', PERMISSIONS.CREDENTIAL_VIEW_METADATA)).toBe(true);

    // Forbidden for Viewer
    expect(RbacPolicyEngine.hasPermission('VIEWER', PERMISSIONS.WORKFLOW_CREATE)).toBe(false);
    expect(RbacPolicyEngine.hasPermission('VIEWER', PERMISSIONS.WORKFLOW_EXECUTE)).toBe(false);
    expect(RbacPolicyEngine.hasPermission('VIEWER', PERMISSIONS.CREDENTIAL_REFERENCE)).toBe(false);
  });

  it('assertPermission throws ForbiddenError on unauthorized actions', () => {
    expect(() =>
      RbacPolicyEngine.assertPermission('VIEWER', PERMISSIONS.WORKFLOW_EXECUTE)
    ).toThrow(ForbiddenError);

    expect(() =>
      RbacPolicyEngine.assertPermission('EDITOR', PERMISSIONS.WORKFLOW_PUBLISH)
    ).toThrow(ForbiddenError);

    expect(() =>
      RbacPolicyEngine.assertPermission('OWNER', PERMISSIONS.WORKSPACE_DELETE)
    ).not.toThrow();
  });

  it('verifies compound permission checks hasAllPermissions and hasAnyPermission', () => {
    expect(
      RbacPolicyEngine.hasAllPermissions('ADMIN', [
        PERMISSIONS.WORKFLOW_CREATE,
        PERMISSIONS.WORKFLOW_PUBLISH,
      ])
    ).toBe(true);

    expect(
      RbacPolicyEngine.hasAllPermissions('EDITOR', [
        PERMISSIONS.WORKFLOW_CREATE,
        PERMISSIONS.WORKFLOW_PUBLISH,
      ])
    ).toBe(false);

    expect(
      RbacPolicyEngine.hasAnyPermission('VIEWER', [
        PERMISSIONS.WORKFLOW_CREATE,
        PERMISSIONS.WORKFLOW_VIEW,
      ])
    ).toBe(true);
  });
});
