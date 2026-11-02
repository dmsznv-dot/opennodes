export const PERMISSIONS = {
  WORKSPACE_DELETE: 'workspace:delete',
  WORKSPACE_TRANSFER_OWNER: 'workspace:transfer_owner',
  WORKSPACE_UPDATE: 'workspace:update',
  WORKSPACE_MANAGE_MEMBERS: 'workspace:manage_members',
  WORKSPACE_VIEW: 'workspace:view',

  CREDENTIAL_CREATE: 'credential:create',
  CREDENTIAL_UPDATE: 'credential:update',
  CREDENTIAL_DELETE: 'credential:delete',
  CREDENTIAL_REFERENCE: 'credential:reference',
  CREDENTIAL_VIEW_METADATA: 'credential:view_metadata',

  WORKFLOW_CREATE: 'workflow:create',
  WORKFLOW_EDIT: 'workflow:edit',
  WORKFLOW_DELETE: 'workflow:delete',
  WORKFLOW_PUBLISH: 'workflow:publish',
  WORKFLOW_ROLLBACK: 'workflow:rollback',
  WORKFLOW_EXECUTE: 'workflow:execute',
  WORKFLOW_CANCEL: 'workflow:cancel',
  WORKFLOW_VIEW: 'workflow:view',

  EXECUTION_VIEW: 'execution:view',
  AUDIT_LOG_VIEW: 'audit_log:view',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
