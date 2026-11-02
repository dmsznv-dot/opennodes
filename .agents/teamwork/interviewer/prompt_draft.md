Build the first production release of LocalFlow (repository: https://github.com/dmsznv-dot/opennodes), implementing both the M1 engine vertical slice and the full P0 Public Alpha MVP as specified in the PRD, applying modern UI design practices from https://github.com/heydamir/unslop.

Working directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
Integrity mode: development

Reference: /Users/dmitrysazonov/Downloads/LocalFlow_PRD_Architecture_v1.md
UI Design Reference: https://github.com/heydamir/unslop

## Requirements

### R1. Execution Engine and Orchestrator
Implement an independent, deterministic workflow execution engine with durable state persistence in PostgreSQL and a Redis/BullMQ task queue. Support Manual, Cron, Webhook, and Telegram polling triggers, alongside graph orchestration primitives (Branch/IF, Filter, Map/Transform, Delay, For Each, Merge) and foundational connectors (HTTP Request, Webhook, Cron, JSON transform, CSV, RSS/Atom read, Send Email via SMTP, PostgreSQL SQL, Telegram Bot, generic OpenAI-compatible LLM, local Ollama, and controlled filesystem access).

### R2. Visual Canvas and Web Application
Build the web application featuring a React Flow canvas with pan/zoom, typed node ports, edge validation, cycle prevention, draft versus published workflow versions, a configuration panel with JSON schema forms, and an execution run inspector showing node timings and sanitized step input/output data.

### R3. UI Design with Unslop Principles
Apply the aesthetic and functional design principles from https://github.com/heydamir/unslop across all web UI views and components, ensuring a clean, accessible, non-generic editorial visual interface with disciplined typography, spacing, and contrast.

### R4. Security, Workspace Isolation, and Credentials
Implement owner bootstrapping, workspace separation, role-based access control (Owner, Admin, Editor, Viewer), and envelope-encrypted credential storage at rest with full secret redaction in execution logs, UI, and exports. Enforce SSRF protection by denying loopback, private, and metadata network ranges by default on outgoing HTTP requests.

### R5. Self-Contained Verification and Deployment
Provide single-command self-hosted deployment via Docker Compose with health checks and documented configuration. Include automated test suites using isolated mocks, simulated endpoints, and fixtures for external services (HTTP APIs, Telegram, LLMs, SMTP) to verify workflow execution, durable recovery across worker restarts, and RBAC rules.

## Acceptance Criteria

### Deployment & Setup
- [ ] Fresh Docker Compose installation starts all required services (`web`, `api`, `worker`, `postgres`, `redis`) with passing health checks using `.env.example`.
- [ ] Initial setup flow bootstraps an owner account and creates the primary workspace.

### Workflow Editor & Canvas
- [ ] React Flow canvas supports adding, configuring, and connecting nodes with typed ports and cycle detection.
- [ ] Workflow versioning distinguishes draft from published versions; draft modifications do not mutate active running workflows.
- [ ] Web UI complies with unslop design standards (consistent layout, refined typography, accessible contrast, calm styling).

### Execution Engine & Triggers
- [ ] Manual, Cron, Webhook, and Telegram polling triggers initiate workflow executions with tracked unique execution IDs.
- [ ] Graph execution properly handles branching (IF), mapping, filtering, loops, and merging.
- [ ] At least 12 foundational connectors and actions (HTTP Request, Webhook, Cron, JSON transform, CSV, RSS, SMTP email, Postgres SQL, Telegram bot, OpenAI LLM, Ollama, file access) execute successfully in automated tests.
- [ ] Worker restart during execution does not drop queued jobs; state transitions (`queued -> running -> succeeded | failed | cancelled`) persist in PostgreSQL.
- [ ] Execution run inspector displays step statuses, timings, error causes, and sanitized input/output payloads.

### Security & RBAC
- [ ] Workspace roles (Owner, Admin, Editor, Viewer) enforce proper permissions for reading, editing, publishing, and viewing runs.
- [ ] Credential secrets are encrypted at rest and never exposed in plaintext in logs, UI, exports, or API responses.
- [ ] SSRF defenses block unauthorized requests to internal IP addresses and loopback targets.

### Automated Testing & CI
- [ ] Automated unit, contract, and integration test suites pass using self-contained mocks without requiring external third-party services.
- [ ] Monorepo linting and TypeScript strict typechecks complete without errors.
