/**
 * The `onOpenAutoFocus` for a top-level menu's content (context and dropdown menus).
 *
 * bits-ui's own open focus waits a frame, then focuses the menu (whose keyboard handling moves
 * on to the first item). Its focus scope mounts twice as a menu opens, so a second such frame
 * follows the first; on a busy machine it can arrive after the next key press, when ArrowRight
 * has already opened a submenu and moved focus into it. Focusing the parent menu then closes the
 * submenu, and the arrow keys move in the parent instead. This does the same focus, but only
 * while the menu is still open and focus isn't already in an open menu.
 */
export function menuOpenAutoFocus(
	event: Event,
	content: () => HTMLElement | null,
	onOpenAutoFocus?: (event: Event) => void
): void {
	onOpenAutoFocus?.(event);
	if (event.defaultPrevented) return;
	event.preventDefault();
	requestAnimationFrame(() => {
		const node = content();
		// Not once it's closing (it stays in the page for its exit animation).
		if (!node?.isConnected || node.dataset.state !== "open") return;
		if (document.activeElement?.closest("[role=menu][data-state=open]")) return;
		node.focus({ preventScroll: true });
	});
}
