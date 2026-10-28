export const GRID_COLUMNS = 12;
/** Below Tailwind's `md` breakpoint the dashboard is one column. */
export const PHONE_QUERY = "(width < 48rem)";
/** A mouse or pen press must move this far (px) before it starts a drag, so a click stays a click. */
export const DRAG_THRESHOLD = 4;
/** While dragging, the page scrolls when the pointer is this close (px) to the viewport's top or bottom. */
export const AUTOSCROLL_EDGE = 40;
/** The fastest autoscroll, in px per frame (at the very edge). */
export const AUTOSCROLL_MAX_STEP = 16;
