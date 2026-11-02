# Dispatch: Milestone 1 Explorer 3 (Security, Envelope Encryption, Redaction & SSRF Guard)

## Objective
Analyze and detail the exact implementation plan for:
1. **F03 & F04 - Envelope Encryption & RBAC (`packages/auth`)**:
   - AES-256-GCM envelope encryption service (`encrypt`, `decrypt`, key versioning, zero plaintext leak).
   - Password hashing with Argon2id / bcrypt.
   - 4-tier RBAC policy engine: roles `Owner`, `Admin`, `Editor`, `Viewer` with clear permission matrix (e.g. `workflow:read`, `workflow:create`, `workflow:publish`, `credential:create`, `workspace:manage`).
   - One-time owner bootstrapping flow (locks once owner exists).
2. **F05 - Secret Redaction Engine (`packages/observability`)**:
   - Deep recursive redaction function masking sensitive keys (`password`, `secret`, `token`, `key`, `authorization`, `private_key`) and Bearer tokens with `[REDACTED]`.
   - Pino structured logger integration with automatic serializer redaction.
3. **F06 - SSRF Defense Engine (`packages/connector-sdk` / `packages/shared`)**:
   - Safe HTTP request wrapper enforcing multi-tier SSRF protection:
     - Pre-request DNS resolution.
     - Validation against CIDR blocklist: private IPv4 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`), link-local (`169.254.0.0/16`), cloud metadata (`169.254.169.254`), and IPv6 equivalents (`::1`, `fc00::/7`, `fe80::/10`).
     - Socket-level IP pinning (`lookup` override in `http.Agent` / `https.Agent`) to defeat DNS rebinding attacks.
   - Unit tests covering SSRF attacks (DNS rebinding, hex/octal IP formats, redirects to loopback).

## Inputs
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- Master Project Architecture & Feature Inventory: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/PROJECT.md`
- Survey Spec: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_1/survey_spec.md` (Section 7: Security Architecture)

## Outputs
Write your analysis and step-by-step code plan to `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3/m1_3_plan.md` and write your handoff report to `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3/handoff.md`.
When done, notify parent via send_message.

## 2026-11-02T08:40:36Z
[Message] timestamp=2026-11-02T08:40:36Z sender=ccb4ebb5-2245-446b-b9ef-513e8e111218 priority=MESSAGE_PRIORITY_HIGH content=You are Milestone 1 Explorer 3 (Security, Envelope Encryption, Redaction & SSRF Guard).
Your Working Directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3
Project Root: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
Original Request Path: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md
Your Dispatch file: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3/DISPATCH.md
Scope: Features F03, F04, F05, F06 (AES-256-GCM envelope encryption, 4-tier RBAC, secret redaction engine, SSRF defense engine with socket IP pinning).

Read ORIGINAL_REQUEST.md and DISPATCH.md first.
Produce a concrete, step-by-step implementation plan for the worker.
Write your analysis to /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3/m1_3_plan.md and write your handoff to /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_m1_3/handoff.md.
When done, notify parent.
