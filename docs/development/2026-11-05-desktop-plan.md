# macOS application and Node System 2.0 — first implementation

Source: `main` at `dbe7cbffe9550b2f737539a5fa7e593d47bfe175`.
Requirements: `OpenNodes_Node_System_AI_Pipelines_Backlog_v1.md` (2026-11-04).

## Findings

The current app already has a functioning local API, embedded PGlite database,
editor, Brand Voice, Prompt Template, preset versions in the browser, prompt
preview, conflict warnings and Text Reviewer. These must be reused.
The desktop request does not specify an OS; this implementation targets the
user's macOS computer. The editor remains HTML; the host and OS integration use
AppKit/WebKit. This is not a rewrite of the editor in SwiftUI.

## Design

An AppKit executable owns a bundled Node runtime, production dependencies and
the existing editor. No Docker, terminal, separately installed Node or external
server is required to use the packaged app. Runtime storage is separate from
the bundle, in Application Support/OpenNodes. It includes the database and
encryption key. Two loopback servers bind free ports; the editor port is reused
across launches when possible to preserve browser preferences and presets.
The application waits for actual backend readiness before loading the editor.
The subprocess stops cleanly on Quit, SIGTERM or parent pipe closure. Closing
the window keeps automations running, with a menu-bar item to reopen it.

Alternatives: Electron duplicates the browser runtime and increases the package
size; Tauri adds Rust tooling without improving reuse of the existing Node API;
an entirely native editor duplicates the current canvas and slows compatibility
work. AppKit + WKWebView provides a small native shell with the working editor.

## Tasks and verification

- [ ] Add native host, production packaging and a standalone desktop runtime.
  Test runtime readiness, loopback binding, persistent encrypted credentials,
  exclusive data-directory access, occupied port recovery and graceful stop.
- [ ] Add semantic port types, dependency classification and opt-in 1.1 schema
  migration. Preserve existing 1.0 snapshots/checksums. Test explicit invalid
  Text → ImageAsset and legacy compatibility.
- [ ] Fix context connections activating skipped data branches. Test both legacy
  context links and explicit dependency links through the real engine.
- [ ] Reject missing Prompt Template fields with actionable errors. Test missing
  fields separately from empty strings, null, false and zero.
- [ ] Build, typecheck, run the full existing suite and E2E suite; package and
  launch the macOS app; document implemented and remaining MD acceptance items.

## Boundaries of this iteration

This iteration is the desktop application plus the first compatibility and
correctness changes from the MD. ImageAsset storage, image model adapters,
backend preset synchronization, complete named-port editing and the later
creative-automation sprint remain separate work. They are not marked done or
exposed as simulated production features. A complete image pipeline requires
provider credentials and real provider/Docker verification before acceptance.

## Review focus

1. Context must never enable an otherwise inactive data branch.
2. An application update must not overwrite existing data or its encryption key.
3. A second runtime must not open the same embedded database.
4. Startup failure must not leave an invisible process or loading screen forever.
5. Existing published workflow checksums must remain valid.

## Progress

- Initial upstream build: 14/14 packages pass.
- Dependencies install offline from the existing package store.
- Source files retrieved through GitHub; all 355 blob hashes verified.
- First-iteration code, build, typecheck, 286 E2E and focused compatibility tests complete.
- Read-only review findings fixed: dependency peers, stale lock reclamation,
  shutdown during startup, expression double evaluation.
- Full network integration checks remain blocked locally by sandbox `listen EPERM`;
  see desktop-status.md and the normal GitHub CI jobs.
