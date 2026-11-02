# Handoff Report: UI Architecture & Unslop Design System Survey

**Agent:** Survey Explorer 3 (UI Architecture & Unslop Design Inspector)  
**Recipient:** Orchestrator (Conversation ID: `ccb4ebb5-2245-446b-b9ef-513e8e111218`)  
**Working Directory:** `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3`  
**Primary Deliverable:** `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3/survey_ui_unslop.md`  

---

## 1. Observation

1. **LocalFlow PRD & Architecture Specifications:**
   - Viewed file `/Users/dmitrysazonov/Downloads/LocalFlow_PRD_Architecture_v1.md`.
   - Lines 18–23 specify the core visual workflow paradigm and target users: maker, small team/agency, technical operator, and IT team.
   - Lines 74–84 (Scope & Priority: 3.1 Core Editor) dictate:
     - `ED-01` (P0): "React Flow canvas; pan/zoom; palette; nodes/edges. Create/modify a 15-node graph without refreshing; changes persist."
     - `ED-02` (P0): "Typed node ports; edge validation; cycle rejection except explicit loop primitives. Invalid connections blocked with explanation."
     - `ED-03` (P0): "Config panel with JSON schema forms, validation, examples. Required missing fields prevent publication."
     - `ED-04` (P0): "Variables and expressions (safe interpreter, not JS eval). Reference prior node output and trigger data; autocomplete keys."
     - `ED-05` (P0): "Draft vs published version. Editing draft does not change running version."
     - `ED-06` (P1/Alpha Gate): "Run inspector; node timings, sanitized input/output, error cause. Failed step highlighted; step data inspectable."
   - Lines 150–152 (Tech Stack): "Frontend: React + Vite, React Flow, Tailwind, shadcn/ui, TanStack Query, Zod and i18next."
   - Lines 216–220 (Security): "Credential values never appear in normal logs, UI, exports or API responses... HttpOnly/SameSite sessions... bootstrap owner only once."
   - Lines 242–245 (UX / Information Architecture): "Dense but calm editorial UI, clean 8px spacing scale, accessible type contrast, keyboard-first flow, no excessive gradients. UI patterns from modern visual IDEs, not direct visual copying of n8n branding. WCAG 2.2 AA targeted for core flows."
   - Lines 250–251 (Alpha Acceptance Gate): "Fresh Docker Compose installation works from documented .env.example with one startup command... Admin creates account/workspace, makes workflow, tests, publishes, disables and exports it."

2. **Unslop Design Principles & Artifacts:**
   - Cloned repository from `https://github.com/heydamir/unslop` to `/tmp/unslop-repo` (Git commit hash verified via command output).
   - Inspected `/tmp/unslop-repo/skills/unslop/SKILL.md` (lines 11–30, 68–176, 209–234).
     - *Principle of Restraint:* "The difference between slop and craft is where the richness goes. Slop spreads color and effects over the chrome, the backgrounds, buttons, borders and labels. Craft keeps the chrome quiet and puts the richness into one or two moments of content that people remember..."
     - *Direction Rule:* 5 attributes required: Product, Character, World, Moments, Signature.
     - *Spacing:* "Everything sits on a 4px grid. Margins, paddings, gaps and fixed heights are multiples of 4... Navigation is the densest part of an app. Rows are 32 to 36 tall with 2 to 4 between them."
     - *Color:* Single neutral ramp (Graphite or Ink), three text roles (Primary, Secondary, Muted), 1 accent used on <2% of surface, hairlines at 6–10% opacity, zero hue gradients or colored glows.
     - *Type:* Weights 400 and 500 (max 600), sentence case everywhere, tabular nums for figures, no uppercase tracked labels.
     - *Icons:* Single line icon set (`lucide`, 16/18px, 1.5 stroke), zero emoji in UI labels.
     - *Details:* Nested radii math: inner = outer - padding (never <4px).
   - Inspected `/tmp/unslop-repo/skills/unslop/references/tokens.md`:
     - Dark Ink/Graphite ramp: Background `#11141c` / `#141415`, Card `#171b26` / `#19191b`, Raised `#1f2533` / `#232325`, Primary Text `#eef0f5` / `#ededed`, Secondary Text `#a3a9b8` / `#a1a1a6`, Muted Text `#6b7487` / `#85858b`.
   - Inspected `/tmp/unslop-repo/skills/unslop/references/signs.md` cataloging 15+ explicit anti-patterns (purple gradients, gradient text, colored glows, emoji badges, rounded-full pills, bouncy springs, fake greeting headlines).

3. **Existing Repository State:**
   - Checked `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes` using `list_dir`.
   - Result: Directory only contains `.agents/teamwork/`. No frontend code or monorepo scaffold currently exists. This is a greenfield implementation phase.

---

## 2. Logic Chain

