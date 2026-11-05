/**
 * Canvas viewport: pan and zoom for mouse and trackpad, node dragging and drawing
 * connections. The world (cards, edges) is laid out in world coordinates; the viewport
 * applies `translate(x, y) scale(z)`. Rendering stays in app.js; this module only turns
 * gestures into view changes and callbacks.
 *
 * Mouse: wheel pans (Shift for horizontal), Ctrl/Cmd + wheel zooms at the cursor,
 * drag on empty space / Space + drag / middle button pans. Left click on empty space
 * clears the selection; right click opens the menu of what is under it (the board, a
 * step, a link).
 * Trackpad: two fingers pan, pinch zooms at the fingers (browsers send it as Ctrl + wheel).
 */

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 2.5;
const STEP = 1.2;
const DRAG_THRESHOLD = 4;

const clamp = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export const isTyping = (el) =>
  !!el &&
  (el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    !!el.closest?.('[contenteditable="true"]'));

// Space is held for "Space + drag pans" — tracked once for the whole page.
let spaceHeld = false;
let current = null;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !isTyping(e.target) && current) {
    if (!spaceHeld) current.viewport.classList.add('space-pan');
    spaceHeld = true;
    e.preventDefault(); // no page scroll
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceHeld = false;
    current?.viewport.classList.remove('space-pan');
  }
});

/**
 * @param {HTMLElement} viewport the scrolling area (overflow hidden)
 * @param {HTMLElement} world the transformed layer with cards and edges
 * @param {{
 *   view: {x:number,y:number,z:number}|null,
 *   bounds: () => {minX:number,minY:number,maxX:number,maxY:number}|null,
 *   onView: (view) => void,
 *   onEmptyClick?: (world: {x:number,y:number}, client: {x:number,y:number}) => void,
 *   onMenu?: (target: {kind:'board'|'node'|'edge', id?: string}, world: {x:number,y:number}, client: {x:number,y:number}) => void,
 *   onNodeDragStart?: (id: string) => void,
 *   onNodeDrag?: (id: string, dx: number, dy: number) => void,
 *   onNodeDragEnd?: (id: string) => void,
 *   onConnect?: (sourceId: string, targetId: string|null) => void,
 *   connectPreview?: (from: {x:number,y:number}|null, to: {x:number,y:number}|null) => void,
 * }} opts
 */
