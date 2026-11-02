# Dispatch: Survey Explorer 1 (Specification Miner)

## Objective
Thoroughly examine `/Users/dmitrysazonov/Downloads/LocalFlow_PRD_Architecture_v1.md` and `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`.
Extract and document the comprehensive, detailed specification for LocalFlow M1 engine vertical slice and P0 Public Alpha MVP.

## Inputs
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- PRD Reference: `/Users/dmitrysazonov/Downloads/LocalFlow_PRD_Architecture_v1.md`

## Scope & Analysis Required
1. Architecture overview & component boundaries (`web`, `api`, `worker`, `postgres`, `redis`).
2. Execution engine specifications:
   - State machine, transitions, and persistence in PostgreSQL (`queued -> running -> succeeded | failed | cancelled`).
   - Redis/BullMQ task queue architecture, idempotency, retry policies, worker restart recovery.
   - Graph orchestration primitives: Branch/IF, Filter, Map/Transform, Delay, For Each, Merge, Cycle prevention.
   - Triggers: Manual, Cron, Webhook, Telegram polling.
3. Foundational connectors (at least 12):
   - HTTP Request (with SSRF protection), Webhook, Cron, JSON transform, CSV, RSS/Atom read, Send Email (SMTP), PostgreSQL SQL, Telegram Bot, generic OpenAI-compatible LLM, local Ollama, controlled filesystem access.
4. Data models & schemas:
   - Workflows, workflow versions (draft vs published), nodes, edges.
   - Executions, step executions, logs.
   - Users, workspaces, workspace memberships (Owner, Admin, Editor, Viewer).
   - Credentials (envelope encrypted, secret redaction).
5. Security requirements:
   - RBAC rules per role.
   - Envelope encryption for credentials at rest.
   - Secret redaction in execution logs, UI, API responses, exports.
   - SSRF protection (denied loopback, private ranges, metadata IP ranges).
6. Docker Compose & Environment configuration:
   - Health checks, dependencies, `.env.example`.

## Outputs
Write your detailed report to `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/survey_spec.md` and produce a self-contained handoff report at `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/handoff.md`.
Then send a completion message back to the orchestrator.


## 2026-11-02T08:30:56Z
You are Survey Explorer 1 (Specification Miner) for the LocalFlow project.
Your Working Directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1
Project Root: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
Original Request Path: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md
Your Dispatch instructions are in: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/DISPATCH.md

Read ORIGINAL_REQUEST.md and DISPATCH.md first. Then inspect the authoritative PRD at /Users/dmitrysazonov/Downloads/LocalFlow_PRD_Architecture_v1.md.
Extract and document the comprehensive specification for:
1. System architecture & component boundaries (web, api, worker, postgres, redis).
2. Complete execution engine lifecycle, state machine, transitions, and persistence (queued -> running -> succeeded | failed | cancelled), worker restart durability.
3. Graph orchestration primitives (Branch/IF, Filter, Map/Transform, Delay, For Each, Merge) and cycle prevention.
4. Triggers (Manual, Cron, Webhook, Telegram polling).
5. All 12+ foundational connectors & actions: HTTP Request (SSRF protected), Webhook, Cron, JSON transform, CSV, RSS/Atom read, Send Email (SMTP), PostgreSQL SQL, Telegram Bot, generic OpenAI-compatible LLM, local Ollama, controlled filesystem access.
6. Data models: workflows, versions (draft vs published), nodes, edges, executions, steps, users, workspaces, roles (Owner, Admin, Editor, Viewer), envelope-encrypted credentials.
7. Security: RBAC permissions matrix, credential encryption, secret redaction rules, SSRF defense rules.
8. Single-command Docker Compose setup, services, health checks, .env.example.

Write your findings to /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/survey_spec.md and write your self-contained handoff to /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/handoff.md.
When finished, send a completion message to parent.
