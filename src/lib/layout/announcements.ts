import { formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import type { ArrangeMode } from "./arrangement.svelte";
import type { Layout } from "./engine";

/**
 * What the live region says while a widget is arranged. Positions are 1-based: a column and
 * row on the grid, or a place in reading order on a phone (one column).
 */
type Where =
	{ phone: false; column: string; row: string } | { phone: true; position: string; total: string };

function where(layout: Layout, id: string, phone: boolean): Where | null {
	const index = layout.findIndex((i) => i.id === id);
	if (index === -1) return null;
	if (phone) {
		return {
			phone: true,
			position: formatNumber(index + 1),
			total: formatNumber(layout.length)
		};
	}
	const { x, y } = layout[index].rect;
	return { phone: false, column: formatNumber(x + 1), row: formatNumber(y + 1) };
}

function size(layout: Layout, id: string): { w: number; h: number } | null {
	return layout.find((i) => i.id === id)?.rect ?? null;
}

/** On a phone (one column) only the height can change, so only the height is said. */
export function sizeText(layout: Layout, id: string, phone: boolean): string {
	const s = size(layout, id);
	if (!s) return "";
	if (phone) return m.layout_height({ height: formatNumber(s.h), heightValue: s.h });
	return m.layout_size({
		width: formatNumber(s.w),
		widthValue: s.w,
		height: formatNumber(s.h),
		heightValue: s.h
	});
}

export function positionText(layout: Layout, id: string, phone: boolean): string {
	const at = where(layout, id, phone);
	if (!at) return "";
	return at.phone ? m.layout_phone_position(at) : m.layout_position(at);
}

export function pickUpText(
	layout: Layout,
	id: string,
	phone: boolean,
	mode: ArrangeMode,
	title: string
): string {
	if (mode === "resize") {
		const s = size(layout, id);
		if (!s) return "";
		if (phone) {
			return m.layout_picked_up_resize_phone({
				title,
				height: formatNumber(s.h),
				heightValue: s.h
			});
		}
		return m.layout_picked_up_resize({
			title,
			width: formatNumber(s.w),
			widthValue: s.w,
			height: formatNumber(s.h),
			heightValue: s.h
		});
	}
	const at = where(layout, id, phone);
	if (!at) return "";
	return at.phone
		? m.layout_picked_up_phone({ title, ...at })
		: m.layout_picked_up({ title, ...at });
}

/** `pushed`: how many other widgets the drop moved. */
export function dropText(
	layout: Layout,
	id: string,
	phone: boolean,
	title: string,
	pushed: number
): string {
	const at = where(layout, id, phone);
	if (!at) return "";
	if (at.phone) return m.layout_dropped_phone({ title, ...at });
	return m.layout_dropped({
		title,
		column: at.column,
		row: at.row,
		count: formatNumber(pushed),
		countValue: pushed
	});
}
