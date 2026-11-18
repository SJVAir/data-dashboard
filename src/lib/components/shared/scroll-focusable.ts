import type { Attachment } from "svelte/attachments";

/**
 * Makes a scroll region a Tab stop only while its content overflows, so the keyboard can reach and
 * scroll it (axe's scrollable-region-focusable) without an extra Tab stop when nothing scrolls.
 * When it doesn't overflow it keeps `tabindex="-1"`, still focusable from script. Rechecks when
 * the region or its content changes size, and when its content changes; removes the tabindex when
 * it comes off.
 */
export const scrollFocusable: Attachment<HTMLElement> = (node) => {
	const update = () => {
		const overflows = node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth;
		node.setAttribute("tabindex", overflows ? "0" : "-1");
	};
	const resize = new ResizeObserver(update);
	// Observed afresh each time, so children that have left aren't held.
	const watch = () => {
		resize.disconnect();
		resize.observe(node);
		for (const child of node.children) resize.observe(child);
	};
	const mutation = new MutationObserver(() => {
		watch();
		update();
	});
	watch();
	mutation.observe(node, { childList: true, subtree: true, characterData: true });
	update();
	return () => {
		resize.disconnect();
		mutation.disconnect();
		// Off (the hover form, in the same element): no Tab stop left behind.
		node.removeAttribute("tabindex");
	};
};
