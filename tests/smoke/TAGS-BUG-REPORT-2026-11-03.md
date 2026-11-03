# Tags, preview and Telegram formatting — bug report, 2026-11-03

## What users of similar tools complain about

| Complaint | Where | What OpenNodes does |
|---|---|---|
| Newcomers mix up mapping a value from an earlier step with typing a fixed one | [Zapier community](https://community.zapier.com/how-do-i-3/importance-of-mapping-fields-19455) | Tags are colored chips with a step number; the picker shows a sample value on every card |
| The sample in the picker differs from live data (a field renamed) | [Zapier community](https://community.zapier.com/featured-articles-65/how-to-manually-map-fields-that-do-not-appear-in-the-sample-data-aka-custom-pill-mapping-9738) | Samples come from the latest run when there is one; any form field can be added by name |
| Internal fields clutter the picker | [Zapier community](https://community.zapier.com/troubleshooting-99/zapier-tables-trigger-showing-internal-field-ids-f3-f8-and-new-old-data-instead-of-column-names-52775) | Plain fields first, a few ready-made posts, run details at the end |
| A steep learning curve for beginners | [Make on G2](https://g2.com/products/make-formerly-integromat/reviews), [n8n on G2](https://g2.com/products/n8n/reviews_and_filters?page=5) | “How it works” in the picker, short labels, one word (“tag”) everywhere |

## How it was checked

| Check | How | Result |
|---|---|---|
| Every card of the picker | `apps/web/tests/tags-audit.test.ts`: 4 chains (RSS, RSS + AI per item, form, Telegram) × every step × every field that takes data, once and per item — 138 cases | Title in both languages, at most 60 characters, no twin title or template in a category, every tag parses, every sample resolves to text |
| Preview = Telegram | `apps/api/tests/preview.test.ts`: 15 kinds of text through the editor’s preview and the server’s Telegram conversion | Same output: bold, italic, links, lists, quotes, code, blank lines, indents |
| Telegram layout | The same file: blank lines, indents, Windows line breaks, cutting a long post | Layout kept; long posts cut between paragraphs |
| Typing in a field | Real keyboard in the browser: Enter, Enter, text, Enter, indented text | Saved exactly as typed |
| Dragging tags | Real mouse in the browser: a tag moved to the end of the text, saved, step reopened | Saved in its new place; a plain click still opens the tag’s menu |
| Every field reaches its service | `apps/api/tests/fields.test.ts` (16 steps) | Pass |
| A fresh install end to end | `scripts/smoke.mjs` on a new local install | 9 of 9 |
| Everything else | build, typecheck, 173 API + 174 web tests, 286 E2E | Pass |

## Bugs found and fixed

| # | Bug | Effect | Fix |
|---|---|---|---|
| 1 | Two Enters in a text field gave one line break | The blank line between paragraphs disappeared | Line breaks go where the caret is; a break at the very end is shown with the caret on the new line |
| 2 | After Enter at the end of the text, what you typed next went before the break | Text came out in the wrong order | Empty text pieces left by the browser are removed before the caret is placed |
| 3 | A long post was cut at the last line break, not between paragraphs | A heading could end one message and its text start the next | Long posts are cut at a blank line first, then a line, then a word |
| 4 | Preview lost the line break before a code block and a quote | The preview did not match the post | Fixed in the preview |
| 5 | Cards repeated each other: “All items: …” as data and as a block, “Text only” = the text tag, “Title only” = the title tag in plain fields | Clutter, unclear which to choose | Duplicates removed |
| 6 | Per item, the RSS step’s link (first item) was offered for links with words | Every post would link to the same first article | Not offered per item |
| 7 | `null null` printed above the picker’s hint | Visible garbage | Fixed |
| 8 | “How it works” could show list items as plain text | Garbled help | Fixed |
| 9 | The picture field held the list of all pictures | Telegram rejected the post | The first address is used; a picture Telegram refuses is shown above the text and the post still goes out |
| 10 | A new switch read as “off” in steps made before it existed | AI titles were not made | Unset switches use their default |

## Changes for clarity

- **Picture and link are their own colored tags,** not part of ready-made posts. The picture tag is green; picked for a message’s text, it goes into the “Picture” field. The link tag is blue.
- **A link with words shows as one tag** — “🔗 Read more” instead of `[Read more](tag)`. Its menu changes the words or shows the address instead.
- **A bold tag shows bold** instead of `**tag**`; “Bold” is a switch in the tag’s menu.
- **The link and picture tag menus** no longer offer UPPERCASE / first 200 characters.
- **Ready-made posts are words only:** “Title + text”, “Title + date + text”, “Title in bold”, with the switches “from the AI / from the item” and “full / short”.
- **Labels:**
  - “How to run the step (optional)” → “How to run the step”.
  - “Picture (link)” → “Picture”.
  - “For each item: Step 2 · Get new RSS items — with the result of step 3” → “For each item from step 2 (RSS feed) + the result of step 3”.
  - Help texts say “tag” throughout and mention dragging.

## Left for later

- An old post saved as `**[tag](tag)**` (a bold linked title) still shows its markup in the field. It is sent correctly.
- Telegram removes blank lines and spaces at the very start and end of a message; the editor removes them on save, so the preview matches.

## Second pass (after feedback)

| # | Problem reported | Cause | Fix | Checked by |
|---|---|---|---|---|
| 11 | The AI title is Russian one time and English the next | The step had “title + text” saved as off, so the model was never asked for a title. When it wrote one anyway, the post used it; when it did not, the feed’s English title was used | Per item, the AI is always asked for `TITLE:` / `TEXT:`. The answer is read with or without bold labels, and Russian labels work too. With no title in the answer, the AI is asked for one more time. The switch is removed | `audit.test`: 6 kinds of model reply, none falls back to the feed title |
| 12 | AI posts have no short text | Only the article had a short version | `postSummary` (“AI text — short”); the “full / short” switch works for AI posts too | `audit.test`, `tags.test` |
| 13 | `items`, `total`, `skipped`, `outputs` in the picker | After a real run, every key of a step’s output was offered as a “field” | Only a form’s (trigger’s) own fields are offered from a run; a step that ran per item offers just “All answers as one text” and “How many items were processed” | `tags.test` with the real keys of a run |
| 14 | Labels do not say what is what | “Title (AI)” next to “Title”; “Result” next to “All results as one text”; run ID for everyone | Every item field says where it comes from: “AI title”, “AI text — full / short”, “Article picture”, “Link to the article”, “Article title”, “Article text — full / short”, “Article date”. One label per value. Run details only in developer mode | `tags.test` (the full list of labels) |

Not checked: a real model. Different models answer differently; the tests cover the forms of answer seen in practice (markers, bold markers, Russian markers, a title line, text only, a sentence first).
