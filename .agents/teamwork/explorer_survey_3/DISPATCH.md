# Dispatch: Survey Explorer 3 (UI Architecture & Unslop Design Inspector)

## Objective
Investigate the Web Application & Canvas requirements from `/Users/dmitrysazonov/Downloads/LocalFlow_PRD_Architecture_v1.md`, `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`, and the Unslop design principles from `https://github.com/heydamir/unslop`.
Produce a detailed UI specification and design system mapping.

## Inputs
- ORIGINAL_REQUEST.md: `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md`
- PRD Reference: `/Users/dmitrysazonov/Downloads/LocalFlow_PRD_Architecture_v1.md`
- Unslop Repository: `https://github.com/heydamir/unslop` (use web search / read_url_content or git clone/fetch in your investigation if needed)
- Current frontend code in `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes` (e.g. `apps/web` or similar)

## Scope & Analysis Required
1. Unslop design principles:
   - Philosophy, visual hierarchy, typography rules, color palette/tokens, spacing, contrast, calm editorial styling.
   - Specific component patterns (buttons, cards, inputs, tabs, badges, modals, drawers, status indicators).
   - Anti-patterns to strictly avoid (generic AI slop, rounded purple pill overload, low contrast gray-on-gray, unnecessary animations, loud gradients).
2. React Flow Canvas architecture:
   - Node rendering: custom nodes with typed ports (input/output data types), clean non-cluttered card design.
   - Edge validation and interactive connection rules (preventing circular dependencies/cycles, type matching).
   - Pan/zoom controls, minimap, background grid, keyboard shortcuts.
   - Draft vs published workflow version management (editing draft without mutating active running workflow).
3. Configuration Panel & Forms:
   - Node configuration drawer/panel using JSON schema forms or typed form builders.
   - Secret/credential selectors with secure input masks.
4. Execution Run Inspector:
   - Live / historical run view showing execution state, node execution status indicators (queued, running, succeeded, failed, skipped), duration/timings.
   - Step input/output viewer with sanitized payloads (secrets masked).
5. Workspace Views & Setup:
   - Initial bootstrapping setup screen (create owner account + primary workspace).
   - Workflow list / dashboard, settings, credentials management, execution history view.

## Outputs
Write your detailed report to `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3/survey_ui_unslop.md` and produce a self-contained handoff report at `/Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3/handoff.md`.
Then send a completion message back to the orchestrator.

## 2026-11-02T08:31:20Z
[Message] timestamp=2026-11-02T08:31:20Z sender=ccb4ebb5-2245-446b-b9ef-513e8e111218 priority=MESSAGE_PRIORITY_HIGH content=You are Survey Explorer 3 (UI Architecture & Unslop Design Inspector) for the LocalFlow project.
Your Working Directory: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3
Project Root: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes
Original Request Path: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/ORIGINAL_REQUEST.md
Your Dispatch instructions are in: /Users/dmitrysazonov/.gemini/antigravity/scratch/opennodes/.agents/teamwork/explorer_survey_3/DISPATCH.md
