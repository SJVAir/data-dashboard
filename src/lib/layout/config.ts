export const GRID_COLUMNS = 12;
/** Below Tailwind's `md` breakpoint the dashboard is one column. */
export const PHONE_QUERY = "(width < 48rem)";
/** A mouse or pen press must move this far (px) before it starts a drag, so a click stays a click. */
export const DRAG_THRESHOLD = 4;
/** While dragging, the page scrolls when the pointer is this close (px) to the viewport's top or bottom. */
export const AUTOSCROLL_EDGE = 40;
/** The fastest autoscroll, in px per frame (at the very edge). */
export const AUTOSCROLL_MAX_STEP = 16;
/** How long (ms) a touch must hold still on a title bar before it lifts the widget. */
export const LONG_PRESS_DELAY = 500;
/** How far (px) a touch may wander during the long-press (a farther move is a page swipe). */
export const LONG_PRESS_TOLERANCE = 8;
/**
 * The lowest row a widget may start on. Rects come from untrusted documents, and the layout
 * engine's work grows with row numbers and heights, so both are capped (schema and engine).
 */
export const MAX_ROW = 100_000;
/** The tallest a widget may be, in rows (see `MAX_ROW`). */
export const MAX_HEIGHT = 100;
