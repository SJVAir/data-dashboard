// Light on purpose (initial bundle, types only): the Map's menu reads it; each mounted Map
// (lazy code) writes it. So the menu needn't recompute which marks to send.
import type { WidgetDataConfig } from "$lib/data/schema";

export type MapSendEntry = {
	/** The marks to send, in mark order; empty: the items aren't listed (D13). */
	marks: readonly string[];
	leftOut: number;
	/** The Map's dataset as this person sees it: data plus `tileOptions` (D21). */
	draft: () => { type: string; data: WidgetDataConfig; options?: Record<string, unknown> };
};

/** Per widget id, what each mounted copy of it offers (a widget and its Get data preview). */
const sends = new Map<string, Map<symbol, MapSendEntry>>();

/** Records what a mounted Map offers (`null`: nothing); returns its removal. */
export function setMapSend(
	widgetId: string,
	owner: symbol,
	entry: MapSendEntry | null
): () => void {
	let copies = sends.get(widgetId);
	if (entry) {
		if (!copies) sends.set(widgetId, (copies = new Map()));
		// Re-inserting moves the owner to the end: the latest-set copy wins.
		copies.delete(owner);
		copies.set(owner, entry);
	} else {
		copies?.delete(owner);
		if (copies?.size === 0) sends.delete(widgetId);
	}
	return () => setMapSend(widgetId, owner, null);
}

/** The entry of the latest-set copy of the widget, or null. */
export function mapSend(widgetId: string): MapSendEntry | null {
	const copies = sends.get(widgetId);
	if (!copies) return null;
	let last: MapSendEntry | null = null;
	for (const e of copies.values()) last = e;
	return last;
}
