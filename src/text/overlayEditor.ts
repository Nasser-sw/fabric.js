/**
 * Canva/Polotno-style Overlay Text Editor
 *
 * Provides seamless inline text editing using an HTML textarea overlay
 * that matches canvas text positioning, styling, and transformations.
 */

import type { Canvas } from '../canvas/Canvas';
import type { FabricText } from '../shapes/Text/Text';
import type { IText } from '../shapes/IText/IText';
import type { Textbox } from '../shapes/Textbox';
import type { TPointerEventInfo } from '../EventTypeDefs';
import type { TMat2D } from '../typedefs';
import { transformPoint } from '../util/misc/matrix';

export interface OverlayEditorOptions {
  canvas: Canvas;
  target: FabricText | IText | Textbox;
  onCommit?: (text: string) => void;
  onCancel?: () => void;
}

export interface ScreenTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  angle: number; // in radians
}

export class OverlayEditor {
  private canvas: Canvas;
  private target: FabricText | IText | Textbox;
  private container: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private hostDiv: HTMLDivElement;
  private isDestroyed = false;
  private isComposing = false;
  private lastText: string;
  private onCommit?: (text: string) => void;
  private onCancel?: () => void;

  // Bound event handlers for cleanup
  private boundHandlers = {
    onInput: this.handleInput.bind(this),
    onKeyDown: this.handleKeyDown.bind(this),
    onBlur: this.handleBlur.bind(this),
    onCompositionStart: this.handleCompositionStart.bind(this),
    onCompositionEnd: this.handleCompositionEnd.bind(this),
    onAfterRender: this.handleAfterRender.bind(this),
    onMouseWheel: this.handleMouseWheel.bind(this),
    onFocus: this.handleFocus.bind(this),
    onMouseDown: this.handleMouseDown.bind(this),
  };

  constructor(options: OverlayEditorOptions) {
    this.canvas = options.canvas;
    this.target = options.target;
    this.onCommit = options.onCommit;
    this.onCancel = options.onCancel;
    this.lastText = this.target.text || '';

    this.container = this.getCanvasContainer();
    this.createOverlayDOM();
    this.attachEventListeners();
    this.refresh();
    this.focusTextarea();

    // Note: Don't manage object cursors since IText manages all cursors in _saveEditingProps/_restoreEditingProps
    // The IText editing system handles hoverCursor, moveCursor, and canvas cursors properly

    // Note: Canvas cursors are handled by IText's _saveEditingProps/_restoreEditingProps
    // We don't need to save/restore them here as it would conflict with IText's restoration
  }

  /**
   * Get the container element for the overlay (parent of upperCanvasEl)
   */
  private getCanvasContainer(): HTMLElement {
    const upperCanvas = this.canvas.upperCanvasEl;
    const container = upperCanvas.parentElement;
    if (!container) {
      throw new Error('Canvas must be mounted in DOM to use overlay editing');
    }
    
    // Ensure the container is positioned for absolute overlay positioning
    container.style.position = 'relative';
    
    return container;
  }

  /**
   * Create the overlay DOM structure
   */
  private createOverlayDOM(): void {
    // Host div for positioning and overflow control
    this.hostDiv = document.createElement('div');
    this.hostDiv.style.position = 'absolute';
    this.hostDiv.style.pointerEvents = 'none';
    this.hostDiv.style.zIndex = '1000';
    this.hostDiv.style.transformOrigin = 'left top';

    // Textarea for actual text input
    this.textarea = document.createElement('textarea');
    this.textarea.style.position = 'absolute';
    this.textarea.style.left = '0';
    this.textarea.style.top = '0';
    this.textarea.style.margin = '0';
    this.textarea.style.resize = 'none';
    this.textarea.style.pointerEvents = 'auto';
    // Set appropriate unicodeBidi based on content and direction
    const hasArabicText = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(this.target.text || '');
    const isLTRDirection = (this.target as any).direction === 'ltr';
    
    if (hasArabicText && isLTRDirection) {
      // For Arabic text in LTR mode, use embed to preserve shaping while respecting direction
      this.textarea.style.unicodeBidi = 'embed';
    } else {
      // Default to plaintext for natural text flow
      this.textarea.style.unicodeBidi = 'plaintext';
    }
    this.textarea.style.caretColor = 'auto';

    // Polotno-like base
    this.textarea.style.border = 'none';
    this.textarea.style.padding = '0';
    this.textarea.style.background = 'transparent'; // Transparent so Fabric text shows through
    this.textarea.style.outline = 'none';
    this.textarea.style.overflow = 'hidden'; // Prevent scrollbars
    this.textarea.style.whiteSpace = 'pre-wrap';
    this.textarea.style.wordBreak = 'normal';
    this.textarea.style.overflowWrap = 'break-word';
    this.textarea.style.userSelect = 'text';
    this.textarea.style.textTransform = 'none';

    // Start visible - we'll handle transitions differently
    this.textarea.style.opacity = '1';

    // Set initial text
    this.textarea.value = this.target.text || '';

    this.hostDiv.appendChild(this.textarea);
    document.body.appendChild(this.hostDiv);
  }

