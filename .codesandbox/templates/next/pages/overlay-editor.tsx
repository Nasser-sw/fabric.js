import * as fabric from 'fabric';
import { NextPage } from 'next';
import { useRef, useCallback, useState } from 'react';
import { Canvas } from '../components/Canvas';

const OverlayEditorPage: NextPage = () => {
  const ref = useRef<fabric.Canvas>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogs(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const onLoad = useCallback(
    (canvas: fabric.Canvas) => {
      canvas.setDimensions({
        width: Math.min(window.innerWidth - 40, 800),
        height: 600,
      });
      
      canvas.backgroundColor = '#f5f5f5';
      canvas.renderAll();

      // Add English text
      const englishText = new fabric.Textbox('Double-click to edit this English text with the new overlay editor!', {
        left: 50,
        top: 50,
        width: 300,
        fontSize: 16,
        fontFamily: 'Arial',
        fill: '#333',
        textAlign: 'left',
        direction: 'ltr',
        useOverlayEditing: true,
      });
      canvas.add(englishText);

      // Add RTL Arabic text
      const arabicText = new fabric.Textbox('اضغط مرتين لتحرير هذا النص العربي باستخدام المحرر الجديد!', {
        left: 400,
        top: 50,
        width: 300,
        fontSize: 18,
        fontFamily: 'Arial',
        fill: '#0066cc',
        textAlign: 'right',
        direction: 'rtl',
        useOverlayEditing: true,
      });
      canvas.add(arabicText);

      // Add LTR Arabic text
      const arabicLTRText = new fabric.Textbox('مرحبا بك في المحرر الجديد باتجاه LTR. يمكنك تعديل هذا النص بسهولة.', {
        left: 50,
        top: 180,
        width: 350,
        fontSize: 16,
        fontFamily: 'Arial',
        fill: '#cc6600',
        textAlign: 'left',
        direction: 'ltr',
        useOverlayEditing: true,
      });
      canvas.add(arabicLTRText);

      // Add emoji text
      const emojiText = new fabric.Textbox('🌟 Hello World! 🚀 Emojis work perfectly: ✨💫🎉🎨', {
        left: 50,
        top: 320,
        width: 400,
        fontSize: 20,
        fontFamily: 'Arial',
        fill: '#ff6b6b',
        textAlign: 'center',
        direction: 'ltr',
        useOverlayEditing: true,
        charSpacing: 50,
      });
      canvas.add(emojiText);

      // Add justified text
      const justifiedText = new fabric.Textbox('هذا نص مبرر باللغة العربية يوضح كيفية تعامل محرر التراكب مع النصوص المبررة بشكل مثالي. كل سطر محاذي بدقة.', {
        left: 450,
        top: 320,
        width: 280,
        fontSize: 14,
        fontFamily: 'Arial',
        fill: '#2d2d2d',
        textAlign: 'justify',
        direction: 'rtl',
        useOverlayEditing: true,
        lineHeight: 1.6,
      });
      canvas.add(justifiedText);

      // Setup double-click handler for overlay editing
      canvas.on('mouse:dblclick', (e) => {
        if (e.target && (e.target.type === 'textbox' || e.target.type === 'i-text')) {
          addLog(`Starting overlay edit for: "${e.target.text?.substring(0, 30)}..."`);
          
          // Use the enterTextOverlayEdit function
          const { enterTextOverlayEdit } = fabric as any;
          if (enterTextOverlayEdit) {
            enterTextOverlayEdit(canvas, e.target, {
              onCommit: (newText: string) => {
                addLog(`Text committed: "${newText.substring(0, 30)}..."`);
                e.target.set('text', newText);
                canvas.requestRenderAll();
              },
              onCancel: () => {
                addLog('Text editing cancelled');
              }
            });
          } else {
            addLog('ERROR: enterTextOverlayEdit not available. Make sure you have the latest Fabric.js build.');
          }
        }
      });

      // Add zoom controls
      const zoomButtons = [
        { label: '50%', zoom: 0.5 },
        { label: '100%', zoom: 1.0 },
        { label: '150%', zoom: 1.5 },
        { label: '200%', zoom: 2.0 },
      ];

      addLog('Overlay editor test loaded successfully!');
      addLog('Double-click any text to start editing');
      
      // Make canvas globally available for debugging
      if (typeof window !== 'undefined') {
        (window as any).testCanvas = canvas;
        (window as any).addLog = addLog;
      }
    },
    [ref]
  );

  const handleZoom = (zoomLevel: number) => {
    if (ref.current) {
      ref.current.setZoom(zoomLevel);
      ref.current.requestRenderAll();
      addLog(`Zoom set to ${(zoomLevel * 100)}%`);
    }
  };

  const handlePan = (deltaX: number, deltaY: number) => {
    if (ref.current) {
      const vpt = ref.current.viewportTransform;
      if (vpt) {
        vpt[4] += deltaX;
        vpt[5] += deltaY;
        ref.current.requestRenderAll();
        addLog(`Panned by (${deltaX}, ${deltaY})`);
      }
    }
  };

  const resetViewport = () => {
    if (ref.current) {
      ref.current.viewportTransform = [1, 0, 0, 1, 0, 0];
      ref.current.requestRenderAll();
      addLog('Viewport reset');
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', margin: '20px' }}>
      <h1 style={{ color: '#333', marginBottom: '20px' }}>
        Fabric.js Overlay Editor Test (Next.js)
      </h1>
      
      <div style={{ 
        background: 'white', 
        padding: '20px', 
        borderRadius: '8px', 
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        marginBottom: '20px'
      }}>
        <h2 style={{ margin: '0 0 15px 0' }}>Instructions:</h2>
        <ul style={{ margin: '0 0 15px 0' }}>
          <li><strong>Double-click</strong> any text to edit with overlay editor</li>
          <li><strong>Esc</strong> to cancel editing</li>
          <li><strong>Ctrl/Cmd + Enter</strong> to commit changes</li>
          <li><strong>Click outside</strong> to auto-commit</li>
          <li>Test with different zoom levels and panning</li>
        </ul>
        
        <h3 style={{ margin: '15px 0 10px 0' }}>Canvas Controls:</h3>
        <div style={{ marginBottom: '10px' }}>
          <strong>Zoom: </strong>
          {[0.5, 1.0, 1.5, 2.0].map(zoom => (
            <button 
              key={zoom}
              onClick={() => handleZoom(zoom)}
              style={{
                margin: '0 5px',
                padding: '5px 10px',
                backgroundColor: '#007cba',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {(zoom * 100)}%
            </button>
          ))}
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <strong>Pan: </strong>
          {[
            { label: '← Left', x: -50, y: 0 },
            { label: 'Right →', x: 50, y: 0 },
            { label: '↑ Up', x: 0, y: -50 },
            { label: 'Down ↓', x: 0, y: 50 },
          ].map(({ label, x, y }) => (
            <button 
              key={label}
              onClick={() => handlePan(x, y)}
              style={{
                margin: '0 5px',
                padding: '5px 10px',
                backgroundColor: '#007cba',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {label}
            </button>
          ))}
          <button 
            onClick={resetViewport}
            style={{
              margin: '0 5px',
              padding: '5px 10px',
              backgroundColor: '#cc6600',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div style={{ 
        border: '1px solid #ccc', 
        borderRadius: '4px',
        marginBottom: '20px'
      }}>
        <Canvas ref={ref} onLoad={onLoad} />
      </div>

      <div style={{ 
        background: '#f8f9fa', 
        padding: '15px', 
        borderRadius: '4px',
        borderLeft: '4px solid #007cba'
      }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Event Log:</h3>
        <div style={{ 
          fontFamily: 'monospace', 
          fontSize: '12px',
          maxHeight: '150px',
          overflowY: 'auto',
          backgroundColor: 'white',
          padding: '10px',
          borderRadius: '4px'
        }}>
          {logs.length === 0 ? 'No events yet...' : logs.map((log, i) => (
            <div key={i} style={{ marginBottom: '2px' }}>{log}</div>
          ))}
        </div>
      </div>

      <div style={{ 
        background: '#e8f4f8', 
        padding: '15px', 
        borderRadius: '4px',
        borderLeft: '4px solid #007cba'
      }}>
        <h3 style={{ margin: '0 0 10px 0' }}>Test Scenarios:</h3>
        <p><strong>English:</strong> Double-click the English text above to test basic editing.</p>
        <p><strong>Arabic (RTL):</strong> Test right-to-left text editing with proper alignment.</p>
        <p><strong>Arabic (LTR):</strong> Test Arabic text in left-to-right context.</p>
        <p><strong>Emojis:</strong> Test text with emojis and special characters.</p>
        <p><strong>Justified:</strong> Test justified text alignment.</p>
        <p><strong>Zoom/Pan:</strong> Test editing while canvas is zoomed or panned.</p>
      </div>
    </div>
  );
};

export default OverlayEditorPage;