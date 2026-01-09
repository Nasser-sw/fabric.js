---
name: rtl-justify-bidi-fix
description: Fix mixed RTL/LTR word order when justify is used
---

# Plan

Goal: fix mixed RTL/LTR text when textAlign includes justify so LTR words keep their order (e.g., 'testing grok' stays in that order) while preserving Arabic shaping. Likely root cause is justify rendering chunking by spaces in logical order, which reverses LTR runs in RTL base.

## Requirements
- Mixed RTL/LTR with textAlign including justify keeps LTR word order.
- No regression for left/center/right aligns or pure RTL/LTR lines.
- Arabic shaping and kashida behavior remain intact.
- Works for Textbox and Text rendering (and editing as applicable).

## Scope
- In: justify rendering path and BiDi run ordering; targeted tests.
- Out: full Unicode BiDi overhaul; new public API.

## Files and entry points
- src/shapes/Text/Text.ts (rendering in _renderChars, justify handling)
- src/text/unicode.ts (BiDi helpers) or src/text/layout.ts (run ordering logic)
- src/shapes/Textbox.ts (confirm advanced layout usage/flags)
- tests/unit/text/layout.test.ts or src/shapes/Text/Text.spec.ts (unit coverage)
- rtl-debug.html (manual repro/validation)

## Data model / API changes
- None expected.

## Action items
[x] Reproduce in rtl-debug.html with mixed text and textAlign: 'justify-right', direction: 'rtl', enableAdvancedLayout: true; confirm LTR words flip only in justify.
[x] Trace rendering path for justify in _renderChars and identify where chunking by spaces breaks BiDi (especially for RTL base).
[x] Implement BiDi-aware justify rendering: detect mixed-direction lines via analyzeBiDi and render runs in visual order, drawing each run string with ctx.direction/ctx.textAlign and anchoring via renderLeft or computed visual positions.
[x] Keep existing fast path for non-justify or pure-direction lines.
[x] Add targeted tests around BiDi run ordering and justify spacing; keep them unit-level (no DOM).
[x] Manually validate in rtl-debug.html with the provided sample string and other mixed cases.

## Testing and validation
- Manual: rtl-debug.html with justify-right, justify, justify-left on mixed Arabic/English.
- Unit: npm run test:vitest -- tests/unit/text/layout.test.ts (or new test file).

## Risks and edge cases
- Arabic shaping regressions if runs are split too small.
- Styled text or per-character styles may need a fallback path.
- Performance impact when computing visual runs per line.
- Mixed numbers/punctuation in RTL lines.

## Open questions
- Are there any AGENTS.md instructions in this repo? I did not find one at the root.
- Should the fix apply to both advanced layout and legacy layout paths, or only when enableAdvancedLayout is true?
