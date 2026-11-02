# LocalFlow UI Architecture & Unslop Design System Specification

**Author:** Survey Explorer 3 (UI Architecture & Unslop Design Inspector)  
**Date:** 2026-11-02  
**Status:** Architecture Baseline & Implementation Specification  
**Integrity Mode:** Production Self-Hosted Workflow Automation Platform  

---

## 1. Executive Summary & Design Direction

LocalFlow is a visual workflow automation platform designed to run deterministically on user-controlled infrastructure. It bridges complex backend orchestration (triggers, queuing, branching, database queries, and external APIs) with a human-operable, visual IDE.

A visual orchestration platform is a mission-critical tool used by engineers, operators, and makers for hours at a time. The interface must be **calm, exact, technical, and highly legible**. 

Following the **Unslop Design Principles** ([Damir Sokolovsky / unslop](https://github.com/heydamir/unslop)), LocalFlow rejects the pervasive "AI slop" aesthetic—purple-magenta gradients, neon drop shadows, emoji-laden labels, arbitrary padding, and noisy animations. Instead, LocalFlow applies:
1. **Quiet Chrome, Rich Moments:** The surrounding navigation, toolbars, drawers, and panels stay completely neutral and understated. Visual richness is concentrated exclusively where it matters: the node graph canvas, execution timelines, data payload inspectors, and status indicators.
2. **4px Grid Discipline:** All margins, paddings, gaps, and heights strictly adhere to a consistent 4px rhythm.
3. **Exact Editorial Typography:** Strict hierarchy driven by font size and color rather than excessive font weights. Tabular numerals for all metrics, IDs, durations, and timestamps.
4. **Deterministic Versioning & Safety:** Visual cues clearly delineate draft (editable workspace) from published (immutable runtime snapshot), safeguarding against accidental live mutations.

### The Five-Line Unslop Direction for LocalFlow

- **Product:** A visual workflow automation platform running deterministically on user-controlled infrastructure.
- **Character:** Calm, exact, technical, highly legible.
- **World:** Control rooms, precision measurement instruments, and developer IDEs.
- **Moments:** The node canvas with clean hairline connectors, and the execution run inspector with micro-timed step durations and sanitized payload diffs.
- **Signature:** A precise, calm status dot and hairline connection routing with mono micro-badges (`142ms`, `v1.2`, `200 OK`).

---

## 2. Unslop Design System Specification

### 2.1 Spacing Scale & Rhythm

LocalFlow adheres to a strict 4px grid. No arbitrary Tailwind classes (e.g., `mt-[13px]`, `px-[7px]`) are permitted.

| Token | Pixels | Primary Application |
|---|---|---|
| `space-1` | 4px | Micro padding inside badges, keycaps, compact pill tags |
| `space-2` | 8px | Gap between icon and label, input vertical padding, item gaps in compact lists |
| `space-3` | 12px | Padding inside small controls, dropdown menus, button horizontal padding (sm) |
| `space-4` | 16px | Standard button padding (md), compact panel padding, sidebar horizontal padding |
| `space-5` | 20px | Navigation row gaps, form field stack spacing |
| `space-6` | 24px | Card interior padding, modal dialog interior padding, drawer interior padding |
| `space-8` | 32px | Page gutter padding, section separators |
| `space-10` | 40px | Major container margins, empty state vertical breathing room |
| `space-12` | 48px | Dashboard section vertical spacing |
| `space-16` | 64px | Authentication and setup wizard layout breathing room |

#### Density and Layout Scale Rules
- **Row Heights:** 32px (compact data tables, tree nodes), 36px (default navigation rows, standard inputs), 40px (prominent buttons, search bars).
- **Navigation Density:** Sidebar items are 36px tall with 2px vertical gap. Section headers sit 24px above their item list and 8px below the preceding section.
- **Nested Radii Math:** Inner radius = Outer radius - Padding (minimum 4px).
  - Controls & Inputs: `8px` (`rounded-md`)
  - Cards: `12px` (`rounded-lg`) with inner content at `8px`
  - Floating Drawers & Modals: `16px` (`rounded-xl`)
  - Keycaps & Micro Tags: `4px` (`rounded`)
  - *No full pill buttons (`rounded-full`) except for status badges and circular icon buttons.*

---

### 2.2 Color Palette & Semantic Tokens

LocalFlow uses the **Ink / Graphite** neutral ramp. This evokes technical precision and high-contrast legibility without ocular fatigue.

#### Dark Mode Ramp (Primary Desktop IDE Theme)

| Token Role | Hex Code | Purpose & Application |
|---|---|---|
| `bg-deep` | `#0b0d14` | Deepest backdrop: navigation sidebar, canvas background grid floor |
| `bg-base` | `#11141c` | Standard page background, canvas viewport backdrop |
| `bg-card` | `#171b26` | Node cards, dashboard cards, inspector panels |
| `bg-raised` | `#1f2533` | Active navigation rows, hover states, inputs, dropdown menus |
| `border-hairline` | `rgba(238, 240, 245, 0.08)` | Subtle 1px borders on all cards, drawers, and dividers |
| `border-subtle` | `rgba(238, 240, 245, 0.16)` | Selected cards, focused inputs, active port docks |
| `text-primary` | `#eef0f5` | Headings, node titles, primary button text, key metrics (Contrast: 14.2:1) |
| `text-secondary` | `#a3a9b8` | Body copy, field labels, port types, navigation labels (Contrast: 7.8:1) |
| `text-muted` | `#6b7487` | Meta info, keyboard shortcuts, timestamps, disabled items (Contrast: 4.6:1) |

#### Light Mode Ramp

| Token Role | Hex Code | Purpose & Application |
|---|---|---|
| `bg-deep` | `#f5f7fa` | Navigation sidebar, canvas background floor |
| `bg-base` | `#ffffff` | Primary canvas and page canvas |
| `bg-card` | `#ffffff` | Node cards, dashboard cards (with subtle hairline border) |
| `bg-raised` | `#eceff4` | Active rows, input backgrounds, hovered cards |
| `border-hairline` | `rgba(17, 24, 39, 0.08)` | Hairline borders on cards, headers, panels |
| `border-subtle` | `rgba(17, 24, 39, 0.16)` | Focused inputs, hovered ports |
| `text-primary` | `#111827` | Headings, primary text, node titles (Contrast: 16.5:1) |
| `text-secondary` | `#4b5565` | Form labels, descriptions, navigation labels (Contrast: 8.2:1) |
| `text-muted` | `#6b7487` | Timestamps, metadata, placeholders (Contrast: 4.6:1) |

#### Restrained Accent Strategy
- **Accent Color:** Electric Cobalt (`#2563eb` light / `#3b82f6` dark).
- **Rule of Restraint:** The accent color is used on **less than 2% of the screen**. It is strictly reserved for:
  - The primary canvas action button ("Publish", "Save Draft").
  - The selected node outline / active connection handle.
  - Active tab indicator line.
- **Zero Hue Gradients:** Surface gradients (e.g. violet-to-pink or blue-to-purple) are strictly forbidden. Depth is achieved entirely through solid surface elevation steps and 1px hairlines.

#### Semantic Status Tokens (Engine & Node States)

| Status | Dark Fill / Text | Light Fill / Text | Visual Meaning |
|---|---|---|---|
| `queued` / `idle` | `#85858b` / `#eef0f5` | `#6b7487` / `#111827` | Awaiting worker assignment or untouched |
| `running` / `active` | `#38bdf8` (`#0284c7` light) | Calm Sky/Cyan | In flight; subtle non-pulsing rotational ring |
| `succeeded` / `ready` | `#4cc38a` (`#16a34a` light) | Restrained Mint / Forest Green | Execution finished without error |
| `failed` / `error` | `#e5484d` (`#dc2626` light) | Signal Coral / Crimson | Step failed, exception caught, or validation blocked |
| `cancelled` | `#94a3b8` (`#64748b` light) | Neutral Slate | Execution terminated by user or timeout |
| `skipped` | `#52525b` (`#a1a1aa` light) | Muted Graphite | Condition evaluated false (IF / Filter branch) |

---

### 2.3 Typography & Readability

- **Interface Family:** `Geist Sans` or `Inter` (fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).
- **Code & Figures Family:** `Geist Mono` or `JetBrains Mono` (fallback: `ui-monospace, SFMono-Regular, Menlo, monospace`).
- **Weights:** Restricted strictly to `400` (Regular) and `500` (Medium). Weight `600` is permitted only for modal/page headers. Weights `700`, `800`, `900` are banned.
- **Sentence Case Everywhere:** Labels, headers, table columns, and buttons are formatted in sentence case (`Workflow settings`, `Publish version`, `Execution history`), never uppercase (`WORKFLOW SETTINGS`).
- **Tabular Numerals:** All timestamps, execution run IDs, durations, and counts use CSS `font-variant-numeric: tabular-nums` or `font-mono`.

```css
/* Typography Global Utility Baseline */
.font-sans-ui {
  font-family: var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  letter-spacing: -0.01em;
}

.font-mono-numbers {
  font-family: var(--font-geist-mono), monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
```

---

### 2.4 Component Primitives Catalog

1. **Buttons:**
   - *Primary:* Solid fill (`#eef0f5` dark / `#111827` light) with inverted text, or subtle accent (`#2563eb`). Height: 36px, radius: 8px, padding: 0 16px. Font: 14px/500. Top highlight: `inset 0 1px 0 rgba(255,255,255,0.12)`.
   - *Secondary:* Background `bg-raised`, hairline border, `text-primary`.
   - *Ghost / Subtle:* No background or border until hovered; `text-secondary` transitioning to `text-primary`.
   - *Danger:* Background `transparent` with red hairline, or solid `#e5484d` with white text only for irreversible deletion.
2. **Inputs & Form Controls:**
   - 36px height, `bg-raised` background, 1px `border-hairline`, 8px radius.
   - Text 14px, placeholder in `text-muted`.
   - Focus state: `border-[#3b82f6]` with `ring-1 ring-[#3b82f6]`, no glowing drop-shadow.
3. **Badges & Tags:**
   - Height: 22px, radius: 4px (or 6px), 6px horizontal padding.
   - Font: 12px mono, weight 400.
   - Tone: Muted background (`bg-raised`), subtle hairline, neutral or semantic text. No glowing neon badges.
4. **Drawers & Sheets (Panels):**
   - Slide in from right edge (width 480px) over canvas.
   - Background: `bg-card`, border-left: 1px `border-hairline`.
   - Backdrop: Non-blocking or 20% dark overlay to maintain canvas visibility.
5. **Keycaps:**
   - Monospace shortcut markers (e.g., `⌘K`, `⇧P`, `Del`): 18px height, 4px radius, `bg-raised`, border: 1px `border-hairline`, font: 11px mono, `text-muted`.

---

### 2.5 Catalog of Anti-Patterns Strictly Banned

| Slop Anti-Pattern | Why It Breaks the Product | Unslop Solution |
|---|---|---|
| **Purple/Violet AI Gradients** | Cliches product as generic wrapper; low contrast. | Crisp neutral Ink background with hairline borders. |
| **Glows & Neon Shadows** | Destroys optical clarity; causes visual vibration. | Flat elevation steps: `bg-deep` → `bg-card` → `bg-raised`. |
| **Emoji in Labels/Nav** (`🚀 Publish`, `⚡ Webhook`) | Looks like toy hobbyist project; breaks vertical baseline. | Lucide line icons: 16px/1.5 stroke, colored in `text-secondary`. |
| **Pill Overload** (`rounded-full` everywhere) | Wastes horizontal space, feels juvenile. | Mathematical nested radii: 8px controls, 12px cards, 16px drawers. |
| **Uppercase Tracked Headers** (`TRIGGER PARAMETERS`) | Degrades readability on complex forms. | Clean sentence case: `Trigger parameters`. |
| **Bouncy / Spring Animations** | Slows down power users; induces motion sickness. | Fast mechanical transitions (120–180ms) using `cubic-bezier(0.22, 1, 0.36, 1)`. |
| **Greeting Copy** (`Welcome back, Dmitry! 👋`) | Adds zero functional value. | Functional context: Workspace title, workflow name, or active version. |

---

## 3. React Flow Canvas Architecture

### 3.1 Canvas Layout, Viewport & Controls

The canvas is the core workspace for workflow authoring. It must feel as snappy and responsive as Figma or VS Code.

- **Library:** `@xyflow/react` (React Flow 12+), utilizing standard HTML5 DOM nodes for rich interactive form elements inside node cards.
- **Background:** Subtle dot grid pattern (size 1px dots spaced at 20px intervals, color: `rgba(238, 240, 245, 0.05)` dark / `rgba(17, 24, 39, 0.05)` light).
- **Snap to Grid:** Enabled with 16px snap interval for clean layout alignment.
- **Viewport Controls Dock:**
  - Floats at bottom-left of canvas (margin: 24px).
  - Contains: Zoom In (`+`), Zoom Out (`-`), Zoom to 100% (`1:1`), Fit View (`[ ]`), Minimap Toggle, Lock View.
  - Rendered in a single horizontal or vertical toolbar with 32px square buttons in `bg-card` with `border-hairline`.
- **Minimap:**
  - Collapsible bottom-right panel (width: 180px, height: 120px).
  - Background `bg-card`, node silhouettes rendered in monochrome neutral shades (`#232325`), viewport box outlined in `rgba(59, 130, 246, 0.5)`.

---

### 3.2 Custom Node Card Architecture & Visual Anatomy

Every node in LocalFlow is rendered as an interactive, accessible React Flow custom node.

```text
+-----------------------------------------------------------------------+
| [Icon]  HTTP Request Node                       [Status: Success ●]   |
|         id: node_http_1 · connector: core.http                        |
+-----------------------------------------------------------------------+
| Description: Fetch latest customer orders from Shopify API             |
+-----------------------------------------------------------------------+
| (in) [json] trigger_payload               (out) [json] response_data  |
|                                           (out) [number] status_code  |
+-----------------------------------------------------------------------+
| Timeout: 10s · Retries: 3 · Auth: shopify_api_token                   |
+-----------------------------------------------------------------------+
```

#### Node Card Visual Specifications
- **Width:** Fixed 320px for visual consistency (prevents ragged, uneven diagrams).
- **Background:** `bg-card` (`#171b26`).
- **Border:** 1px `border-hairline` (`rgba(238, 240, 245, 0.08)`).
- **Selected State:** 1.5px border in Cobalt `#3b82f6` with zero outer blur.
- **Error State:** 1.5px border in Coral `#e5484d`.
- **Card Radius:** 12px (`rounded-lg`).
- **Header Section:**
  - 40px height, 12px horizontal padding.
  - Left: 20px rounded badge holding connector icon (e.g. Globe for HTTP, Database for Postgres, Bot for Telegram).
  - Center: Node title (14px, weight 500, `text-primary`, single-line truncated with ellipsis).
  - Right: Execution status dot (8px diameter) or trigger badge (`Trigger`).
- **Body Section:**
  - 8px vertical, 12px horizontal padding.
  - Subtitle / summary (12px, `text-secondary`, 2 lines max).

---

### 3.3 Typed Ports & Connection Rules

Nodes communicate strictly via typed input and output ports. This prevents invalid runtime graphs before execution ever starts.

#### Port Data Types & Visual Codes

| Data Type | Description | Color Dot / Indicator | Supported Coercions |
|---|---|---|---|
| `trigger` | Flow initiation event (no upstream data) | Electric Cyan (`#0ea5e9`) | Cannot be connected to standard data inputs |
| `json` | Structured JSON object or array | Amber (`#f59e0b`) | Can cast to string |
| `string` | Text string | Emerald (`#10b981`) | Coerces to any string-compatible input |
| `number` | Numeric float or integer | Violet / Indigo (`#6366f1`) | Coerces to string |
| `boolean` | True / False evaluation (IF/Filter output) | Rose (`#f43f5e`) | Branches only to conditional ports |
| `binary` | Stream / Buffer (file, image, document) | Orange (`#ea580c`) | Compatible only with binary inputs |
| `any` | Polymorphic / wildcard payload | Muted Slate (`#94a3b8`) | Accepts any connection |

#### Port Handle Mechanics
- **Placement:** Input ports sit on the Left border; Output ports sit on the Right border.
- **Port Dock:** 10px diameter handle, positioned vertically with 20px spacing between multiple ports.
- **Handle Styling:** Neutral ring (`#11141c`) with solid inner core matching type color. On hover or active drag, handle scales up smoothly by 2px with an accessible tooltip showing port name, type, and required status.
- **Port Cardinality:**
  - Input Ports: Cardinality = 1 (a node input receives data from exactly one upstream output, ensuring deterministic evaluation).
  - Output Ports: Cardinality = N (fan-out is fully supported; one output can drive multiple downstream nodes).

---

### 3.4 Edge Routing, Interactive Validation & Cycle Prevention

#### Edge Appearance
- **Path Type:** Smoothstep (orthogonal corners with 8px radius) or smooth cubic Bezier (`pathOptions: { curvature: 0.2 }`).
- **Stroke:** 1.5px width, color `rgba(238, 240, 245, 0.2)` dark / `rgba(17, 24, 39, 0.2)` light.
- **Hover/Selected Stroke:** 2px width, Cobalt `#3b82f6`.
- **Animated Edges:** During live execution, active running edges show a subtle dashed flow animation (dasharray: 4, speed: 1.5s), turning solid green on completion.

#### Interactive Validation Rules (`isValidConnection`)
1. **Self-Connection Prevention:** A node handle cannot connect to another handle on the same node (`connection.source === connection.target` returns `false`).
2. **Directionality:** Connection must strictly flow from `source` (output handle) to `target` (input handle).
3. **Type Compatibility Check:**
   - Compatible if `target.type === 'any'` OR `source.type === 'any'` OR `source.type === target.type`.
   - Incompatible connections return `false`, highlighting the target handle in red with an inline toast/tooltip: *"Cannot connect output of type [sourceType] to input of type [targetType]"*.
4. **Cycle Prevention (Topological DAG Invariant):**
   - Workflows in LocalFlow are strictly Directed Acyclic Graphs (DAGs) to prevent uncontrolled infinite execution loops.
   - **Exception:** Dedicated loop primitives (e.g. `For Each` node) feature an isolated `loop_body` sub-port with bounded iterations, but outer canvas edges must remain acyclic.
   - **Real-Time Cycle Detection Algorithm:**
     Upon drag-connect, before accepting the edge, LocalFlow performs a depth-first search (DFS) traversal or Kahn's algorithm check on the projected graph `(V, E ∪ {newEdge})`. If a back-edge to an ancestor is detected, connection is rejected immediately with visual feedback: *"Circular dependencies are not permitted. Use the 'For Each' loop node for repetitive processing."*

```typescript
// Deterministic Cycle Detection Hook for React Flow
export function hasCycle(nodes: Node[], edges: Edge[], newEdge: Connection): boolean {
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => adj.get(e.source)?.push(e.target));
  
  if (newEdge.source && newEdge.target) {
    adj.get(newEdge.source)?.push(newEdge.target);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    inStack.add(nodeId);

    const neighbors = adj.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (inStack.has(neighbor)) {
        return true; // Cycle detected!
      }
    }

    inStack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true;
    }
  }
  return false;
}
```

---

### 3.5 Draft vs. Published Workflow Version Lifecycle

One of the core architectural differentiators of LocalFlow (PRD ED-05, ADR-005) is that **editing a draft never mutates the active running workflow**.

```text
[ Canvas: Editing Draft v1.3 ] 
      │
      ├─ Auto-saves changes to Draft Storage (PostgreSQL workflow_drafts)
      │
      ├─ [ Test Execution ] ───► Executes draft in isolated sandbox
      │
      └─ [ Publish ] ──────────► Validates DAG & required fields
                                   │
                                   ▼
                              Freezes immutable snapshot v1.3
                              (Active triggers point to v1.3)
```

#### Canvas Version Header Bar
A dedicated 48px sub-header sits directly beneath the top navigation bar when editing a workflow:
- **Left:** Workflow Name + Status Indicator:
  - `Published (v1.2)` (Mint green badge: active production version).
  - `Draft (v1.3 - Unsaved / Saved)` (Neutral amber badge: unpublished working copy).
- **Center:** Quick Version Switcher dropdown:
  - Displays list of past published versions (`v1.2 - Published 2h ago by Dmitry`, `v1.1 - Published yesterday`).
  - Selecting a past version loads it in **Read-Only Inspection Mode** with an option to `Revert Draft to This Version`.
- **Right Action Cluster:**
  - `Discard Draft` (reverts draft canvas back to currently published snapshot).
  - `Test Workflow` (runs test execution of the draft graph).
  - `Publish` (prominent button).

#### Validation Gate Before Publishing
Clicking `Publish` triggers an automatic integrity check:
1. Are there disconnected node inputs marked `required`?
2. Are there invalid credentials or unconfigured fields?
3. Does the workflow contain a valid trigger node?
4. If valid: Creates immutable snapshot in `workflow_versions` with SHA-256 checksum and marks it active.
5. If invalid: Opens an error summary modal listing exact node names and missing fields, jumping the canvas focus directly to the offending node.

---

## 4. Node Configuration Drawer / Panel Architecture

When any node card on the canvas is clicked or double-clicked, the **Node Configuration Drawer** slides smoothly into view from the right side of the screen.

```text
+-------------------------------------------------------------+
| [Icon] HTTP Request                                   [X]   |
| Node ID: http_query_users · Type: core.http                 |
+-------------------------------------------------------------+
| [ General ]      [ Parameters ]      [ Outputs / Schema ]   |
+-------------------------------------------------------------+
| Label *                                                     |
| [ Fetch User Profile                                      ] |
|                                                             |
| HTTP Method *                                               |
| [ GET                                                   v ] |
|                                                             |
| Endpoint URL *                                              |
| [ https://api.example.com/v1/users/{{ trigger.body.userId }}|
|                                                             |
| Authentication                                              |
| [ Credential: prod_api_bearer_token                     v ] |
|   (+) Add new credential                                    |
|                                                             |
| Headers                                                     |
| [ Key: Accept           ] [ Value: application/json       ] |
| [ Key: X-Request-ID     ] [ Value: {{ $execution.id }}    ] |
|                                                             |
| Timeout (ms)                                                |
| [ 5000                                                    ] |
+-------------------------------------------------------------+
| [ Test This Node ]                         [ Save & Close ] |
+-------------------------------------------------------------+
```

### 4.1 Panel Specifications & Layout
- **Dimensions:** Width 480px, pinned to right edge of viewport, full height below canvas header.
- **Non-Modal UX:** The canvas remains interactive and visible while the drawer is open. The user can drag other nodes, pan the canvas, or click another node to switch configuration context without closing and reopening the drawer.
- **Header:** Connector icon, editable custom label (click-to-edit), system node ID (with click-to-copy keycap), close button (`Esc` shortcut).

---

### 4.2 Dynamic Form Engine (JSON Schema & Zod)
Node parameters are defined dynamically via declarative JSON Schema / Zod models provided by the connector manifests (`packages/connector-sdk`).

1. **Primitive Inputs:**
   - Text, Multi-line Text, Number, Boolean Switch, Select Dropdown, Multi-select Tagging.
   - All inputs validate on blur and before publication.
2. **Key-Value Pair Grids:**
   - For HTTP headers, query parameters, webhook secrets, environment overrides.
   - Clean tabular rows with auto-adding blank row at bottom.
3. **Structured Body Editor:**
   - Supports Raw JSON (with syntax highlighting and validation via Monaco / CodeMirror editor) or Form-Data / URL-Encoded key-value pairs.

---

### 4.3 Safe Expression & Variable Picker (`{{ ... }}`)

LocalFlow explicitly forbids unsandboxed JavaScript `eval()`. Data mapping between nodes is achieved through safe JSONPath / mustache-style expression interpolation:
`{{ steps.<node_id>.output.<field> }}` or `{{ trigger.body.<field> }}`.

#### Expression Assistant UX
- When focus is in any string field, pressing `{{` or clicking the `{x}` helper icon opens the **Upstream Variable Picker Popover**.
- The popover lists all nodes preceding the current node in the DAG order:
  - `Trigger: Webhook` (`trigger.body`, `trigger.headers`, `trigger.query`)
  - `Step 1: HTTP Request` (`steps.http_1.output.data`, `steps.http_1.output.status`)
  - `System Context` (`$execution.id`, `$execution.timestamp`, `$workspace.id`)
- Clicking any variable inserts the path into the text field at cursor position.
- Real-time preview shows sample evaluation based on the latest test run or mock schema.

---

### 4.4 Credential & Secret Selector

Handling authentication credentials requires strict security and secret masking (PRD R4, Section 6).

- **Selector Dropdown:**
  - Displays all credentials authorized for the current workspace matching the connector's auth type (e.g., `type: http_bearer_token`, `type: postgres_connection`, `type: telegram_bot_token`).
  - Displays alias name and creator metadata: `prod_stripe_key (Added 3d ago by Dmitry)`.
  - Displays status tag: `Valid`, `Needs Re-auth`, or `Expired`.
- **Zero Plaintext Revelation:**
  - The UI **never** renders plaintext tokens, private keys, or passwords.
  - Value fields render as `••••••••••••••••••••` with a disabled eye icon and tooltip: *"Secrets are encrypted at rest with AES-256-GCM and cannot be revealed via the web interface"*.
- **Inline Credential Creation Modal:**
  - If the required credential does not exist, an `+ Add New Credential` button opens an in-context creation modal.
  - The user inputs the token once; upon saving, it is encrypted via the backend master key, assigned an alias, and immediately selected in the dropdown.

---

## 5. Execution Run Inspector Architecture

The Execution Run Inspector (PRD ED-06, OR-01) provides operators and developers with precise observability into workflow runs.

```text
+--------------------------------------------------------------------------------------------------------+
| Run #exec_98a72c1 · Workflow: "Shopify Sync" v1.2 · Status: Succeeded ● · Duration: 842ms · 2s ago    |
+--------------------------------------------------------------------------------------------------------+
| Step Timeline:                                                                                         |
| [● Webhook Trigger (0ms)] ──► [● HTTP Request (312ms)] ──► [● Branch / IF (2ms)] ──► [● Telegram (528ms)] |
+--------------------------------------------------------------------------------------------------------+
| Inspecting Step: HTTP Request (node_http_1)                                                            |
| +---------------------------------------------------+------------------------------------------------+ |
| | Input Payload (Sanitized)                         | Output Payload (200 OK)                        | |
| | {                                                 | {                                              | |
| |   "method": "GET",                                |   "total_orders": 3,                           | |
| |   "url": "https://api.shopify.com/orders",        |   "orders": [                                  | |
| |   "headers": {                                    |     { "id": 101, "total": "45.00" },           | |
| |     "Authorization": "Bearer [REDACTED_SECRET]"   |     { "id": 102, "total": "120.50" }          | |
| |   }                                               |   ]                                            | |
| | }                                                 | }                                              | |
| +---------------------------------------------------+------------------------------------------------+ |
+--------------------------------------------------------------------------------------------------------+
```

### 5.1 Dual View Modes
1. **Canvas Docked Inspector (Bottom Drawer):**
   - Collapsible panel anchored to the bottom of the canvas (height: 280px to 480px, resizable).
   - Ideal for live interactive testing (`Test Workflow` or `Test Step`).
2. **Dedicated Full-Page Execution View (`/workspaces/:ws/executions/:id`):**
   - Dedicated diagnostic view for historical audits, failed runs, and production monitoring.
   - Includes full execution metadata, correlation ID, retry log, and worker hostname.

---

### 5.2 Real-Time SSE Stream Architecture
- **Protocol:** Server-Sent Events (`GET /api/v1/executions/:id/events`).
- **Event Types:**
  - `execution:started` (initializes run timeline).
  - `step:queued` (marks node as queued on canvas).
  - `step:started` (starts step timer, turns node border cyan).
  - `step:succeeded` (records duration, stores sanitized output, turns node green).
  - `step:failed` (records error class, message, stack, turns node red).
  - `execution:completed` (records final run state and overall latency).
- **Reactive Canvas Highlighting:** During a live execution, the React Flow canvas updates in real time, pulsing the active step without full page re-renders.

---

### 5.3 Step I/O Inspector & Secret Sanitization

- **Dual-Pane JSON Viewer:**
  - Left Pane: Step Input Data (exact arguments and expressions evaluated for this step).
  - Right Pane: Step Output Data (response payload, status code, execution logs).
  - Features: Search/filter keys, copy raw JSON, tree collapse/expand.
- **Sanitization Invariant (Security Gate):**
  - All output payloads pass through an automated masking filter before hitting the database or UI.
  - Any field matching regex `/(token|password|secret|authorization|api_key|credential|private_key)/i` has its value replaced with `***REDACTED***`.
  - Credential bindings display only their configured alias.

---

### 5.4 Error Diagnostics & Remediation Controls

When a step fails:
1. **Prominent Error Banner:**
   - Error Class (e.g., `HttpConnectionTimeoutError`, `DatabaseAuthenticationError`, `JsonPathEvaluationError`).
   - Human-readable explanation: *"Failed to connect to https://api.shopify.com: Connection timed out after 5000ms"*.
   - HTTP Status badge (e.g., `504 Gateway Timeout`).
2. **Action Bar:**
   - `Retry Step` (replays this specific node using frozen upstream output fixtures).
   - `Rerun Full Workflow` (triggers fresh execution with identical original trigger payload).
   - `Cancel Execution` (for active/hanging workflows).

---

## 6. Workspace Management & Setup Flow

### 6.1 Initial Bootstrapping Flow (Single-Install Setup)

To meet PRD acceptance criteria (Deploy & Setup Gate 1 & 2), a freshly deployed LocalFlow instance must guide the operator through a one-time setup wizard before exposing the application.

```text
┌────────────────────────────────────────────────────────┐
│                      LOCALFLOW                         │
│             Initial Instance Setup                     │
│                                                        │
│ Step 1 of 2: Create Owner Account                      │
│                                                        │
│ Full Name                                              │
│ [ Dmitry Sazonov                                     ] │
│                                                        │
│ Email Address                                          │
│ [ admin@localflow.internal                           ] │
│                                                        │
│ Master Password                                        │
│ [ •••••••••••••••••••••••••••••••••••••              ] │
│                                                        │
│ Confirm Password                                       │
│ [ •••••••••••••••••••••••••••••••••••••              ] │
│                                                        │
│ [ Continue to Workspace Setup → ]                      │
└────────────────────────────────────────────────────────┘
```

#### Bootstrap State Detection
1. **Frontend Boot Hook:** On initial web app mount, `apps/web` calls `GET /api/v1/auth/bootstrap-status`.
2. **If `{ initialized: false }`:** Router immediately redirects to `/setup`.
3. **Setup Wizard Steps:**
   - **Step 1: Owner Account:** Full name, email, password (minimum 12 characters, checked against common password blocklists).
   - **Step 2: Primary Workspace:** Workspace name (e.g. `Primary Operations`), organization slug (e.g. `ops`), default timezone (`UTC` or local browser timezone).
   - **Step 3: Setup Completion:** Backend creates the owner user, primary workspace, default owner membership, generates encryption master key verification record, and logs in the owner via an HttpOnly session cookie.
4. **Permanent Lock:** Once initialized, `/api/v1/auth/bootstrap-status` returns `{ initialized: true }`, and any subsequent `POST /api/v1/auth/bootstrap` calls return `403 Forbidden`.

---

### 6.2 Workspace Navigation & Layout Structure

The LocalFlow web application follows a standard desktop-first productivity shell:

```text
+--------------------------------------------------------------------------------------------------------+
| [Logo] LocalFlow  | Workspace: [Primary Ops v] | Search [⌘K]                | Runs: 124 OK | User [D] |
+-------------------+------------------------------------------------------------------------------------+
| NAVIGATION        | MAIN CONTENT AREA                                                                  |
|                   |                                                                                    |
| [●] Overview      | (Workflows List / React Flow Canvas / Execution Table / Credentials Vault)         |
| [ ] Workflows     |                                                                                    |
| [ ] Executions    |                                                                                    |
| [ ] Connections   |                                                                                    |
| [ ] Templates     |                                                                                    |
|                   |                                                                                    |
| WORKSPACE         |                                                                                    |
| [ ] Members       |                                                                                    |
| [ ] Settings      |                                                                                    |
|                   |                                                                                    |
| System Health: OK |                                                                                    |
+-------------------+------------------------------------------------------------------------------------+
```

#### Navigation Views
1. **Overview (`/workspaces/:ws`):**
   - High-level health dashboard: 24h run volume, success rate percentage, recent failure alerts, active trigger status (cron/webhooks).
2. **Workflows (`/workspaces/:ws/workflows`):**
   - Workflow catalog with folder/tag grouping, search, draft vs published badges, and quick execution action.
3. **Executions (`/workspaces/:ws/executions`):**
   - Global execution history table with real-time SSE live updates, filters by status, workflow, date range, and duration.
4. **Connections (`/workspaces/:ws/connections`):**
   - Credential manager: create, test, and rotate API keys, database credentials, and OAuth tokens.
5. **Members & RBAC (`/workspaces/:ws/members`):**
   - Member management table: invite members via one-time tokens; assign roles (`Owner`, `Admin`, `Editor`, `Viewer`).
6. **Settings (`/workspaces/:ws/settings`):**
   - Workspace preferences, webhook base ingress URL, SSRF network allowlist/denylist rules, data retention policy, and backup/export triggers.

---

## 7. Implementation Architecture & Frontend Stack

### 7.1 Recommended Monorepo Layout for Frontend

Following PRD Section 10:

```text
localflow/
├── apps/
│   └── web/                     # Vite + React 19 + TypeScript application
│       ├── src/
│       │   ├── app/             # Router & app providers (QueryClient, AuthProvider)
│       │   ├── components/      # Unslop UI primitives (Button, Card, Input, Badge)
│       │   ├── features/
│       │   │   ├── auth/        # Login, bootstrap setup wizard
│       │   │   ├── canvas/      # React Flow canvas, custom nodes, edges, validation
│       │   │   ├── drawer/      # Node configuration panel, JSON schema forms
│       │   │   ├── execution/   # Run inspector, timeline, sanitized payload viewer
│       │   │   ├── workflows/   # Workflow list, version switcher, publish modal
│       │   │   └── workspaces/  # Workspace switcher, credentials, member management
│       │   ├── hooks/           # useWorkflow, useExecutionSSE, useKeyboardShortcuts
│       │   └── styles/          # Tailwind config, Unslop color tokens, typography
├── packages/
│   ├── ui/                      # Shared design system components & Unslop tokens
│   ├── workflow-schema/         # Zod schemas for DAG, nodes, edges, versions
│   └── connector-sdk/           # Connector manifests, port definitions, parameter schemas
```

### 7.2 Core Dependencies

| Package | Version | Purpose |
|---|---|---|
| `react`, `react-dom` | `^19.0.0` or `^18.3.1` | Modern concurrent React UI |
| `@xyflow/react` | `^12.0.0` | Production React Flow canvas, node/edge mechanics |
| `tailwindcss` | `^3.4.0` | Utility CSS configured with strict Unslop tokens |
| `@radix-ui/*` | Latest | Accessible, unstyled primitives (Dialog, Popover, Dropdown, Tabs) |
| `lucide-react` | Latest | Line icons (16px / 1.5 stroke) replacing all emoji |
| `@tanstack/react-query`| `^5.0.0` | Server state management, caching, SSE sync |
| `react-hook-form` | `^7.50.0` | High-performance dynamic form handling in config drawer |
| `@hookform/resolvers` | `^3.3.0` | Zod schema validation resolver for JSON schema forms |
| `zod` | `^3.23.0` | Shared type validation between API and frontend |
| `i18next` | `^23.0.0` | i18n localization (initial RU/EN per PRD Section 1) |

---

## 8. Verification & Acceptance Checklist

| Item | Requirement | Verification Target |
|---|---|---|
| **V1. Unslop Compliance** | Zero purple gradients, no emoji labels, 4px grid throughout, strict neutral ramps. | Visual inspection of all views; style linter enforcing token usage. |
| **V2. Canvas Interactivity** | Pan, zoom, node drag, 16px snap-to-grid, minimap, keyboard shortcuts (`Del`, `⌘Z`, `Space+Drag`). | 15-node graph manipulation without frame drops or lag. |
| **V3. Typed Ports & Edges** | Source and target port types validated on connection drag; incompatible types rejected. | Attempting to connect `boolean` to `binary` triggers blocked feedback. |
| **V4. Cycle Prevention** | Graph traversal blocks any connection creating a cyclic dependency. | Connecting node C back to node A is blocked with explanatory toast. |
| **V5. Version Immutability** | Modifying canvas updates Draft only; active published version remains untouched. | Draft changes do not alter output of scheduled runs until Published. |
| **V6. Secret Redaction** | No plaintext tokens visible in credentials view, config drawer, or execution logs. | Inspect DOM and network responses to verify tokens are replaced by `***REDACTED***`. |
| **V7. Execution Inspector** | Live SSE updates reflect node states (`queued`, `running`, `succeeded`, `failed`), timings, and payload diffs. | Execute test workflow; observe step transitions and durations. |
| **V8. Bootstrapping** | Fresh install displays `/setup`; completing setup creates owner and locks endpoint. | Subsequent visit to `/setup` returns 403 Forbidden. |

---

*End of UI Architecture & Unslop Design System Specification.*
