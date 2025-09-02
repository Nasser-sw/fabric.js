import { beforeAll } from '../test';
import { Text } from 'fabric';
import { createFabricOverlayEditor } from '../../utils/fabric-overlay-editor.js';

beforeAll((canvas) => {
  const text = new Text('Double-click to edit', {
    left: 50,
    top: 50,
    fontSize: 24,
    fontFamily: 'Arial',
  });
  canvas.add(text);
  createFabricOverlayEditor(text, canvas);

  return {
    text,
  };
});
