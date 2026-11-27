// Data-only drawing and viewport geometry shared by the native and web viewers.
// No parser, layout engine, retained objects or platform-specific input here.
export const FLOW_WORDS = Object.freeze({
  source: 'Show source', preview: 'Show preview',
  incomplete: 'Preview waits for a closing fence.',
  unsupported: 'This Mermaid syntax is not supported in Chat. Edit or copy the source below.',
  invalid: 'Could not read this flowchart. Check the syntax or copy the source below.',
  large: 'This flowchart is too large to preview. Copy the source to view it elsewhere.',
  many: 'This message has too many diagrams to preview them all. Copy the source below.',
  expand: 'Expand diagram', fit: 'Fit', actual: '100%', close: 'Close',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out',
  panLeft: 'Pan left', panRight: 'Pan right', panUp: 'Pan up', panDown: 'Pan down',
  shortened: 'Source display shortened. Copy gets the full source.',
});

export const FLOW_FONT = 13, FLOW_LINE = 18;
// Arrowheads are triangles, not executable SVG markers. Both surfaces draw the
// same immutable points with their own theme colors.
export function arrowTriangle(tip, previous) {
  const dx = tip.x - previous.x, dy = tip.y - previous.y, l = Math.hypot(dx, dy);
  if (!l) return [];
  const x = dx/l, y = dy/l;
  return [tip, { x: tip.x-9*x+4*y, y: tip.y-9*y-4*x }, { x: tip.x-9*x-4*y, y: tip.y-9*y+4*x }];
}
export function nodePolygon(n) {
  const x = n.x, y = n.y, w = n.width/2, h = n.height/2;
  if (n.shape === 'diamond') return [{x,y:y-h},{x:x+w,y},{x,y:y+h},{x:x-w,y}];
  if (n.shape === 'hexagon') return [{x:x-w+14,y:y-h},{x:x+w-14,y:y-h},{x:x+w,y},{x:x+w-14,y:y+h},{x:x-w+14,y:y+h},{x:x-w,y}];
  return [];
}
// Inline rows are complete, bounded overviews, never independent scroll areas.
export const FLOW_VIEW_HEIGHT = 420, FLOW_OPEN_HEIGHT = 32;
export const FLOW_ZOOM_STEP = 1.25, FLOW_MAX_ZOOM = 2.5;
export function fitFlowchart(drawing, width, height = FLOW_VIEW_HEIGHT) {
  const w = Math.max(1,Math.floor(width)), h = Math.max(1,Math.floor(height));
  const scale = Math.min(1, w/drawing.width, h/drawing.height);
  return { scale, width: Math.min(w,Math.ceil(drawing.width*scale)), height: Math.min(h,Math.ceil(drawing.height*scale)) };
}
export function chartHeight(drawing, available) {
  return fitFlowchart(drawing, available).height + FLOW_OPEN_HEIGHT;
}

// A viewer's camera is a normalized center and an optional explicit scale.
// Fit is responsive; an explicit scale keeps labels readable through resizes.
export const fitCamera = () => ({ scale: null, x: 0.5, y: 0.5 });
const clamp = (n,lo,hi) => Math.max(lo,Math.min(hi,n));
export function flowCamera(drawing, room, camera) {
  const fitted = fitFlowchart(drawing,room.width,room.height), fit = fitted.scale;
  const scale = camera.scale ?? fit;
  const {width,height} = camera.scale === null ? fitted : {width:Math.ceil(drawing.width*scale),height:Math.ceil(drawing.height*scale)};
  const offset = (size, available, center) => size <= available ? (available-size)/2 : clamp(available/2-size*center,available-size,0);
  return { scale, width, height, left: offset(width,room.width,camera.x), top: offset(height,room.height,camera.y), fit };
}
export function panFlowchart(drawing, room, camera, dx, dy) {
  const view = flowCamera(drawing,room,camera);
  const center = (size,available,offset,delta) => size <= available ? 0.5 : clamp((available/2-offset+delta)/size, available/(2*size), 1-available/(2*size));
  return { scale: camera.scale, x: center(view.width,room.width,view.left,dx), y: center(view.height,room.height,view.top,dy) };
}
export function zoomFlowchart(drawing, room, camera, requested, at = {x:room.width/2,y:room.height/2}) {
  const view = flowCamera(drawing,room,camera);
  const scale = clamp(requested,Math.min(view.fit,view.scale),FLOW_MAX_ZOOM);
  const width = Math.ceil(drawing.width*scale), height = Math.ceil(drawing.height*scale);
  // Preserve the drawing point under the pointer (or the viewport center).
  const next = { scale, x: ((at.x-view.left)/view.width*width-at.x+room.width/2)/width,
    y: ((at.y-view.top)/view.height*height-at.y+room.height/2)/height };
  return panFlowchart(drawing,room,next,0,0);
}
