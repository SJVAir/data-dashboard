/**
 * Room toasts keep free at the bottom of the window, in pixels: the height of a bar pinned
 * there (Get data's action bar), so a toast never covers its buttons (WCAG 2.4.11). The bar
 * sets it while it's on screen; the toaster adds it to its bottom offset.
 */
export const toastClearance = $state({ bottom: 0 });