1. **Design System Derivation (Observation 1 & 2):**
   - Because LocalFlow is a technical orchestration IDE used for prolonged monitoring, the UI chrome must avoid visual noise, hue gradients, and heavy shadows.
   - Adopting the Unslop "Ink / Graphite" neutral ramp with a single Electric Cobalt (`#3b82f6`) accent fulfills both the calm editorial visual requirement of PRD Section 7 and the anti-slop mandate of `https://github.com/heydamir/unslop`.
   - Establishing a strict 4px grid and mathematical nested radii ensures visual harmony across all cards, drawers, and buttons without arbitrary styling.

2. **React Flow Canvas Architecture Derivation (Observation 1 & 2):**
   - PRD `ED-01` and `ED-02` require typed ports, edge validation, and cycle rejection.
   - We defined 7 distinct port types (`trigger`, `json`, `string`, `number`, `boolean`, `binary`, `any`) with subtle color-coded dot handles.
   - A real-time DFS cycle detection algorithm on `isValidConnection` guarantees the DAG topological invariant before any edge can be committed to state, preventing infinite loops while preserving dedicated loop primitives (`For Each`).
   - Cardinality rules (Input = 1, Output = N) enforce deterministic upstream data resolution.

3. **Workflow Version Lifecycle Derivation (Observation 1):**
   - PRD `ED-05` and ADR-005 mandate that draft edits must not mutate active running workflows.
   - Therefore, the canvas operates purely on a local/remote `Draft` state. Live scheduled/webhook executions execute solely against immutable version snapshots stored in `workflow_versions` with SHA-256 checksums.
   - A dedicated 48px version header bar provides explicit feedback (`Published v1.2` vs `Draft v1.3 - Unsaved`), a version switcher, and a publication gate that checks required fields before allowing version promotion.

4. **Node Configuration Panel Derivation (Observation 1):**
   - PRD `ED-03` and `ED-04` require dynamic JSON schema forms, validation, and safe expression references.
   - A 480px slide-over drawer anchored to the right preserves canvas visibility and interactivity.
   - Replacing `eval()` with a mustache/JSONPath expression syntax (`{{ steps.<node_id>.output.<path> }}`) supported by an upstream variable picker ensures security and operator ease-of-use.
   - Envelope encryption rules require that credentials in the drawer are selected only by alias, and values are never revealed in plaintext.

5. **Execution Run Inspector Derivation (Observation 1):**
   - PRD `ED-06` and Acceptance Gate 6 require step highlighting, timings, sanitized I/O, and error diagnosis.
   - Using Server-Sent Events (`/api/v1/executions/:id/events`) allows real-time step streaming without WebSocket overhead or full page polling.
   - An automated regex sanitization filter masks all sensitive tokens (`password`, `secret`, `token`, `key`) before rendering in the step I/O viewer.

6. **Bootstrapping & Workspace Management Derivation (Observation 1):**
   - PRD Section 6 and Deployment Gate 2 demand single-instance owner initialization.
   - A dedicated `/setup` route backed by `GET /api/v1/auth/bootstrap-status` ensures the owner account and primary workspace are created immediately on first run, locking permanently thereafter against unauthorized re-registration.

---

## 3. Caveats

1. **Greenfield Monorepo:** Because no code exists yet in `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes`, the architectural specification is written as a blueprint for the monorepo scaffold (`apps/web` with Vite, React 19/18, Tailwind, `@xyflow/react`).
2. **Third-Party Canvas Plugins:** While React Flow v12 supports custom nodes, performance on extremely large graphs (>100 nodes) will require virtualization (`onlyRenderVisibleElements: true`). This is noted as an optimization guideline for implementation.
3. **SSRF Allowlist UI:** Network egress rules in Workspace Settings depend on backend Fastify proxy policies to be defined by Explorer 1.

---

## 4. Conclusion

The UI architecture, design tokens, component specifications, canvas mechanics, and operational flows are completely specified in `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3/survey_ui_unslop.md`.

The specification strictly enforces Unslop design principles, fully satisfies PRD requirements `ED-01` through `ED-06`, establishes a deterministic versioning and cycle-prevention model for React Flow, provides masked credential selectors and sanitized run inspection, and defines the one-time onboarding bootstrap workflow.

---

## 5. Verification Method

1. **Documentation Inspection:**
   - Verify that `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3/survey_ui_unslop.md` exists and contains all 8 major sections.
2. **Token & Anti-Pattern Compliance Check:**
   - Confirm all color tokens match the Unslop dark/light Ink ramp.
   - Confirm that no purple gradients, glowing pill tags, or emoji labels are present in the design specification.
3. **Canvas State Machine & Cycle Detection Verification:**
   - Inspect Section 3.4 for the DFS cycle detection logic (`hasCycle`) and port compatibility matrix.
4. **Invalidation Conditions:**
   - If the engineering team decides against React Flow in favor of an SVG/Canvas custom renderer, Section 3 would need adjustment (not recommended per PRD ED-01).
