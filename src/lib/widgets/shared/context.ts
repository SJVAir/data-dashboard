/**
 * Context key for the frame's "remove this widget" function (leaves fullscreen first, then
 * deletes), so a widget's own Remove button matches the menu's Delete.
 */
export const REMOVE_WIDGET_KEY = Symbol("remove-widget");
/**
 * Context key for the frame's "my content needs this tall" function: a widget that fits its
 * content on a phone (a Note) reports its content's natural height in px (padding included), or
 * `null` when it's going away. The frame turns it into grid rows.
 */
export const FIT_CONTENT_KEY = Symbol("fit-content");
export type FitContent = (height: number | null) => void;
