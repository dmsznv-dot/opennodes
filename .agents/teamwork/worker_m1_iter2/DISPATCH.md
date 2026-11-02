# Dispatch: Milestone 1 Worker (Iteration 2 — Remediation)

## Objective
Apply the exact remediation patches and fixes prepared by the three Fix Explorers to resolve all Challenger 1, Challenger 2, and Reviewer 2 findings across Milestone 1 packages:
1. `@localflow/workflow-schema`:
   - Apply `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_fix_1/milestone_1_fix.patch` (or manually apply changes from `explorer_m1_fix_1/plan.md`).
   - Fixes:
     - Sort `nodes` and `edges` by `id` in `canonicalize` (`packages/workflow-schema/src/utils/checksum.ts`) to ensure permutation-invariant SHA-256 checksums.
     - Compare `topologicalOrder.length === inDegree.size` in `detectCycles` (`packages/workflow-schema/src/validation/cycle-detector.ts`) to eliminate false-positive phantom cycles on duplicate node IDs.
     - Defend `validateWorkflowGraph` (`packages/workflow-schema/src/validation/graph-validator.ts`) with `n.type?.startsWith(...)` and optional chaining on ports.
     - Add the regression test suites from `explorer_m1_fix_1/handoff.md`.
2. `@localflow/observability`:
   - Apply fixes from `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_fix_2/plan.md`:
     - Update `packages/observability/src/redaction/sensitive-keys.ts` so `isSensitiveKey` normalizes camelCase keys (e.g. `clientSecret`, `userPassword`, `dbPassword`, `accessToken`, `refreshToken`, `apiSecret`, `webhookSecret`, `bearerToken`) and redacts them.
     - Update `packages/observability/src/redaction/patterns.ts` to support modern OpenAI project keys: `/\bsk-(?:proj-|admin-|svcacct-)?[a-zA-Z0-9_-]{20,}\b/g`, plus Anthropic (`/\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g`) and GitHub (`/\bgh[pousr]_[a-zA-Z0-9]{36,}\b/g`).
     - Add regression tests verifying camelCase and hyphenated key redaction.
3. `@localflow/auth`:
   - Apply `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_fix_3/changes.patch` (or manually apply changes from `explorer_m1_fix_3/plan.md`):
     - Replace `!data.ciphertext` check with `typeof data.ciphertext !== 'string'` in `packages/auth/src/encryption/crypto-service.ts:45` so legitimate empty strings `""` can be decrypted without error.
     - Add defensive guard `if (!token || typeof token !== 'string') return null;` in `packages/auth/src/session/session-service.ts:35`.
     - Update test suites verifying empty string decryption roundtrip and invalid token session lookups.
4. `@localflow/connector-sdk`:
   - Include `triggers` field in `ConnectorManifestSchema` (`packages/connector-sdk/src/manifest.ts`) and export `ConnectorTriggerManifest`.
   - Update tests verifying manifest parsing with triggers.

## Inputs
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- Master Project Architecture: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md`
- Fix Explorer 1 Plan & Patch: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_fix_1/`
- Fix Explorer 2 Plan: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_fix_2/`
- Fix Explorer 3 Plan & Patch: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_fix_3/`

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Verification Requirements
You MUST run:
1. `pnpm run build`
2. `pnpm run typecheck`
3. `pnpm turbo run test --force`
4. `node tests/run-e2e.mjs f01_f08`
5. `node tests/run-e2e.mjs`
Document all verification command outputs in your handoff report.

## Deliverables
- Working, cleanly compiling, and tested codebase across all packages.
- Handoff report at `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/worker_m1_iter2/handoff.md`.
- Send completion message to parent upon finishing.
