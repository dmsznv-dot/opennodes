# Dispatch: E2E Testing Orchestrator

## Objective
Act as the independent E2E Testing Orchestrator for the LocalFlow project (Dual Track architecture).
Your mission is to establish the opaque-box test infrastructure and design & implement the comprehensive automated test suite (Tiers 1 through 4) strictly derived from `ORIGINAL_REQUEST.md` and `PROJECT.md`, without depending on internal implementation design. When complete, publish `TEST_INFRA.md` and `TEST_READY.md` at the project root.

## Inputs
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- Master Project Architecture & Feature Inventory: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md`
- Specification Report: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/survey_spec.md`
- UI Specification: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3/survey_ui_unslop.md`

## Working Directory
`/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/sub_orch_e2e_testing`

## Scope & Methodology
1. **Test Infrastructure (`TEST_INFRA.md`)**:
   - Create test harness in `tests/e2e` using Vitest / TypeScript.
   - All tests must run self-contained without requiring live Docker or external third-party services.
   - Use in-memory mocks (`ioredis-mock`, in-memory database adapters, MSW for HTTP/LLM/Telegram/SMTP simulated endpoints).
2. **Tier 1 - Feature Coverage (>=5 per feature)**:
   - Happy path tests verifying each feature in isolation using simplest verification channel.
3. **Tier 2 - Boundary & Corner Cases (>=5 per feature)**:
   - Limit testing, empty inputs, max payloads, negative tests, syntax errors, cycle attempts, SSRF blocking.
4. **Tier 3 - Cross-Feature Combinations**:
   - Pairwise interactions (e.g. Cron trigger -> Branch IF -> HTTP Request -> Database SQL).
5. **Tier 4 - Real-World Application Scenarios**:
   - Realistic workflows (e.g., RSS feed parser -> OpenAI summarizer -> Telegram bot alert; Webhook ingestion -> CSV parse -> PostgreSQL insert -> Email confirmation).
6. **Publish `TEST_READY.md`**:
   - Signal completion at `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/TEST_READY.md`.

## Execution
Follow the sub-orchestrator procedure: Assess -> Decompose or Iterate (dispatch `teamwork_test_writer` / `teamwork_worker`, `teamwork_reviewer`, `teamwork_challenger`, `teamwork_auditor`).
When complete, write your handoff report and notify the Project Orchestrator via `send_message`.