  /**
   * Attach all event listeners
   */
  private attachEventListeners(): void {
    // Textarea events
    this.textarea.addEventListener('input', this.boundHandlers.onInput);
    this.textarea.addEventListener('keydown', this.boundHandlers.onKeyDown);
    this.textarea.addEventListener('blur', this.boundHandlers.onBlur);
    this.textarea.addEventListener(
      'compositionstart',
      this.boundHandlers.onCompositionStart,
    );
    this.textarea.addEventListener(
      'compositionend',
      this.boundHandlers.onCompositionEnd,
    );
    this.textarea.addEventListener('focus', this.boundHandlers.onFocus);

    // Canvas events for synchronization
    this.canvas.on('after:render', this.boundHandlers.onAfterRender);
    this.canvas.on('mouse:wheel', this.boundHandlers.onMouseWheel);
    this.canvas.on('mouse:down', this.boundHandlers.onMouseDown);
    
    // Store original methods to detect viewport changes
    this.setupViewportChangeDetection();
  }

  /**
   * Remove all event listeners
   */
  private removeEventListeners(): void {
    this.textarea.removeEventListener('input', this.boundHandlers.onInput);
    this.textarea.removeEventListener('keydown', this.boundHandlers.onKeyDown);
    this.textarea.removeEventListener('blur', this.boundHandlers.onBlur);
    this.textarea.removeEventListener(
      'compositionstart',
      this.boundHandlers.onCompositionStart,
    );
    this.textarea.removeEventListener(
      'compositionend',
      this.boundHandlers.onCompositionEnd,
    );
    this.textarea.removeEventListener('focus', this.boundHandlers.onFocus);

    this.canvas.off('after:render', this.boundHandlers.onAfterRender);
    this.canvas.off('mouse:wheel', this.boundHandlers.onMouseWheel);
    this.canvas.off('mouse:down', this.boundHandlers.onMouseDown);
    
    // Restore original methods
    this.restoreViewportChangeDetection();
  }

  /**
   * Simple method to refresh positioning when canvas changes
   */
  private updatePosition(): void {
    this.applyOverlayStyle();
  }

  /**
   * Update the Fabric object bounds to match current textarea size
   * This ensures Fabric.js selection controls follow the growing textbox
   */
  private updateObjectBounds(): void {
    if (this.isDestroyed) return;

    const target = this.target;
    const zoom = this.canvas.getZoom();
    
    // Get current textbox dimensions from the host div (in canvas coordinates)
    const currentWidth = parseFloat(this.hostDiv.style.width) / zoom;
    const currentHeight = parseFloat(this.hostDiv.style.height) / zoom;
    
    // Only update if there's a meaningful change (avoid float precision issues)
    const heightDiff = Math.abs(currentHeight - target.height);
    const threshold = 1; // 1px threshold to avoid micro-changes
    
    if (heightDiff > threshold) {
      target.height = currentHeight;
      target.setCoords(); // Update control positions
      this.canvas.requestRenderAll(); // Re-render to show updated selection
    }
  }

  /**
   * Convert Fabric charSpacing (1/1000 em) to CSS letter-spacing (px)
   */
  private letterSpacingPx(charSpacing: number, fontSize: number): number {
    return (charSpacing / 1000) * fontSize;
  }

  /**
   * Detect text direction using first strong directional character
   */
  private firstStrongDir(text: string): 'ltr' | 'rtl' {
    // Hebrew: \u0590-\u05FF, Arabic: \u0600-\u06FF, \u0750-\u077F, \uFB50-\uFDFF, \uFE70-\uFEFF
    const rtlRegex =
      /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return rtlRegex.test(text) ? 'rtl' : 'ltr';
  }

