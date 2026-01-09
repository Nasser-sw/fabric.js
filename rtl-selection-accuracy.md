---
name: rtl-selection-accuracy
description: Improve Arabic/RTL drag selection accuracy in IText
---

# Plan

Goal: make Arabic/RTL drag selection and highlight accurate by aligning hit testing and selection rendering to the same shaped glyph positions the browser uses, with a DOM-based measurement path and a safe fallback when DOM is unavailable.

## Requirements
- Drag selection and cursor positions are accurate for Arabic/RTL and mixed RTL/LTR.
- No regressions for LTR or non-complex scripts.
- Works with justify and kashida where enabled.
- Safe fallback for node-canvas or non-DOM environments.

## Scope
- In: IText hit testing, cursor/selection rendering, visual position measurement.
- Out: full shaping engine replacement or WebGL changes.

## Files and entry points
- src/shapes/IText/IText.ts (getSelectionStartFromPointer, _measureVisualPositions, _renderSelection, cursor boundaries)
- src/text/hitTest.ts (advanced layout cursor/selection paths)
- src/text/browserLines.ts or new src/text/domMetrics.ts (DOM measurement helpers)
- src/text/measure.ts (if measurement adjustments are needed)
- tests/e2e or tests/unit (selection accuracy coverage)

## Data model / API changes
- Optional new flag for DOM-based selection metrics (example: useDOMSelectionMetrics), or reuse enableAdvancedLayout/overlay editing when DOM is available.
- Cache for DOM-derived visual positions per line with invalidation on layout-affecting changes.

## Action items
[ ] Reproduce in rtl-debug.html with Arabic and mixed text, then drag-select to capture where selection rectangles deviate from glyphs (note direction, textAlign, enableAdvancedLayout, kashida).
[ ] Trace selection pipeline: getSelectionStartFromPointer -> _measureVisualPositions -> _renderSelection, and identify where visual positions diverge from canvas rendering (per-grapheme widths vs shaped run metrics).
[ ] Implement a DOM-based visual position source:
    - Create a hidden mirror element with a single text node (no per-grapheme spans).
    - Use Range to get caret/rect positions at grapheme boundaries without breaking shaping.
    - Map those positions to line-relative visualX and widths, then cache per line.
[ ] Integrate DOM metrics into _measureVisualPositions (and getSelectionStartFromPointer when available); fallback to existing measureText-based logic when DOM is not present.
[ ] Ensure cache invalidation on text, width/height, font, direction, textAlign, lineHeight, and kashida changes (hook into _clearCache / textLayoutProperties).
[ ] Update _renderSelection to use the improved visual positions and keep alignment offsets consistent with render logic for RTL/justify.
[ ] Add tests:
    - Unit tests for index mapping with kashida and selection bounds.
    - Browser/e2e test for RTL drag selection accuracy against known positions.
[ ] Manual validate in rtl-debug.html with Arabic-only and mixed RTL/LTR lines.

## Testing and validation
- Manual: rtl-debug.html drag selection on Arabic/mixed text.
- Automated: Playwright (preferred) or vitest chromium if DOM is needed.

## Risks and edge cases
- DOM Range measurement cost; need caching/throttling during drag.
- Behavior differences in node-canvas (no DOM) requiring fallback.
- Complex scripts with ligatures/diacritics and mixed punctuation/numbers.

## Open questions
- Should DOM-based selection metrics be opt-in (new flag) or enabled automatically when DOM is available?
- Is the issue present only with enableAdvancedLayout or also with legacy layout?
