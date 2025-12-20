import type {
  ObjectPointerEvents,
  TPointerEvent,
  TPointerEventInfo,
} from '../../EventTypeDefs';
import { Point } from '../../Point';
import { invertTransform } from '../../util/misc/matrix';
import { DraggableTextDelegate } from './DraggableTextDelegate';
import type { ITextEvents } from './ITextBehavior';
import { ITextKeyBehavior } from './ITextKeyBehavior';
import type { TOptions } from '../../typedefs';
import type { TextProps, SerializedTextProps } from '../Text/Text';
import type { IText } from './IText';
/**
 * `LEFT_CLICK === 0`
 */
const notALeftClick = (e: Event) => !!(e as MouseEvent).button;

export abstract class ITextClickBehavior<
  Props extends TOptions<TextProps> = Partial<TextProps>,
  SProps extends SerializedTextProps = SerializedTextProps,
  EventSpec extends ITextEvents = ITextEvents,
> extends ITextKeyBehavior<Props, SProps, EventSpec> {
  protected draggableTextDelegate: DraggableTextDelegate;

  initBehavior() {
    // Initializes event handlers related to cursor or selection
    this.on('mousedown', this._mouseDownHandler);
    this.on('mouseup', this.mouseUpHandler);
    this.on('mousedblclick', this.doubleClickHandler);
    this.on('mousetripleclick', this.tripleClickHandler);

    this.draggableTextDelegate = new DraggableTextDelegate(
      this as unknown as IText,
    );

    super.initBehavior();
  }

  /**
   * If this method returns true a mouse move operation over a text selection
   * will not prevent the native mouse event allowing the browser to start a drag operation.
   * shouldStartDragging can be read 'do not prevent default for mouse move event'
   * To prevent drag and drop between objects both shouldStartDragging and onDragStart should return false
   * @returns
   */
  shouldStartDragging() {
    return this.draggableTextDelegate.isActive();
  }

  /**
   * @public override this method to control whether instance should/shouldn't become a drag source,
   * @see also {@link DraggableTextDelegate#isActive}
   * To prevent drag and drop between objects both shouldStartDragging and onDragStart should return false
   * @returns {boolean} should handle event
   */
  onDragStart(e: DragEvent) {
    return this.draggableTextDelegate.onDragStart(e);
  }

  /**
   * @public override this method to control whether instance should/shouldn't become a drop target
   */
  canDrop(e: DragEvent) {
    return this.draggableTextDelegate.canDrop(e);
  }

  /**
   * Default handler for double click, select a word or enter overlay editing
   */
  doubleClickHandler(options: TPointerEventInfo) {
    // Check if we should enter overlay editing mode
    if (!this.isEditing && (this as any).useOverlayEditing && this.editable) {
      this.enterEditing(options.e);
      return;
    }
    
    // Default behavior: select word if already editing
    if (!this.isEditing) {
      return;
    }
    this.selectWord(this.getSelectionStartFromPointer(options.e));
    this.renderCursorOrSelection();
  }

  /**
   * Default handler for triple click, select a line
   */
  tripleClickHandler(options: TPointerEventInfo) {
    if (!this.isEditing) {
      return;
    }
    this.selectLine(this.getSelectionStartFromPointer(options.e));
    this.renderCursorOrSelection();
  }

  /**
   * Default event handler for the basic functionalities needed on _mouseDown
   * can be overridden to do something different.
   * Scope of this implementation is: find the click position, set selectionStart
   * find selectionEnd, initialize the drawing of either cursor or selection area
   * initializing a mousedDown on a text area will cancel fabricjs knowledge of
   * current compositionMode. It will be set to false.
   */
  _mouseDownHandler({ e, alreadySelected }: ObjectPointerEvents['mousedown']) {
    if (
      !this.canvas ||
      !this.editable ||
      notALeftClick(e) ||
      this.getActiveControl()
    ) {
      return;
    }

    if (this.draggableTextDelegate.start(e)) {
      return;
    }

    this.canvas.textEditingManager.register(this);

    if (alreadySelected) {
      this.inCompositionMode = false;
      this.setCursorByClick(e);
    }

    if (this.isEditing) {
      this.__selectionStartOnMouseDown = this.selectionStart;
      if (this.selectionStart === this.selectionEnd) {
        this.abortCursorAnimation();
      }
      this.renderCursorOrSelection();
    }
    this.selected ||= alreadySelected || this.isEditing;
  }

  /**
   * standard handler for mouse up, overridable
   * @private
   */
  mouseUpHandler({ e, transform }: ObjectPointerEvents['mouseup']) {
    const didDrag = this.draggableTextDelegate.end(e);

    if (this.canvas) {
      this.canvas.textEditingManager.unregister(this);

      const activeObject = this.canvas._activeObject;
      if (activeObject && activeObject !== this) {
        // avoid running this logic when there is an active object
        // this because is possible with shift click and fast clicks,
        // to rapidly deselect and reselect this object and trigger an enterEdit
        return;
      }
    }

    if (
      !this.editable ||
      (this.group && !this.group.interactive) ||
      (transform && transform.actionPerformed) ||
      notALeftClick(e) ||
      didDrag
    ) {
      return;
    }

    if (this.selected && !this.getActiveControl()) {
      this.enterEditing(e);
      if (this.selectionStart === this.selectionEnd) {
        this.initDelayedCursor(true);
      } else {
        this.renderCursorOrSelection();
      }
    }
  }

  /**
   * Changes cursor location in a text depending on passed pointer (x/y) object
   * @param {TPointerEvent} e Event object
   */
  setCursorByClick(e: TPointerEvent) {
    const newSelection = this.getSelectionStartFromPointer(e),
      start = this.selectionStart,
      end = this.selectionEnd;
    if (e.shiftKey) {
      this.setSelectionStartEndWithShift(start, end, newSelection);
    } else {
      this.selectionStart = newSelection;
      this.selectionEnd = newSelection;
    }
    if (this.isEditing) {
      this._fireSelectionChanged();
      this._updateTextarea();
    }
  }

  /**
   * Returns index of a character corresponding to where an object was clicked
   * @param {TPointerEvent} e Event object
   * @return {Number} Index of a character
   */
  getSelectionStartFromPointer(e: TPointerEvent): number {
    const mouseOffset = this.canvas!.getScenePoint(e)
      .transform(invertTransform(this.calcTransformMatrix()))
      .add(new Point(-this._getLeftOffset(), -this._getTopOffset()));

    if (this.direction === 'rtl') {
      mouseOffset.x *= -1;
    }

    let height = 0,
      charIndex = 0,
      lineIndex = 0;

    for (let i = 0; i < this._textLines.length; i++) {
      if (height <= mouseOffset.y) {
        height += this.getHeightOfLine(i);
        lineIndex = i;
        if (i > 0) {
          charIndex +=
            this._textLines[i - 1].length + this.missingNewlineOffset(i - 1);
        }
      } else {
        break;
      }
    }

    const lineLeftOffset = this._getLineLeftOffset(lineIndex);
    const charLength = this._textLines[lineIndex].length;
    const chars = this.__charBounds[lineIndex];

    const lineStartIndex = charIndex;
    // use character left positions which are always increasing even with RTL segments

    for (let j = 0; j < charLength; j++) {
      const charStart = lineLeftOffset + chars[j].left;
      // For last character, use its width to calculate end position
      const charEnd = lineLeftOffset + (chars[j + 1]?.left ?? (chars[j].left + chars[j].kernedWidth));
      const charMiddle = (charStart + charEnd) / 2;
      if (mouseOffset.x <= charMiddle) {
        charIndex = lineStartIndex + j;
        break;
      } else if (mouseOffset.x <= charEnd) {
        charIndex = lineStartIndex + j + 1;
        break;
      }
      charIndex = lineStartIndex + charLength;
    }

    let lineCharIndex = charIndex - lineStartIndex;

    // Handle flipX
    if (this.flipX) {
      lineCharIndex = charLength - lineCharIndex;
    }

    // Convert display index to original index (handles kashida)
    const originalLineCharIndex = (this as any)._displayToOriginalIndex(lineIndex, lineCharIndex);

    // Calculate original line start (sum of original line lengths before this line)
    let originalLineStart = 0;
    for (let i = 0; i < lineIndex; i++) {
      const originalLineLength = (this as any)._getOriginalLineLength(i);
      originalLineStart += originalLineLength + this.missingNewlineOffset(i);
    }

    const originalIndex = originalLineStart + originalLineCharIndex;
    return Math.min(originalIndex, this.text.length);
  }
}