  private applyOverlayStyle(): void {
    const target = this.target;
    const canvas = this.canvas;

    // 1. Freshen object's transformations - use aCoords like rtl-test.html
    target.setCoords();
    const aCoords = target.aCoords;
    
    // DEBUG: Log dimensions before edit
    console.log('BEFORE EDIT:');
    console.log('  target.width =', (target as any).width);
    console.log('  target.height =', target.height);
    console.log('  target.getScaledWidth() =', target.getScaledWidth());
    console.log('  target.getScaledHeight() =', target.getScaledHeight());
    console.log('  target.padding =', (target as any).padding);
    
    // 2. Get canvas position and scroll offsets (like rtl-test.html)
    const canvasEl = canvas.upperCanvasEl;
    const canvasRect = canvasEl.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // 3. Position and dimensions accounting for Fabric Textbox padding and viewport transform
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform;
    const padding = (target as any).padding || 0;
    const paddingX = padding * (target.scaleX || 1) * zoom;
    const paddingY = padding * (target.scaleY || 1) * zoom;

    // Transform object's top-left corner coordinates to screen coordinates using viewport transform
    // aCoords.tl already accounts for object positioning and scaling, just need viewport transform
    const screenPoint = transformPoint({ x: aCoords.tl.x, y: aCoords.tl.y }, vpt);
    
    const left = canvasRect.left + scrollX + screenPoint.x;
    const top = canvasRect.top + scrollY + screenPoint.y;

    // 4. Get dimensions with zoom scaling - use target.width for text wrapping, scaled height for container
    const width = (target as any).width * (target.scaleX || 1) * zoom; // Account for object scale and viewport zoom
    const height = target.height * (target.scaleY || 1) * zoom;
    
    console.log('WIDTH CALCULATION:');
    console.log('  target.width =', (target as any).width);
    console.log('  scaledWidth =', target.getScaledWidth());
    console.log('  zoom =', zoom);
    console.log('  final width =', width);

    // 5. Apply styles to host DIV - absolute positioning like rtl-test.html
    this.hostDiv.style.position = 'absolute';
    this.hostDiv.style.left = `${left}px`;
    this.hostDiv.style.top = `${top}px`;
    this.hostDiv.style.width = `${width}px`;
    this.hostDiv.style.height = `${height}px`;
    this.hostDiv.style.overflow = 'hidden'; // Prevent scrollbars in host div
    // Apply rotation matching Fabric.js object transformation
    if (target.angle) {
      this.hostDiv.style.transform = `rotate(${target.angle}deg)`;
      this.hostDiv.style.transformOrigin = 'top left'; // Match Fabric Textbox behavior
    } else {
      this.hostDiv.style.transform = '';
      this.hostDiv.style.transformOrigin = '';
    }

    // 6. Style the textarea - match Fabric's exact rendering with padding
    const baseFontSize = (target.fontSize ?? 16);
    // Use scaleX for font scaling to match Fabric text scaling exactly
    const scaleX = target.scaleX || 1;
    const finalFontSize = baseFontSize * scaleX * zoom;
    const fabricLineHeight = target.lineHeight || 1.16;
    // Apply padding and dimensions to textarea
    const textareaWidth = paddingX > 0 ? `calc(100% - ${2 * paddingX}px)` : '100%';
    const textareaHeight = paddingY > 0 ? `calc(100% - ${2 * paddingY}px)` : '100%';
    
    this.textarea.style.width = textareaWidth;
    this.textarea.style.height = textareaHeight;
    this.textarea.style.padding = `${paddingY}px ${paddingX}px`;
    
    this.textarea.style.fontSize = `${finalFontSize}px`;
    this.textarea.style.lineHeight = String(fabricLineHeight); // Use unit-less multiplier
    this.textarea.style.fontFamily = target.fontFamily || 'Arial';
    this.textarea.style.fontWeight = String(target.fontWeight || 'normal');
    this.textarea.style.fontStyle = target.fontStyle || 'normal';
    this.textarea.style.textAlign = (target as any).textAlign || 'left';
    this.textarea.style.color = target.fill?.toString() || '#000';
    this.textarea.style.letterSpacing = `${((target.charSpacing || 0) / 1000)}em`;
    this.textarea.style.direction = (target as any).direction || this.firstStrongDir(this.textarea.value || '');
    
    // Ensure consistent font rendering between Fabric and CSS
    this.textarea.style.fontVariant = 'normal';
    this.textarea.style.fontStretch = 'normal';
    this.textarea.style.textRendering = 'auto';
    this.textarea.style.fontKerning = 'auto';
    this.textarea.style.boxSizing = 'content-box'; // Padding is added outside width/height
    this.textarea.style.margin = '0';
    this.textarea.style.border = 'none';
    this.textarea.style.outline = 'none';
    this.textarea.style.background = 'transparent';
    this.textarea.style.wordWrap = 'break-word';
    this.textarea.style.whiteSpace = 'pre-wrap';
    
    // DEBUG: Log final textarea dimensions
    console.log('TEXTAREA AFTER SETUP:');
    console.log('  textarea width =', this.textarea.style.width);
    console.log('  textarea height =', this.textarea.style.height);
    console.log('  textarea padding =', this.textarea.style.padding);
    console.log('  paddingX =', paddingX, 'paddingY =', paddingY);
    console.log('  baseFontSize =', baseFontSize);
    console.log('  scaleX =', scaleX);
    console.log('  zoom =', zoom);
    console.log('  finalFontSize =', finalFontSize);
    console.log('  fabricLineHeight =', fabricLineHeight);

    // Initial bounds are set correctly by Fabric.js - don't force update here

    
  }