export function attachCanvas(viewport, world, opts) {
  const view = { x: 0, y: 0, z: 1, ...(opts.view ?? {}) };
  let saveTimer = null;

  const apply = () => {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    // The dot grid moves and scales with the world.
    viewport.style.backgroundSize = `${16 * view.z}px ${16 * view.z}px`;
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
    viewport.dispatchEvent(new CustomEvent('canvas:view', { detail: { ...view } }));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => opts.onView({ ...view }), 250);
  };

  const toWorld = (clientX, clientY) => {
    const r = viewport.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
  };

  /** Zoom by `factor`, keeping the world point under (cx, cy) in place. */
  const zoomAt = (factor, cx, cy) => {
    const r = viewport.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    const wx = (px - view.x) / view.z;
    const wy = (py - view.y) / view.z;
    view.z = clamp(view.z * factor);
    view.x = px - wx * view.z;
    view.y = py - wy * view.z;
    apply();
  };
  const zoomCenter = (factor) => {
    const r = viewport.getBoundingClientRect();
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
  };

  const fit = () => {
    const b = opts.bounds();
    const r = viewport.getBoundingClientRect();
    if (!b || !r.width) return;
    const pad = 48;
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxY - b.minY);
    view.z = clamp(Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h, 1));
    view.x = (r.width - w * view.z) / 2 - b.minX * view.z;
    view.y = Math.max(pad, (r.height - h * view.z) / 2) - b.minY * view.z;
    apply();
  };

  // ── Wheel: trackpad pan / pinch, mouse wheel / Ctrl+wheel ──────────────────
  viewport.addEventListener(
    'wheel',
    (e) => {
      if (e.target.closest?.('.panel, .canvas-toolbar')) return;
      e.preventDefault(); // the canvas handles it: no page scroll or browser zoom
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) {
        // Pinch arrives as small deltas, a mouse wheel notch as ~100: both feel even.
        const d = Math.max(-50, Math.min(50, e.deltaY * unit));
        zoomAt(Math.exp(-d * 0.01), e.clientX, e.clientY);
      } else {
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
        view.x -= dx;
        view.y -= dy;
        apply();
      }
    },
    { passive: false }
  );

  // ── Pointer: pan, node drag, connect, empty click ──────────────────────────
  let gesture = null;
  let suppressClick = false;

  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.canvas-toolbar, .panel, .panel-wrap')) return;
    const handle = e.target.closest('[data-out-handle]');
    const card = e.target.closest('[data-node-id]');
    const control = e.target.closest('button, a, input, select, textarea, [data-edge-id]');
    let kind;
    if (e.button === 1 || (e.button === 0 && spaceHeld)) kind = 'pan';
    else if (e.button !== 0) return;
    else if (handle) kind = 'connect';
    else if (card) kind = 'node';
    else if (control)
      return; // "+" buttons, edge menus: plain clicks
    else kind = 'empty';
    gesture = {
      kind,
      id: handle?.dataset.outHandle ?? card?.dataset.nodeId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      origin: handle ? toWorld(e.clientX, e.clientY) : null,
      pointerId: e.pointerId,
    };
    if (e.button === 1) e.preventDefault(); // no autoscroll
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!gesture) return;
    const dx = e.clientX - gesture.lastX;
    const dy = e.clientY - gesture.lastY;
    if (
      !gesture.moved &&
      Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) < DRAG_THRESHOLD
    ) {
      return;
    }
    if (!gesture.moved) {
      gesture.moved = true;
      // Capture only once it is a drag, so a plain click still reaches the card.
      viewport.setPointerCapture?.(gesture.pointerId);
      if (gesture.kind === 'pan' || gesture.kind === 'empty') viewport.classList.add('panning');
      if (gesture.kind === 'node') opts.onNodeDragStart?.(gesture.id);
    }
    gesture.lastX = e.clientX;
    gesture.lastY = e.clientY;
    if (gesture.kind === 'pan' || gesture.kind === 'empty') {
      view.x += dx;
      view.y += dy;
      apply();
    } else if (gesture.kind === 'node') {
      opts.onNodeDrag?.(gesture.id, dx / view.z, dy / view.z);
    } else if (gesture.kind === 'connect') {
      opts.connectPreview?.(gesture.origin, toWorld(e.clientX, e.clientY));
    }
  });

  const finish = (e) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    viewport.classList.remove('panning');
    if (g.moved) suppressClick = true;
    if (g.kind === 'node' && g.moved) opts.onNodeDragEnd?.(g.id);
    if (g.kind === 'connect') {
      opts.connectPreview?.(null, null);
      if (g.moved) {
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-node-id]')
          ?.dataset.nodeId;
        opts.onConnect?.(g.id, target ?? null);
      }
    }
    if (g.kind === 'empty' && !g.moved && e.type === 'pointerup') {
      opts.onEmptyClick?.(toWorld(e.clientX, e.clientY), { x: e.clientX, y: e.clientY });
    }
  };
  viewport.addEventListener('pointerup', finish);
  // Right click: the menu of what is under the pointer, instead of the browser's.
  viewport.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.canvas-toolbar, .panel, .panel-wrap, input, textarea, select')) return;
    e.preventDefault();
    if (!opts.onMenu) return;
    const edge = e.target.closest('[data-edge-id]');
    const card = e.target.closest('[data-node-id]');
    const target = edge
      ? { kind: 'edge', id: edge.dataset.edgeId }
      : card
        ? { kind: 'node', id: card.dataset.nodeId }
        : { kind: 'board' };
    opts.onMenu(target, toWorld(e.clientX, e.clientY), { x: e.clientX, y: e.clientY });
  });
  viewport.addEventListener('pointercancel', finish);
  // A drag must not end with a click that opens a card or a menu.
  viewport.addEventListener(
    'click',
    (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );

  const api = {
    viewport,
    get view() {
      return { ...view };
    },
    zoomIn: () => zoomCenter(STEP),
    zoomOut: () => zoomCenter(1 / STEP),
    reset: () => {
      const r = viewport.getBoundingClientRect();
      zoomAt(1 / view.z, r.left + r.width / 2, r.top + r.height / 2);
    },
    fit,
    toWorld,
  };
  current = api;
  if (opts.view) apply();
  else requestAnimationFrame(fit);
  return api;
}
