# Overlay Editor Migration Guide

## Migrating from Fabric.js 6.7.3 to Latest with Overlay Editor

This guide helps you migrate your existing website designer from Fabric.js 6.7.3 to the latest version with the new **Overlay Editor** feature for seamless text editing.

---

## 🎯 What is the Overlay Editor?

The Overlay Editor provides **Canva/Polotno-style** inline text editing using an HTML textarea that perfectly overlays the canvas text objects. Benefits include:

- ✅ **Perfect 1:1 positioning** - Text appears exactly where it will render
- ✅ **RTL support** - Full Arabic/Hebrew text support with proper bidirectional rendering
- ✅ **No mode switching** - Edit text while maintaining selection controls
- ✅ **Zoom/Pan support** - Overlay stays aligned during viewport changes
- ✅ **Real-time preview** - See changes as you type

---

## 🚀 Quick Start

### 1. Update Your Fabric.js Import

**Before (6.7.3):**
```javascript
import { Canvas, Textbox, IText } from 'fabric';
```

**After (Latest):**
```javascript
import { Canvas, Textbox, IText } from 'fabric';
import { enterTextOverlayEdit } from 'fabric'; // New overlay editor
```

### 2. Replace Traditional Text Editing

**Before (6.7.3) - Double-click to edit:**
```javascript
// Traditional editing - enters editing mode, hides selection
textObject.on('editing:entered', () => {
  // Text object enters editing mode, selection controls hidden
});

textObject.on('editing:exited', () => {
  // Text object exits editing mode
});
```

**After (Latest) - Overlay editing:**
```javascript
// Double-click handler for overlay editing
textObject.on('mousedblclick', () => {
  enterTextOverlayEdit(canvas, textObject, {
    onCommit: (newText) => {
      textObject.set('text', newText);
      canvas.requestRenderAll();
    },
    onCancel: () => {
      console.log('Editing cancelled');
    }
  });
});
```

### 3. Enable Overlay Editing for Text Objects

Add the `useOverlayEditing` property to your text objects:

```javascript
const textbox = new fabric.Textbox('Your text here', {
  left: 100,
  top: 100,
  width: 300,
  fontSize: 18,
  fontFamily: 'Arial',
  useOverlayEditing: true, // 🆕 Enable overlay editing
  // ... other properties
});
```

---

## 📝 Complete Migration Example

### Before: Traditional Website Designer (6.7.3)

```javascript
// Old approach with traditional editing
class TextEditor {
  constructor(canvasId) {
    this.canvas = new fabric.Canvas(canvasId);
    this.setupTextEditing();
  }
  
  setupTextEditing() {
    // Double-click to enter editing mode
    this.canvas.on('mouse:dblclick', (e) => {
      if (e.target && e.target.type === 'textbox') {
        e.target.enterEditing();
        e.target.selectAll();
      }
    });
  }
  
  addText(text, x, y) {
    const textbox = new fabric.Textbox(text, {
      left: x,
      top: y,
      width: 300,
      fontSize: 16,
      fontFamily: 'Arial'
    });
    
    this.canvas.add(textbox);
    return textbox;
  }
}
```

### After: Modern Website Designer with Overlay Editor

```javascript
import { Canvas, Textbox, enterTextOverlayEdit } from 'fabric';

class ModernTextEditor {
  constructor(canvasId) {
    this.canvas = new fabric.Canvas(canvasId);
    this.setupOverlayEditing();
  }
  
  setupOverlayEditing() {
    // Double-click to start overlay editing
    this.canvas.on('mouse:dblclick', (e) => {
      if (e.target && (e.target.type === 'textbox' || e.target.type === 'i-text')) {
        this.startOverlayEdit(e.target);
      }
    });
  }
  
  startOverlayEdit(textObject) {
    enterTextOverlayEdit(this.canvas, textObject, {
      onCommit: (newText) => {
        // Update text and save to your backend
        textObject.set('text', newText);
        this.canvas.requestRenderAll();
        this.saveDesignToServer();
      },
      onCancel: () => {
        console.log('Text editing cancelled');
      }
    });
  }
  
  addText(text, x, y, options = {}) {
    const textbox = new fabric.Textbox(text, {
      left: x,
      top: y,
      width: options.width || 300,
      fontSize: options.fontSize || 16,
      fontFamily: options.fontFamily || 'Arial',
      fill: options.color || '#000000',
      textAlign: options.textAlign || 'left',
      direction: options.direction || 'ltr',
      useOverlayEditing: true, // 🆕 Enable overlay editing
      // Perfect for RTL text
      ...(text.match(/[\u0590-\u05FF\u0600-\u06FF]/) && {
        direction: 'rtl',
        textAlign: 'right'
      }),
      ...options
    });
    
    this.canvas.add(textbox);
    return textbox;
  }
  
  // 🆕 RTL text support
  addArabicText(text, x, y, options = {}) {
    const textbox = new fabric.Textbox(text, {
      left: x,
      top: y,
      width: options.width || 300,
      fontSize: options.fontSize || 16,
      fontFamily: options.fontFamily || 'Arial',
      fill: options.color || '#000000',
      direction: 'rtl',
      textAlign: 'right',
      useOverlayEditing: true,
      ...options
    });
    
    this.canvas.add(textbox);
    return textbox;
  }
  
  // Save design state
  saveDesignToServer() {
    const designData = {
      objects: this.canvas.toObject(),
      version: this.canvas.version
    };
    
    fetch('/api/save-design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(designData)
    });
  }
}

// Usage
const editor = new ModernTextEditor('canvas');

// Add English text
editor.addText('Click to edit this text', 50, 50);

// Add RTL Arabic text  
editor.addArabicText('اضغط لتحرير هذا النص', 50, 150);
```

