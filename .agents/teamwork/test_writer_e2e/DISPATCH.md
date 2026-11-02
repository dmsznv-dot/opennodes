# Dispatch: E2E Test Writer (Independent E2E Testing Track)

## Objective
Design and implement the comprehensive, opaque-box E2E test suite (Tiers 1 through 4) for LocalFlow in `tests/e2e/`, derived strictly from `ORIGINAL_REQUEST.md` and `PROJECT.md § Feature Inventory`.
Establish `TEST_INFRA.md` and publish `TEST_READY.md` at project root.

## Inputs
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- Master Project Architecture & Feature Inventory: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md`
- Survey Spec: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/survey_spec.md`
- Codebase Survey: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_2/survey_codebase.md`

## Working Directory
`/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/test_writer_e2e`

## Scope & Deliverables
1. **Test Infrastructure (`TEST_INFRA.md` & `tests/e2e/harness/`)**:
   - Test runner configuration (Vitest, tsconfig).
   - In-memory mock adapters for BullMQ (`ioredis-mock`), database (mock / in-memory client), and MSW (Mock Service Worker) for simulated external APIs (OpenAI LLM, Ollama, Telegram Bot API, SMTP server, HTTP endpoints).
   - Test utilities for executing workflows and validating execution results, node timings, step transitions, and sanitized payloads.
2. **Tier 1 - Feature Coverage (>=5 per feature)**:
   - Comprehensive test cases for features F01-F44 exercising each in isolation.
3. **Tier 2 - Boundary & Corner Cases (>=5 per feature)**:
   - Extreme inputs, empty payloads, loop limits, cycle attempts, malformed schemas, SSRF blocked targets.
4. **Tier 3 - Cross-Feature Combinations (Pairwise)**:
   - Workflows combining multiple triggers, primitives, and connectors.
5. **Tier 4 - Real-World Application Scenarios**:
   - At least 5 full realistic workflows (e.g. RSS feed digest, Webhook to SQL sync with email alert, LLM data classification with Telegram notification, etc.).
6. **Publish `TEST_READY.md`**:
   - Create `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/TEST_READY.md` documenting test counts, runner command, and coverage checklist.

## Constraints & Integrity
DO NOT CHEAT. All test cases and assertions must be genuine and execute against public APIs or interfaces defined in `PROJECT.md`.
Write your handoff to `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/test_writer_e2e/handoff.md`.
When done, notify parent via send_message.

## 2026-11-02T08:40:45Z
You are the E2E Test Writer for LocalFlow.
Your Working Directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/test_writer_e2e
Project Root: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
Original Request Path: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md
Your Dispatch file: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/test_writer_e2e/DISPATCH.md
Scope: Independent E2E Testing Track — Design and implement the opaque-box test infrastructure and comprehensive Tiers 1-4 test suites in tests/e2e/, publish TEST_INFRA.md and TEST_READY.md.
