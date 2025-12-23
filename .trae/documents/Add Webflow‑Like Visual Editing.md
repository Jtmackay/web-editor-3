## Answer: Inline Styles via Preview DOM — Is It Risky?
- Short answer: No — we do NOT serialize the rendered DOM back into files. All saves patch the original HTML text selectively, and stylesheets are serialized per file.
- We only read from the live DOM to construct the exact inline `style="…"` string when the element previously had no style attribute. Even then, we patch the source start‑tag deterministically.
- The existing saver already avoids blind DOM dumps and uses targeted text diffs, with explicit ambiguity detection.

## Why This Is Safe In Your Codebase
- HTML patching edits only the changed text and inline `style` declarations (src/components/EditorArea.tsx:1026–1060, 1047–1253).
- New inline props use live DOM style string but inject it into the original start tag anchored by `id` or full `class` text; otherwise it falls back to nearby text content with ambiguity protection (src/components/EditorArea.tsx:1127–1249).
- Ambiguous matches surface a clear error asking for a unique id or adjusted text (src/components/EditorArea.tsx:1237–1243).

## Strengthen Persistence (Anchoring Strategy)
- Prefer unique anchors: `id` or a stable `class` makes saves deterministic.
- If missing, we add safeguards to make matching reliable:
  - Text‑anchor fallback remains capped to a single hit; if multiple hits, require an id/class.
  - Optional lightweight markers: for tough cases, insert a non‑visual `data-wedit-id` in the source once, then use it as the anchor going forward.
  - If inline is ambiguous, automatically propose an external CSS override (same‑origin) instead of forcing inline.

## Edit Mode Implementation (No Extra Risk)
- Inline text editing posts `{ path, oldText, newText, kind }` — saves still patch source text only.
- Resizing and spacing changes become `inlineStyleChanges` entries — the saver rewrites only the `style="…"` attributes.
- Rule edits remain restricted to same‑origin stylesheets; cross‑origin sheets fall back to inline overrides.

## Save Flow (Unchanged, Reliable)
- HTML: targeted string replacements and `style` attribute rewriting; never serializes `innerHTML` of the whole page.
- CSS: per‑stylesheet serialization using `cssRules`, published via FTP, and opened tabs updated (src/components/EditorArea.tsx:1282–1352).

## Enhancements To Add
- Sidecar anchor option: write `data-wedit-id` only when you choose “Make this target stable”; keeps markup clean otherwise.
- “Prefer CSS override” toggle in Changes: for ambiguous inline, generate a selector and write to nearest same‑origin stylesheet.
- Inspector hinting: warn when element lacks stable anchor; offer one‑click “Add id” before saving (for non‑templated pages).

## Outcome
- You get Webflow‑style editing while preserving a source‑accurate save path. No DOM serialization, clear anchors, and deterministic patches make inline style persistence reliable.