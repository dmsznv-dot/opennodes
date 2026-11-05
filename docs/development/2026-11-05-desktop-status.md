# Desktop and node-system implementation status

Base: `main` at `dbe7cbffe9550b2f737539a5fa7e593d47bfe175`.
Specification: `OpenNodes_Node_System_AI_Pipelines_Backlog_v1.md`, 2026-11-04.

## Implemented in this iteration

| Area | Result |
| --- | --- |
| macOS | AppKit window/menus, Dock icon and menu-bar item; WKWebView editor |
| Local engine | Bundled Node, production dependency closure, PGlite; no Docker required |
| Persistence | Database and encryption key outside the bundle; stable editor origin across launches when the port is available |
| Lifecycle | Ready event after API startup; error/retry screen; parent-pipe closure and Quit stop the runtime; window close keeps it running |
| Exclusive database access | OS flock helper; no PID-based stale-lock deletion; concurrent launch/crash-release test |
| Distribution | Architecture-specific ZIP, original app icon, Node/dependency licenses, ad-hoc signature verification |
| Semantic types | Text, Context, Prompt, ImageAsset, ImageCollection, Document and ModelConfig port types |
| Versioning | Reads 1.0 and 1.1; explicit copy-only draft migration; published 1.0 snapshots are not rewritten |
| Context correctness | Legacy and explicit context dependencies cannot activate an inactive data branch |
| Prompt correctness | Missing nested fields report an error; empty/null/false/zero remain valid; expressions are evaluated once |
| Setup copy | Workspace terminology and no promise of future team invitations |

## Verification

- Build: 15/15 packages pass.
- Typecheck: 27 tasks pass.
- Existing E2E harness: 286/286 pass.
- Workflow schema, engine and execution-runtime suites: 49 + 14 + 17 tests pass.
- Production bundle import after relocation: passes (includes installed peer dependencies).
- OS lock: eight simultaneous attempts produce one owner; process death permits the next owner.
- Native UI: starts the real editor at the local first-start screen; close/reopen retains the same runtime and origin.
- Full `pnpm test` is **not green in the local execution sandbox**: localhost binding
  returns `EPERM`. Affected tests include existing SSRF/pinned-lookup fixtures,
  API/web integration fixtures and desktop network/persistence integration tests.
  They remain enabled. GitHub CI, including a macOS build/artifact job, runs them
  in a normal network-capable environment.
- Docker and real AI provider calls are not validated in this iteration.

Review catches and fixes: installed peer dependencies missing from the first
bundle; concurrent stale-lock deletion; exit before startup cleanup; double
evaluation of template expressions. Each has a focused regression check or a
direct lifecycle fix. No real credentials are included in the source or app.

## Remaining MD scope — not represented as complete

1. Complete named-port editing and automatic binding of Context/Prompt/ModelConfig.
   Current context executors still run as pure steps in the existing scheduler;
   the dependency/data distinction introduced here fixes routing but is not a
   replacement context-resolution engine.
2. Backend synchronization/version storage for the reusable preset library.
   Existing browser presets and embedded published copies remain in use.
3. Full Basic/Advanced/Developer controls and capability-driven model settings.
4. ImageAsset file storage, quotas/retention, authenticated upload/download,
   image input/editor, provider adapters and before/after previews.
5. Prompt Stack, image generation/transforms/style references and the complete
   creative-automation acceptance scenario.
6. Developer ID signing, Apple notarization and any Windows-native distribution.

The semantic ImageAsset type is a graph contract only; this iteration does not
claim that an image-edit provider is connected or simulate a successful edit.
