# Editor UX review and implementation · 0.3.0

Scope: workflow canvas, node settings, preset library and desktop update flow.
The review uses the public demo and a local six-node text pipeline, plus keyboard,
serialization and execution checks. This is a heuristic product review, not a
usability study with recruited participants.

## Findings and changes

| Observed problem                                 | Effect                                                    | Implemented change                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| One generic attachment point                     | A line does not say which field receives data             | Separate content, voice, prompt, model and action field inputs; semantic output selection                                            |
| Connection feedback only after dropping          | Users guess valid destinations                            | Gentle glow on compatible inputs while connecting; incompatible ports dim; occupied inputs and cycles rejected by the same predicate |
| Persistent context labels crowd the graph        | Long names collide with lines                             | Port names appear on hover and keyboard focus; accessible names remain present                                                       |
| Setup status and category share the left border  | Category is hard to recognize                             | Dedicated category rail; status remains a text pill                                                                                  |
| An editable field can be overridden by a wire    | Editing looks successful but execution uses another value | Connected fields show their source; disconnect explicitly to return to manual entry                                                  |
| Repeated instructions and headings compete       | Settings lack visual hierarchy                            | Quieter typography, sentence-case sections, consistent spacing; duplicate instruction warning stays beside the instruction field     |
| Language buttons compress in onboarding          | RU and EN wrap vertically                                 | Language control keeps its width and a single row                                                                                    |
| Browser-local presets                            | Libraries disappear in a second editor                    | Workspace persistence, immutable versions, one-time legacy import, revision conflict handling and visible save status                |
| Update could restart after edits during download | Latest edits can be lost                                  | Two save barriers; final barrier freezes editing before native installation confirmation                                             |

## Interaction contract

- Ports use a 28 × 28 logical-pixel button target. Data ports are round;
  context/prompt/model settings use a diamond, so color is not the only cue.
- Click an output, then a highlighted input as a keyboard-friendly alternative to
  dragging. Escape cancels selection. Tooltips also appear on keyboard focus.
- The category palette covers triggers, context, AI, logic, messaging and data.
  Payload colors separately distinguish data, text, voice, prompt and model config.
- A named input accepts one connection. Flow inputs retain merge behavior.
- Insertion between generic flow steps remains available. Named data edges do not
  offer insertion until an unambiguous semantic mapping can be chosen. Deleting a
  node clears its bindings; automatic reconnection applies only to flow edges.
- Update appears before the language switch, including the sign-in screen. The
  browser demo has no native update controls.

## Verification and limits

The initial local preview confirms colored ports, category rails, hover-only
labels, matching-slot glow and the update button position. After migration of the
work environment, the final source is reconstructed and verified by unit and
integration suites. The final cloud browser preview is blocked by its URL policy;
that limitation is not represented as a successful final visual pass.

Coverage includes frontend graph → schema → real execution, stale-expression
replacement, cycle/occupied-slot checks, workspace preset synchronization and
update renderer save/error races. Native archive, manifest, replacement and
rollback fixtures run on macOS in CI. Full update across two published versions,
notarization, external AI providers and a user usability study remain outside the
verified result.
