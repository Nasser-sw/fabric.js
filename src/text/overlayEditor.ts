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
    const hasArabicText =
      /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
        this.target.text || '',
      );
    const hasLatinText = /[a-zA-Z]/.test(this.target.text || '');
    const isLTRDirection = (this.target as any).direction === 'ltr';

    if (hasArabicText && hasLatinText && isLTRDirection) {
      // For mixed Arabic/Latin text in LTR mode, use embed for consistent line wrapping
      this.textarea.style.unicodeBidi = 'embed';
    } else if (hasArabicText && isLTRDirection) {
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

    // Always update height for responsive controls (especially important for line deletion)
    const heightDiff = Math.abs(currentHeight - target.height);
    const threshold = 0.5; // Lower threshold for better responsiveness to line changes

    if (heightDiff > threshold) {
      const oldHeight = target.height;
      target.height = currentHeight;
      target.setCoords(); // Update control positions

      // Force dirty to ensure proper re-rendering
      target.dirty = true;
      this.canvas.requestRenderAll(); // Re-render to show updated selection

      // IMPORTANT: Reposition overlay after height change
      requestAnimationFrame(() => {
        if (!this.isDestroyed) {
          this.applyOverlayStyle();
          // console.log(
          //   '📐 Height changed - rechecking alignment after repositioning:',
          // );
        }
      });
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
    const screenPoint = transformPoint(
      { x: aCoords.tl.x, y: aCoords.tl.y },
      vpt,
    );

    const left = canvasRect.left + scrollX + screenPoint.x;
    const top = canvasRect.top + scrollY + screenPoint.y;

    // 4. Calculate the precise width and height for the container
    // **THE FIX:** Use getBoundingRect() for BOTH width and height.
    // This is the most reliable measure of the object's final rendered dimensions.
    const objectBounds = target.getBoundingRect();
    const width = Math.round(objectBounds.width * zoom);
    const height = Math.round(objectBounds.height * zoom);

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
    const baseFontSize = target.fontSize ?? 16;
    // Use scaleX for font scaling to match Fabric text scaling exactly
    const scaleX = target.scaleX || 1;
    const finalFontSize = baseFontSize * scaleX * zoom;
    const fabricLineHeight = target.lineHeight || 1.16;
    // **THE FIX:** Use 'border-box' so the width property includes padding.
    // This makes alignment much easier and more reliable.
    this.textarea.style.boxSizing = 'border-box';

    // **THE FIX:** Set the textarea width to be IDENTICAL to the host div's width.
    // The padding will now be correctly contained *inside* this width.
    this.textarea.style.width = `${width}px`;
    this.textarea.style.height = '100%'; // Let hostDiv control height
    this.textarea.style.padding = `${paddingY}px ${paddingX}px`;

    // Apply all other font and text styles to match Fabric
    const letterSpacingPx = ((target.charSpacing || 0) / 1000) * finalFontSize;
    
    // Special handling for text objects loaded from JSON - ensure they're properly initialized
    if (target.dirty !== false && target.initDimensions) {
      // console.log('🔧 Ensuring text object is properly initialized before overlay editing');
      // Force re-initialization if the text object seems to be in a dirty state
      target.initDimensions();
    }

    this.textarea.style.fontSize = `${finalFontSize}px`;
    this.textarea.style.lineHeight = String(fabricLineHeight);
    this.textarea.style.fontFamily = target.fontFamily || 'Arial';
    this.textarea.style.fontWeight = String(target.fontWeight || 'normal');
    this.textarea.style.fontStyle = target.fontStyle || 'normal';
    // Handle text alignment and justification
    const textAlign = (target as any).textAlign || 'left';
    let cssTextAlign = textAlign;
    
    // Detect text direction from content for proper justify handling
    const autoDetectedDirection = this.firstStrongDir(this.textarea.value || '');
    
    // DEBUG: Log alignment details
    // console.log('🔍 ALIGNMENT DEBUG:');
    // console.log('   Fabric textAlign:', textAlign);
    // console.log('   Fabric direction:', (target as any).direction);
    // console.log('   Text content:', JSON.stringify(target.text));
    // console.log('   Detected direction:', autoDetectedDirection);
    
    // Map fabric.js justify to CSS
    if (textAlign.includes('justify')) {
      // Try to match fabric.js justify behavior more precisely
      try {
        // For justify, we need to replicate fabric.js space expansion
        // Use CSS justify but with specific settings to match fabric.js better
        cssTextAlign = 'justify';
        
        // Set text-align-last based on justify type and detected direction
        // Smart justify: respect detected direction even when fabric alignment doesn't match
        if (textAlign === 'justify') {
          this.textarea.style.textAlignLast = autoDetectedDirection === 'rtl' ? 'right' : 'left';
        } else if (textAlign === 'justify-left') {
          // If text is RTL but fabric says justify-left, override to justify-right for better UX
          if (autoDetectedDirection === 'rtl') {
            this.textarea.style.textAlignLast = 'right';
            // console.log('   → Overrode justify-left to justify-right for RTL text');
          } else {
            this.textarea.style.textAlignLast = 'left';
          }
        } else if (textAlign === 'justify-right') {
          // If text is LTR but fabric says justify-right, override to justify-left for better UX  
          if (autoDetectedDirection === 'ltr') {
            this.textarea.style.textAlignLast = 'left';
            // console.log('   → Overrode justify-right to justify-left for LTR text');
          } else {
            this.textarea.style.textAlignLast = 'right';
          }
        } else if (textAlign === 'justify-center') {
          this.textarea.style.textAlignLast = 'center';
        }
        
        // Enhanced justify settings for better fabric.js matching
        (this.textarea.style as any).textJustify = 'inter-word';
        (this.textarea.style as any).wordSpacing = 'normal';
        
        // Additional CSS properties for better justify matching
        this.textarea.style.textAlign = 'justify';
        this.textarea.style.textAlignLast = this.textarea.style.textAlignLast;
        
        // Try to force better justify behavior
        (this.textarea.style as any).textJustifyTrim = 'none';
        (this.textarea.style as any).textAutospace = 'none';
        
        // console.log('   → Applied justify alignment:', textAlign, 'with last-line:', this.textarea.style.textAlignLast);
      } catch (error) {
        // console.warn('   → Justify setup failed, falling back to standard alignment:', error);
        cssTextAlign = textAlign.replace('justify-', '').replace('justify', 'left');
      }
    } else {
      this.textarea.style.textAlignLast = 'auto';
      (this.textarea.style as any).textJustify = 'auto';
      (this.textarea.style as any).wordSpacing = 'normal';
      // console.log('   → Applied standard alignment:', cssTextAlign);
    }
    
    this.textarea.style.textAlign = cssTextAlign;
    this.textarea.style.color = target.fill?.toString() || '#000';
    this.textarea.style.letterSpacing = `${letterSpacingPx}px`;
    
    // Use the already detected direction from above
    const fabricDirection = (target as any).direction;
    
    // Use auto-detected direction for better BiDi support, but respect fabric direction if it makes sense
    this.textarea.style.direction = autoDetectedDirection || fabricDirection || 'ltr';
    this.textarea.style.fontVariant = 'normal';
    this.textarea.style.fontStretch = 'normal';
    this.textarea.style.textRendering = 'auto'; // Changed from 'optimizeLegibility' to match canvas
    this.textarea.style.fontKerning = 'normal';
    this.textarea.style.fontFeatureSettings = 'normal';
    this.textarea.style.fontVariationSettings = 'normal';
    this.textarea.style.margin = '0';
    this.textarea.style.border = 'none';
    this.textarea.style.outline = 'none';
    this.textarea.style.background = 'transparent';
    this.textarea.style.overflowWrap = 'break-word';
    this.textarea.style.whiteSpace = 'pre-wrap';
    this.textarea.style.hyphens = 'none';
    
    // DEBUG: Log final CSS properties
    // console.log('🎨 FINAL TEXTAREA CSS:');
    // console.log('   textAlign:', this.textarea.style.textAlign);
    // console.log('   textAlignLast:', this.textarea.style.textAlignLast);
    // console.log('   direction:', this.textarea.style.direction);
    // console.log('   unicodeBidi:', this.textarea.style.unicodeBidi);
    // console.log('   width:', this.textarea.style.width);
    // console.log('   textJustify:', (this.textarea.style as any).textJustify);
    // console.log('   wordSpacing:', (this.textarea.style as any).wordSpacing);
    // console.log('   whiteSpace:', this.textarea.style.whiteSpace);
    
    // If justify, log Fabric object dimensions for comparison
    if (textAlign.includes('justify')) {
      // console.log('🔧 FABRIC OBJECT JUSTIFY INFO:');
      // console.log('   Fabric width:', (target as any).width);
      // console.log('   Fabric calcTextWidth:', (target as any).calcTextWidth?.());
      // console.log('   Fabric textAlign:', (target as any).textAlign);
      // console.log('   Text lines:', (target as any).textLines);
    }
    
    // Debug font properties matching
    // console.log('🔤 FONT PROPERTIES COMPARISON:');
    // console.log('   Fabric fontFamily:', target.fontFamily);
    // console.log('   Fabric fontWeight:', target.fontWeight);
    // console.log('   Fabric fontStyle:', target.fontStyle);
    // console.log('   Fabric fontSize:', target.fontSize);
    // console.log('   → Textarea fontFamily:', this.textarea.style.fontFamily);
    // console.log('   → Textarea fontWeight:', this.textarea.style.fontWeight);
    // console.log('   → Textarea fontStyle:', this.textarea.style.fontStyle);
    // console.log('   → Textarea fontSize:', this.textarea.style.fontSize);
    
    // console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Enhanced font rendering to better match fabric.js canvas rendering
    // Default to auto for more natural rendering
    (this.textarea.style as any).webkitFontSmoothing = 'auto';
    (this.textarea.style as any).mozOsxFontSmoothing = 'auto';
    (this.textarea.style as any).fontSmooth = 'auto';
    (this.textarea.style as any).textSizeAdjust = 'none';
    
    // For bold fonts, use subpixel rendering to match canvas thickness better
    const fontWeight = String(target.fontWeight || 'normal');
    const isBold = fontWeight === 'bold' || fontWeight === '700' || 
                   (parseInt(fontWeight) >= 600);
    
    if (isBold) {
      (this.textarea.style as any).webkitFontSmoothing = 'subpixel-antialiased';
      (this.textarea.style as any).mozOsxFontSmoothing = 'unset';
      // console.log('🔤 Applied enhanced bold rendering for better thickness matching');
    }
    
    // console.log('🎨 FONT SMOOTHING APPLIED:');
    // console.log('   webkitFontSmoothing:', (this.textarea.style as any).webkitFontSmoothing);
    // console.log('   mozOsxFontSmoothing:', (this.textarea.style as any).mozOsxFontSmoothing);


    // Initial bounds are set correctly by Fabric.js - don't force update here
  }

  /**
   * Debug method to compare textarea and canvas object bounding boxes
   */
  private debugBoundingBoxComparison(): void {
    const target = this.target;
    const canvas = this.canvas;
    const zoom = canvas.getZoom();

    // Get textarea bounding box (in screen coordinates)
    const textareaRect = this.textarea.getBoundingClientRect();
    const hostRect = this.hostDiv.getBoundingClientRect();

    // Get canvas object bounding box (in screen coordinates)
    const canvasBounds = target.getBoundingRect();
    const canvasRect = canvas.upperCanvasEl.getBoundingClientRect();

    // Convert canvas object bounds to screen coordinates
    const vpt = canvas.viewportTransform;
    const screenObjectBounds = {
      left: canvasRect.left + canvasBounds.left * zoom + vpt[4],
      top: canvasRect.top + canvasBounds.top * zoom + vpt[5],
      width: canvasBounds.width * zoom,
      height: canvasBounds.height * zoom,
    };

    // console.log('🔍 BOUNDING BOX COMPARISON:');
    // console.log('📦 Textarea Rect:', {
    //   left: Math.round(textareaRect.left * 100) / 100,
    //   top: Math.round(textareaRect.top * 100) / 100,
    //   width: Math.round(textareaRect.width * 100) / 100,
    //   height: Math.round(textareaRect.height * 100) / 100,
    // });
    // console.log('📦 Host Div Rect:', {
    //   left: Math.round(hostRect.left * 100) / 100,
    //   top: Math.round(hostRect.top * 100) / 100,
    //   width: Math.round(hostRect.width * 100) / 100,
    //   height: Math.round(hostRect.height * 100) / 100,
    // });
    // console.log('📦 Canvas Object Bounds (screen):', {
    //   left: Math.round(screenObjectBounds.left * 100) / 100,
    //   top: Math.round(screenObjectBounds.top * 100) / 100,
    //   width: Math.round(screenObjectBounds.width * 100) / 100,
    //   height: Math.round(screenObjectBounds.height * 100) / 100,
    // });
    // console.log('📦 Canvas Object Bounds (canvas):', canvasBounds);

    // Calculate differences
    const hostVsObject = {
      leftDiff:
        Math.round((hostRect.left - screenObjectBounds.left) * 100) / 100,
      topDiff: Math.round((hostRect.top - screenObjectBounds.top) * 100) / 100,
      widthDiff:
        Math.round((hostRect.width - screenObjectBounds.width) * 100) / 100,
      heightDiff:
        Math.round((hostRect.height - screenObjectBounds.height) * 100) / 100,
    };

    const textareaVsObject = {
      leftDiff:
        Math.round((textareaRect.left - screenObjectBounds.left) * 100) / 100,
      topDiff:
        Math.round((textareaRect.top - screenObjectBounds.top) * 100) / 100,
      widthDiff:
        Math.round((textareaRect.width - screenObjectBounds.width) * 100) / 100,
      heightDiff:
        Math.round((textareaRect.height - screenObjectBounds.height) * 100) /
        100,
    };

    // console.log('📏 Host Div vs Canvas Object Diff:', hostVsObject);
    // console.log('📏 Textarea vs Canvas Object Diff:', textareaVsObject);

    // Check if they're aligned (within 2px tolerance)
    const tolerance = 2;
    const hostAligned =
      Math.abs(hostVsObject.leftDiff) < tolerance &&
      Math.abs(hostVsObject.topDiff) < tolerance &&
      Math.abs(hostVsObject.widthDiff) < tolerance &&
      Math.abs(hostVsObject.heightDiff) < tolerance;

    const textareaAligned =
      Math.abs(textareaVsObject.leftDiff) < tolerance &&
      Math.abs(textareaVsObject.topDiff) < tolerance &&
      Math.abs(textareaVsObject.widthDiff) < tolerance &&
      Math.abs(textareaVsObject.heightDiff) < tolerance;

    // console.log(
    //   hostAligned
    //     ? '✅ Host Div ALIGNED with canvas object'
    //     : '❌ Host Div MISALIGNED with canvas object',
    // );
    // console.log(
    //   textareaAligned
    //     ? '✅ Textarea ALIGNED with canvas object'
    //     : '❌ Textarea MISALIGNED with canvas object',
    // );
    // console.log('🔍 Zoom:', zoom, 'Viewport Transform:', vpt);
    // console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  /**
   * Debug method to compare text wrapping between textarea and Fabric text object
   */
  private debugTextWrapping(): void {
    const target = this.target;
    const text = this.textarea.value;

    // console.log('📝 TEXT WRAPPING COMPARISON:');
    // console.log('📄 Text Content:', `"${text}"`);
    // console.log('📄 Text Length:', text.length);

    // Analyze line breaks
    const explicitLines = text.split('\n');
    // console.log('📄 Explicit Lines (\\n):', explicitLines.length);
    explicitLines.forEach((line, i) => {
      // console.log(`   Line ${i + 1}: "${line}" (${line.length} chars)`);
    });

    // Get textarea computed styles for wrapping analysis
    const textareaStyles = window.getComputedStyle(this.textarea);
    // console.log('📐 Textarea Wrapping Styles:');
    // console.log('   width:', textareaStyles.width);
    // console.log('   fontSize:', textareaStyles.fontSize);
    // console.log('   fontFamily:', textareaStyles.fontFamily);
    // console.log('   fontWeight:', textareaStyles.fontWeight);
    // console.log('   letterSpacing:', textareaStyles.letterSpacing);
    // console.log('   lineHeight:', textareaStyles.lineHeight);
    // console.log('   whiteSpace:', textareaStyles.whiteSpace);
    // console.log('   wordWrap:', textareaStyles.wordWrap);
    // console.log('   overflowWrap:', textareaStyles.overflowWrap);
    // console.log('   direction:', textareaStyles.direction);
    // console.log('   textAlign:', textareaStyles.textAlign);

    // Get Fabric text object properties for comparison
    // console.log('📐 Fabric Text Object Properties:');
    // console.log('   width:', (target as any).width);
    // console.log('   fontSize:', target.fontSize);
    // console.log('   fontFamily:', target.fontFamily);
    // console.log('   fontWeight:', target.fontWeight);
    // console.log('   charSpacing:', target.charSpacing);
    // console.log('   lineHeight:', target.lineHeight);
    // console.log('   direction:', (target as any).direction);
    // console.log('   textAlign:', (target as any).textAlign);
    // console.log('   scaleX:', target.scaleX);
    // console.log('   scaleY:', target.scaleY);

    // Calculate effective dimensions for comparison - use actual rendered width
    // **THE FIX:** Use getBoundingRect to get the *actual rendered width* of the Fabric object.
    const fabricEffectiveWidth = this.target.getBoundingRect().width;
    // Use the exact width set on textarea for comparison
    const textareaComputedWidth = parseFloat(
      window.getComputedStyle(this.textarea).width,
    );
    const textareaEffectiveWidth =
      textareaComputedWidth / this.canvas.getZoom();
    const widthDiff = Math.abs(textareaEffectiveWidth - fabricEffectiveWidth);

    // console.log('📏 Effective Width Comparison:');
    // console.log('   Textarea Effective Width:', textareaEffectiveWidth);
    // console.log('   Fabric Effective Width:', fabricEffectiveWidth);
    // console.log('   Width Difference:', widthDiff.toFixed(2) + 'px');
    // console.log(
    //   widthDiff < 1
    //     ? '✅ Widths MATCH for wrapping'
    //     : '❌ Width MISMATCH may cause different wrapping',
    // );

    // Check text direction and bidi handling
    const hasRTLText =
      /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
        text,
      );
    const hasBidiText = /[\u0590-\u06FF]/.test(text) && /[a-zA-Z]/.test(text);

    // console.log('🌍 Text Direction Analysis:');
    // console.log('   Has RTL characters:', hasRTLText);
    // console.log('   Has mixed Bidi text:', hasBidiText);
    // console.log('   Textarea direction:', textareaStyles.direction);
    // console.log('   Fabric direction:', (target as any).direction || 'auto');
    // console.log('   Textarea unicodeBidi:', textareaStyles.unicodeBidi);

    // Measure actual rendered line count
    const textareaScrollHeight = this.textarea.scrollHeight;
    const textareaLineHeight =
      parseFloat(textareaStyles.lineHeight) ||
      parseFloat(textareaStyles.fontSize) * 1.2;
    const estimatedTextareaLines = Math.round(
      textareaScrollHeight / textareaLineHeight,
    );

    // console.log('📊 Line Count Analysis:');
    // console.log('   Textarea scrollHeight:', textareaScrollHeight);
    // console.log('   Textarea lineHeight:', textareaLineHeight);
    // console.log('   Estimated rendered lines:', estimatedTextareaLines);
    // console.log('   Explicit line breaks:', explicitLines.length);

    if (estimatedTextareaLines > explicitLines.length) {
      // console.log('🔄 Text wrapping detected in textarea');
      // console.log(
      //   '   Wrapped lines:',
      //   estimatedTextareaLines - explicitLines.length,
      // );
    } else {
      // console.log('📏 No text wrapping in textarea');
    }

    // console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
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
      lockMovementY: false,
    });

    // Keep as active object
    this.canvas.setActiveObject(this.target);

    this.canvas.requestRenderAll();
    this.target.setCoords();
    this.applyOverlayStyle();

    // Fix character mapping issues after JSON loading for browser-wrapped fonts
    if ((this.target as any)._fixCharacterMappingAfterJsonLoad) {
      (this.target as any)._fixCharacterMappingAfterJsonLoad();
    }

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
      
      // Auto-detect text direction and update fabric object if needed
      const detectedDirection = this.firstStrongDir(finalText);
      const currentDirection = (this.target as any).direction || 'ltr';
      const hasExplicitDirection =
        currentDirection && currentDirection !== 'inherit';
      
      // Only update direction when not explicitly set on the object
      if (!hasExplicitDirection && detectedDirection && detectedDirection !== currentDirection) {
        // console.log(`🔄 Overlay Exit: Auto-detected direction change from "${currentDirection}" to "${detectedDirection}"`);
        // console.log(`   Text content: "${finalText.substring(0, 50)}..."`);
        
        // Update the fabric object's direction
        (this.target as any).set('direction', detectedDirection);
        
        // Force a re-render to apply the direction change
        this.canvas.requestRenderAll();
        
        // console.log(`✅ Fabric object direction updated to: ${detectedDirection}`);
      } else {
        // console.log(`📝 Overlay Exit: Direction unchanged (${currentDirection}), text: "${finalText.substring(0, 30)}..."`);
      }
      
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
    // Store the scroll position and the container's old height for comparison.
    const scrollTop = this.textarea.scrollTop;
    const oldHeight = parseFloat(this.hostDiv.style.height || '0');

    // 1. **Force a reliable reflow.**
    //    First, reset the textarea's height to a minimal value. This is the crucial step
    //    that forces the browser to recalculate the content's height from scratch,
    //    ignoring the hostDiv's larger, stale height.
    this.textarea.style.height = '1px';

    // 2. Read the now-accurate scrollHeight. This value reflects the minimum
    //    height required for the content, whether it's single or multi-line.
    const scrollHeight = this.textarea.scrollHeight;

    // A small buffer for rendering consistency across browsers.
    const buffer = 2;
    const newHeight = scrollHeight + buffer;

    // Check if the height has changed significantly.
    const heightChanged = Math.abs(newHeight - oldHeight) > 1;

    // 4. Only update heights and object bounds if there was a change.
    if (heightChanged) {
      this.textarea.style.height = `${newHeight}px`;
      this.hostDiv.style.height = `${newHeight}px`;
      this.updateObjectBounds();
    } else {
      // If no significant change, ensure the textarea's height matches the container
      // to prevent any minor visual misalignment.
      this.textarea.style.height = this.hostDiv.style.height;
    }

    // 5. Restore the original scroll position.
    this.textarea.scrollTop = scrollTop;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.destroy(false); // Cancel
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      this.destroy(true); // Commit
    } else if (
      e.key === 'Enter' ||
      e.key === 'Backspace' ||
      e.key === 'Delete'
    ) {
      // For keys that might change the height, schedule a resize check
      // Use both immediate and delayed checks to catch all scenarios
      requestAnimationFrame(() => {
        if (!this.isDestroyed) {
          this.autoResizeTextarea();
        }
      });
      setTimeout(() => {
        if (!this.isDestroyed) {
          this.autoResizeTextarea();
        }
      }, 10); // Small delay to ensure DOM is updated
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
    (this.canvas as any).__originalSetViewportTransform =
      this.canvas.setViewportTransform;
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
    const originalSetViewportTransform = this.canvas.setViewportTransform.bind(
      this.canvas,
    );
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
      this.canvas.setViewportTransform = (
        this.canvas as any
      ).__originalSetViewportTransform;
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
