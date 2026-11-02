# Dispatch: Milestone 1 Explorer 1 (Monorepo Scaffolding & Workflow Schemas)

## Objective
Analyze and detail the exact implementation plan for:
1. **F01 - Monorepo Foundation & Tooling**:
   - Root `package.json` with pnpm workspace scripts (build, test, lint, typecheck).
   - `pnpm-workspace.yaml` defining `apps/*` and `packages/*`.
   - `turbo.json` with pipeline definitions (`build`, `test`, `lint`, `typecheck`, `dev`).
   - `tsconfig.base.json` with strict TypeScript configuration (ES2024 / NodeNext).
   - Package skeletons: `packages/workflow-schema`, `packages/shared`, `packages/ui`.
2. **F07 & F08 - Workflow Schema & Cycle Prevention**:
   - `packages/workflow-schema`: Complete Zod definitions for `WorkflowNode`, `NodePort` (typed ports: `trigger`, `json`, `string`, `number`, `boolean`, `binary`, `any`), `WorkflowEdge`, `WorkflowDefinition`, `WorkflowVersion`.
   - Kahn's algorithm / DFS cycle detector rejecting cyclic connections.
   - Comprehensive unit tests using Vitest.

## Inputs
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- Master Project Architecture & Feature Inventory: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md`
- Survey Spec: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/survey_spec.md`

## Outputs
Write your analysis and step-by-step code plan to `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1/m1_1_plan.md` and write your handoff report to `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1/handoff.md`.
When done, notify parent via send_message.


## 2026-11-02T08:40:21Z
You are Milestone 1 Explorer 1 (Monorepo Scaffolding & Workflow Schemas).
Your Working Directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1
Project Root: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
Original Request Path: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md
Your Dispatch file: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1/DISPATCH.md
Scope: Features F01, F07, F08 (Monorepo setup, package skeletons, workflow schemas, Kahn's cycle detector, Vitest setup).

Read ORIGINAL_REQUEST.md and DISPATCH.md first.
Produce a concrete, step-by-step implementation plan for the worker.
Write your analysis to /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1/m1_1_plan.md and write your handoff to /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_1/handoff.md.
When done, notify parent.
