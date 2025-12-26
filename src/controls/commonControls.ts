import { RESIZING, ROTATE } from '../constants';
import { changeWidth } from './changeWidth';
import { changeHeight } from './changeHeight';
import { Control } from './Control';
import {
  renderHorizontalPillControl,
  renderVerticalPillControl,
} from './controlRendering';
import { rotationStyleHandler, rotationWithSnapping } from './rotate';
import { scaleCursorStyleHandler, scalingEqually } from './scale';
import {
  scaleOrSkewActionName,
  scaleSkewCursorStyleHandler,
  scalingXOrSkewingY,
  scalingYOrSkewingX,
} from './scaleSkew';

// use this function if you want to generate new controls for every instance
export const createObjectDefaultControls = () => ({
  ml: new Control({
    x: -0.5,
    y: 0,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: scalingXOrSkewingY,
    getActionName: scaleOrSkewActionName,
    render: renderHorizontalPillControl,
    sizeX: 6,
    sizeY: 20,
  }),

  mr: new Control({
    x: 0.5,
    y: 0,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: scalingXOrSkewingY,
    getActionName: scaleOrSkewActionName,
    render: renderHorizontalPillControl,
    sizeX: 6,
    sizeY: 20,
  }),

  mb: new Control({
    x: 0,
    y: 0.5,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: scalingYOrSkewingX,
    getActionName: scaleOrSkewActionName,
    render: renderVerticalPillControl,
    sizeX: 20,
    sizeY: 6,
  }),

  mt: new Control({
    x: 0,
    y: -0.5,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionHandler: scalingYOrSkewingX,
    getActionName: scaleOrSkewActionName,
    render: renderVerticalPillControl,
    sizeX: 20,
    sizeY: 6,
  }),

  tl: new Control({
    x: -0.5,
    y: -0.5,
    cursorStyleHandler: scaleCursorStyleHandler,
    actionHandler: scalingEqually,
  }),

  tr: new Control({
    x: 0.5,
    y: -0.5,
    cursorStyleHandler: scaleCursorStyleHandler,
    actionHandler: scalingEqually,
  }),

  bl: new Control({
    x: -0.5,
    y: 0.5,
    cursorStyleHandler: scaleCursorStyleHandler,
    actionHandler: scalingEqually,
  }),

  br: new Control({
    x: 0.5,
    y: 0.5,
    cursorStyleHandler: scaleCursorStyleHandler,
    actionHandler: scalingEqually,
  }),

  mtr: new Control({
    x: 0,
    y: -0.5,
    actionHandler: rotationWithSnapping,
    cursorStyleHandler: rotationStyleHandler,
    offsetY: -40,
    withConnection: true,
    actionName: ROTATE,
  }),
});

export const createResizeControls = () => ({
  mr: new Control({
    x: 0.5,
    y: 0,
    actionHandler: changeWidth,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionName: RESIZING,
    render: renderHorizontalPillControl,
    sizeX: 6,
    sizeY: 20,
  }),
  ml: new Control({
    x: -0.5,
    y: 0,
    actionHandler: changeWidth,
    cursorStyleHandler: scaleSkewCursorStyleHandler,
    actionName: RESIZING,
    render: renderHorizontalPillControl,
    sizeX: 6,
    sizeY: 20,
  }),
});

export const createTextboxDefaultControls = () => {
  const { mt, mb, ...controls } = {
    ...createObjectDefaultControls(),
    ...createResizeControls(),
  };
  // Exclude mt and mb controls - textbox height is auto-calculated based on content
  // Only width can be manually adjusted, height adjusts automatically for text wrapping
  return controls;
};
