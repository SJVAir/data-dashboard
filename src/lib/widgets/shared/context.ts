/**
 * Context key for the frame's "remove this widget" function (leaves fullscreen first, then
 * deletes), so a widget's own Remove button matches the menu's Delete.
 */
export const REMOVE_WIDGET_KEY = Symbol("remove-widget");
/**
 * Context key for the frame's "my content needs this tall" function: a widget that fits its
 * content on a phone (a Note) reports its content's natural height in px (padding included), or
 * `null` when it's going away. The frame turns it into grid rows (only on a phone), always in a
 * microtask. Never apply a fit to the grid during an effect flush: a state write there re-runs
 * every frame's `{#await loadWidget(type)}` block, remounting the widgets (and, for a widget that
 * measures on mount, looping).
 */
export const FIT_CONTENT_KEY = Symbol("fit-content");
export type FitContent = (height: number | null) => void;