  /**
   * Focus the textarea and position cursor at end
   */
  private focusTextarea(): void {
    

    // For overlay editing, we want to keep the object in "selection mode" not "editing mode"
    // This means keeping selected=true and isEditing=false to show boundaries
    
    // Hide the text content only (not the entire object)
    this.target.opacity = 0.01; // Nearly transparent but not fully hidden
    
    // Ensure object stays selected to show boundaries
    (this.target as any).selected = true;
    (this.target as any).isEditing = false; // Override any editing state
    
    // Make sure controls are enabled and movement is allowed during overlay editing
    this.target.set({
      hasControls: true,
      hasBorders: true,
      selectable: true,
      lockMovementX: false,
      lockMovementY: false
    });
    
    // Keep as active object
    this.canvas.setActiveObject(this.target);
    
    this.canvas.requestRenderAll();
    this.target.setCoords();
    this.applyOverlayStyle();

    

    this.textarea.focus();
    this.textarea.setSelectionRange(
      this.textarea.value.length,
      this.textarea.value.length,
    );
    
    // Ensure the object stays selected even after textarea focus
    this.canvas.setActiveObject(this.target);
    this.canvas.requestRenderAll();
  }

  /**
   * Refresh overlay positioning and styling
   */
  public refresh(): void {
    if (this.isDestroyed) return;
    this.updatePosition();
    // Don't update object bounds on every refresh - only when textarea actually resizes
  }

  /**
   * Destroy the overlay editor
   */
  public destroy(commit: boolean = true): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.removeEventListeners();

    // Restore target visibility before handling commit/cancel
    if ((this.target as any).__overlayEditor === this) {
      (this.target as any).__overlayEditor = undefined;

      // Restore original opacity
      if ((this.target as any).__overlayOriginalOpacity !== undefined) {
        this.target.opacity = (this.target as any).__overlayOriginalOpacity;
        delete (this.target as any).__overlayOriginalOpacity;
      }
    }

    // Remove DOM first
    if (this.hostDiv.parentNode) {
      this.hostDiv.parentNode.removeChild(this.hostDiv);
    }

    // Handle commit/cancel after restoring visibility
    if (commit && !this.isComposing) {
      const finalText = this.textarea.value;
      if (this.onCommit) {
        this.onCommit(finalText);
      }
    } else if (!commit && this.onCancel) {
      this.onCancel();
    }

    // Note: Don't restore object cursors since IText manages all cursors in _restoreEditingProps
    // Let the IText editing system handle proper restoration of all cursor properties

    // Note: Canvas cursors are restored by IText's _restoreEditingProps method
    // Force a cursor refresh by triggering _setCursorFromEvent
    setTimeout(() => {
      this.canvas.upperCanvasEl.style.cursor = '';
      // Trigger cursor refresh on next mouse move
      this.canvas.setCursor(this.canvas.defaultCursor);
    }, 0);

