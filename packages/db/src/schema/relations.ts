import { relations } from 'drizzle-orm';
import { users, sessions, invitations } from './users.js';
import { workspaces, memberships, workspaceSettings, apiKeys } from './workspaces.js';
import { credentials } from './credentials.js';
import { workflows, workflowVersions } from './workflows.js';
import { executions, nodeExecutions, executionLogs, executionEvents } from './executions.js';
import { triggers, triggerLogs, webhookSubscriptions } from './triggers.js';
import { auditLogs } from './audit.js';

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(sessions),
  auditLogs: many(auditLogs),
  createdWorkflows: many(workflows),
  createdVersions: many(workflowVersions),
  createdCredentials: many(credentials),
  createdApiKeys: many(apiKeys),
  sentInvitations: many(invitations),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const workspacesRelations = relations(workspaces, ({ many, one }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
  workflows: many(workflows),
  credentials: many(credentials),
  executions: many(executions),
  triggers: many(triggers),
  webhookSubscriptions: many(webhookSubscriptions),
  apiKeys: many(apiKeys),
  auditLogs: many(auditLogs),
  settings: one(workspaceSettings, {
    fields: [workspaces.id],
    references: [workspaceSettings.workspaceId],
  }),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [memberships.workspaceId],
    references: [workspaces.id],
  }),
}));

export const workspaceSettingsRelations = relations(workspaceSettings, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceSettings.workspaceId],
    references: [workspaces.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [apiKeys.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, {
    fields: [apiKeys.createdBy],
    references: [users.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [invitations.workspaceId],
    references: [workspaces.id],
  }),
  inviter: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const credentialsRelations = relations(credentials, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [credentials.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, {
    fields: [credentials.createdBy],
    references: [users.id],
  }),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [workflows.workspaceId],
    references: [workspaces.id],
  }),
  creator: one(users, {
    fields: [workflows.createdBy],
    references: [users.id],
  }),
  versions: many(workflowVersions),
  activeVersion: one(workflowVersions, {
    fields: [workflows.activeVersionId],
    references: [workflowVersions.id],
  }),
  executions: many(executions),
  triggers: many(triggers),
  webhookSubscriptions: many(webhookSubscriptions),
}));

export const workflowVersionsRelations = relations(workflowVersions, ({ one, many }) => ({
  workflow: one(workflows, {
    fields: [workflowVersions.workflowId],
    references: [workflows.id],
  }),
  creator: one(users, {
    fields: [workflowVersions.createdBy],
    references: [users.id],
  }),
  executions: many(executions),
}));

export const executionsRelations = relations(executions, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [executions.workspaceId],
    references: [workspaces.id],
  }),
  workflow: one(workflows, {
    fields: [executions.workflowId],
    references: [workflows.id],
  }),
  workflowVersion: one(workflowVersions, {
    fields: [executions.workflowVersionId],
    references: [workflowVersions.id],
  }),
  nodeExecutions: many(nodeExecutions),
  logs: many(executionLogs),
  events: many(executionEvents),
}));

export const nodeExecutionsRelations = relations(nodeExecutions, ({ one, many }) => ({
  execution: one(executions, {
    fields: [nodeExecutions.executionId],
    references: [executions.id],
  }),
  logs: many(executionLogs),
}));

export const executionLogsRelations = relations(executionLogs, ({ one }) => ({
  execution: one(executions, {
    fields: [executionLogs.executionId],
    references: [executions.id],
  }),
  nodeExecution: one(nodeExecutions, {
    fields: [executionLogs.nodeExecutionId],
    references: [nodeExecutions.id],
  }),
}));

export const executionEventsRelations = relations(executionEvents, ({ one }) => ({
  execution: one(executions, {
    fields: [executionEvents.executionId],
    references: [executions.id],
  }),
}));

export const triggersRelations = relations(triggers, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [triggers.workspaceId],
    references: [workspaces.id],
  }),
  workflow: one(workflows, {
    fields: [triggers.workflowId],
    references: [workflows.id],
  }),
  logs: many(triggerLogs),
}));

export const triggerLogsRelations = relations(triggerLogs, ({ one }) => ({
  trigger: one(triggers, {
    fields: [triggerLogs.triggerId],
    references: [triggers.id],
  }),
  execution: one(executions, {
    fields: [triggerLogs.executionId],
    references: [executions.id],
  }),
}));

export const webhookSubscriptionsRelations = relations(webhookSubscriptions, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [webhookSubscriptions.workspaceId],
    references: [workspaces.id],
  }),
  workflow: one(workflows, {
    fields: [webhookSubscriptions.workflowId],
    references: [workflows.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [auditLogs.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}));