---

## 🌍 RTL Text Support

The overlay editor has excellent RTL support. Here's how to handle different text directions:

### Mixed Direction Text (Arabic in LTR context)

```javascript
const mixedText = new fabric.Textbox('Hello مرحبا World', {
  left: 100,
  top: 100,
  width: 300,
  direction: 'ltr', // Base direction
  useOverlayEditing: true
});
```

### Pure RTL Text

```javascript
const rtlText = new fabric.Textbox('مرحبا بك في المحرر الجديد', {
  left: 100,
  top: 100,
  width: 300,
  direction: 'rtl',
  textAlign: 'right',
  useOverlayEditing: true
});
```

---

## ⚙️ Configuration Options

### Basic Options

```javascript
enterTextOverlayEdit(canvas, textObject, {
  onCommit: (text) => {
    // Handle text commit
    textObject.set('text', text);
    canvas.requestRenderAll();
  },
  onCancel: () => {
    // Handle edit cancellation
    console.log('Edit cancelled');
  }
});
```

### Keyboard Controls

- **Esc** - Cancel editing
- **Ctrl/Cmd + Enter** - Commit changes  
- **Click outside** - Auto-commit changes
- **Tab/Shift+Tab** - Navigate between text objects (if implemented)

---

## 🎨 Styling Integration

### CSS Customization

You can style the overlay editor to match your designer theme:

```css
/* Target overlay editor textarea */
textarea[style*="position: absolute"][style*="z-index: 1000"] {
  border: 2px solid #007cba !important;
  border-radius: 4px !important;
  box-shadow: 0 0 10px rgba(0, 124, 186, 0.3) !important;
}

/* Focused state */
textarea[style*="position: absolute"][style*="z-index: 1000"]:focus {
  border-color: #005a8a !important;
  box-shadow: 0 0 15px rgba(0, 124, 186, 0.5) !important;
}
```

---

## 🛠️ Common Migration Issues & Solutions

### Issue 1: Text Position Drift on Zoom/Pan

**Problem:** Overlay editor doesn't follow text when zooming or panning.

**Solution:** Already fixed in latest version! The overlay automatically tracks viewport changes.

### Issue 2: RTL Text Rendering Issues

**Problem:** Arabic/Hebrew text doesn't render correctly.

**Solution:** Set proper `direction` and `textAlign` properties:

```javascript
const arabicText = new fabric.Textbox('النص العربي', {
  direction: 'rtl',
  textAlign: 'right',
  useOverlayEditing: true
});
```

### Issue 3: Font Size Mismatch

**Problem:** Textarea font size doesn't match canvas text.

**Solution:** Already handled automatically! The overlay calculates exact font scaling.

### Issue 4: Text Wrapping Differences

**Problem:** Text wraps differently in overlay vs canvas.

**Solution:** Use `target.width` for text wrapping (already implemented).

---

## 📊 Performance Considerations

### Before: Traditional Editing
- Slower text input response
- Mode switching overhead
- Limited concurrent editing

### After: Overlay Editor  
- Real-time text updates
- No mode switching
- Better user experience
- Minimal performance impact

### Best Practices

1. **Debounce save operations:**
```javascript
let saveTimeout;
const debouncedSave = () => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    this.saveDesignToServer();
  }, 500);
};
```

2. **Batch canvas updates:**
```javascript
onCommit: (text) => {
  textObject.set('text', text);
  canvas.requestRenderAll(); // Single render call
  debouncedSave();
}
```

---

## 🧪 Testing Your Migration

### Test Checklist

- [ ] **Basic editing** - Double-click to edit text
- [ ] **Keyboard shortcuts** - Esc to cancel, Ctrl+Enter to commit
- [ ] **RTL text** - Arabic/Hebrew text displays correctly
- [ ] **Zoom/Pan** - Overlay stays aligned during viewport changes
- [ ] **Mixed scripts** - English + Arabic text works
- [ ] **Font scaling** - Text size matches between overlay and canvas
- [ ] **Text wrapping** - Line breaks match exactly
- [ ] **Multiple objects** - Can edit different text objects
- [ ] **Undo/Redo** - Integration with your history system

### Test Code

```javascript
// Test different scenarios
const testTexts = [
  'English text',
  'النص العربي', 
  'עברית',
  'Mixed English والعربية text',
  '🚀 Emojis work too! 🎨'
];

testTexts.forEach((text, i) => {
  const textObj = editor.addText(text, 50, 50 + i * 60, {
    width: 300,
    useOverlayEditing: true
  });
});
```

---

## 🔗 Additional Resources

- **Demo:** `examples/overlay-edit.html`
- **API Reference:** See `overlayEditor.ts` source code
- **GitHub Issues:** Report bugs and feature requests
- **Migration Support:** Open an issue for migration help

---

## 🎉 Migration Complete!

Your website designer now has modern, seamless text editing with perfect RTL support! The overlay editor provides a much better user experience compared to traditional Fabric.js text editing.

**Key Benefits Gained:**
- ✅ Canva-style editing experience  
- ✅ Perfect text positioning
- ✅ RTL/Arabic/Hebrew support
- ✅ Better user workflow
- ✅ Future-proof codebase