    // Request canvas re-render
    this.canvas.requestRenderAll();
  }

  // Event handlers
  private handleInput(): void {
    if (!this.isComposing && this.target.text !== this.textarea.value) {
      // Live update target text
      this.target.text = this.textarea.value;

      // Auto-resize textarea to match new content
      this.autoResizeTextarea();

      // Ensure object stays in selection mode (not editing mode) to show controls
      (this.target as any).selected = true;
      (this.target as any).isEditing = false;
      this.canvas.setActiveObject(this.target);
      this.canvas.requestRenderAll();
    }
  }

  private autoResizeTextarea(): void {
    // Allow both vertical growth and shrinking; host width stays fixed
    const oldHeight = parseFloat(window.getComputedStyle(this.textarea).height);
    
    // Reset height to measure actual needed height
    this.textarea.style.height = 'auto';
    const scrollHeight = this.textarea.scrollHeight;
    
    // Add extra padding to prevent text clipping (especially for line height)
    const lineHeightBuffer = 8; // Extra space to prevent clipping
    const newHeight = Math.max(scrollHeight + lineHeightBuffer, 25); // Minimum height with buffer
    const heightChanged = Math.abs(newHeight - oldHeight) > 2; // Only if meaningful change
    
    this.textarea.style.height = `${newHeight}px`;
    this.hostDiv.style.height = `${newHeight}px`; // Match exactly
    
    // Only update object bounds if height actually changed
    if (heightChanged) {
      this.updateObjectBounds();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.destroy(false); // Cancel
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      this.destroy(true); // Commit
    }
  }

  private handleFocus(): void {
    // Focus handler - could be used for future enhancements
  }

  private handleBlur(): void {
    // Commit on blur unless we're in composition mode
    if (!this.isComposing) {
      this.destroy(true);
    }
  }

  private handleCompositionStart(): void {
    this.isComposing = true;
  }

  private handleCompositionEnd(): void {
    this.isComposing = false;
    this.handleInput(); // Update text after composition
  }

  private handleAfterRender(): void {
    this.refresh();
  }

  private handleMouseWheel(): void {
    this.refresh();
  }

  private handleMouseDown(e: TPointerEventInfo): void {
    if (e.target !== this.target) {
      this.destroy(true);
    }
  }

  /**
   * Setup detection for viewport changes (zoom/pan)
   */
  private setupViewportChangeDetection(): void {
    // Store original methods
    (this.canvas as any).__originalSetZoom = this.canvas.setZoom;
    (this.canvas as any).__originalSetViewportTransform = this.canvas.setViewportTransform;
    (this.canvas as any).__overlayEditor = this;
    
    // Override setZoom to detect zoom changes
    const originalSetZoom = this.canvas.setZoom.bind(this.canvas);
    this.canvas.setZoom = (value: number) => {
      const result = originalSetZoom(value);
      if ((this.canvas as any).__overlayEditor && !this.isDestroyed) {
        this.refresh();
      }
      return result;
    };
    
    // Override setViewportTransform to detect pan changes
    const originalSetViewportTransform = this.canvas.setViewportTransform.bind(this.canvas);
    this.canvas.setViewportTransform = (vpt: TMat2D) => {
      const result = originalSetViewportTransform(vpt);
      if ((this.canvas as any).__overlayEditor && !this.isDestroyed) {
        this.refresh();
      }
      return result;
    };
  }
  
  /**
   * Restore original viewport methods
   */
  private restoreViewportChangeDetection(): void {
    if ((this.canvas as any).__originalSetZoom) {
      this.canvas.setZoom = (this.canvas as any).__originalSetZoom;
      delete (this.canvas as any).__originalSetZoom;
    }
    if ((this.canvas as any).__originalSetViewportTransform) {
      this.canvas.setViewportTransform = (this.canvas as any).__originalSetViewportTransform;
      delete (this.canvas as any).__originalSetViewportTransform;
    }
    delete (this.canvas as any).__overlayEditor;
  }

  
}

/**
 * Enter overlay text editing mode for a text object
 */
export function enterTextOverlayEdit(
  canvas: Canvas,
  target: FabricText | IText | Textbox,
  options?: {
    onCommit?: (text: string) => void;
    onCancel?: () => void;
  },
): OverlayEditor {
  // If already in overlay editing, destroy existing editor first
  if ((target as any).__overlayEditor) {
    (target as any).__overlayEditor.destroy(false);
  }

  // Store original opacity so we can restore it later
  (target as any).__overlayOriginalOpacity = target.opacity;

  const editor = new OverlayEditor({
    canvas,
    target,
    onCommit: options?.onCommit,
    onCancel: options?.onCancel,
  });

  // We no longer change fill, so no need to store it
  
  // Store reference on target for cleanup
  (target as any).__overlayEditor = editor;

  return editor;
}

/**
 * Check if a text object is currently being edited with overlay editor
 */
export function isInOverlayEdit(target: FabricText | IText | Textbox): boolean {
  return !!(target as any).__overlayEditor?.isActive;
}
