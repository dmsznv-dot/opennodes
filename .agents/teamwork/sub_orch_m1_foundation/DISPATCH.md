# Dispatch: Sub-Orchestrator Milestone 1 (Core Foundation & Security)

## Objective
Lead Milestone 1 (M1) of the LocalFlow implementation: Build the Monorepo Foundation, Core Schemas, Database Layer, Security Engines & RBAC.

## Inputs
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- Master Project Architecture & Feature Inventory: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md`
- Survey Spec: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/survey_spec.md`
- Codebase Survey: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_2/survey_codebase.md`

## Working Directory
`/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/sub_orch_m1_foundation`

## Scope (Features F01 through F08)
1. **F01 - Monorepo Foundation & Tooling**:
   - `package.json` (root), `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, linting & vitest test scripts.
2. **F02 - Drizzle Database Schema & Models (`packages/db`)**:
   - 18 PostgreSQL tables (`users`, `workspaces`, `memberships`, `invitations`, `audit_logs`, `workflows`, `workflow_versions`, `credentials`, `executions`, `node_executions`, `execution_logs`, `execution_events`, `triggers`, `trigger_logs`, `webhook_subscriptions`, `api_keys`, `workspace_settings`).
   - In-memory mock adapter support for self-contained testing.
3. **F03 - Identity & RBAC (`packages/auth`)**:
   - One-time owner bootstrapping logic, session token management, 4-tier RBAC permission checker (`Owner`, `Admin`, `Editor`, `Viewer`).
4. **F04 - Credential Envelope Encryption (`packages/auth`)**:
   - AES-256-GCM encryption at rest with versioned keys (`key_version`, `iv`, `authTag`, `ciphertext`), zero plaintext exposure in API/exports.
5. **F05 - Secret Redaction Engine (`packages/observability`)**:
   - Deep recursive redaction masking sensitive keys (`password`, `secret`, `token`, `key`, `authorization`).
6. **F06 - SSRF Defense Engine (`packages/connector-sdk` / `packages/shared`)**:
   - DNS resolution check and socket IP pinning blocking RFC1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), and cloud metadata (`169.254.169.254`).
7. **F07 - Workflow Definition Schema (`packages/workflow-schema`)**:
   - Complete Zod schemas for nodes, typed ports, edges, and workflows per `PROJECT.md § Interface Contracts`.
8. **F08 - Cycle Prevention Engine (`packages/workflow-schema` / `packages/workflow-engine`)**:
   - DFS / Kahn's topological sort rejecting cycles upon edge creation and workflow validation.

## Process
Follow the sub-orchestrator procedure: Assess -> Decompose or Iterate:
1. Spawn Explorer(s) to analyze detailed implementation plan.
2. Spawn Worker to implement packages and verify with unit tests (build & typecheck passing).
3. Spawn Reviewers (2) independently.
4. Spawn Challengers (2) to stress test security, SSRF, cycle detection, and encryption.
5. Spawn Forensic Auditor (`teamwork_auditor`) for integrity verification.
6. Evaluate Gate and write `GATE_STATUS.md`.
Upon passing gate, write `handoff.md` and send completion message to Project Orchestrator.
