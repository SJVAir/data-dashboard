/**
 * A tile's options, changed from inside the tile (the Map's toolbar, say). "A viewer can change
 * what a tile shows, never what it holds": on an editable dashboard a change is one undoable
 * `setWidgetData` (a starter's edit goes to its copy); on a read-only view that shows tiles it's
 * held in memory for the visit (`ViewerChanges`) and never saved, stored, sent or logged.
 */
import { getContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { Change } from "$lib/changes/types";
import { widgetOptionsValid, type Dashboard, type WidgetInstance } from "$lib/documents/schema";
import type { DocumentSession } from "$lib/store/document-session.svelte";

type Options = Record<string, unknown>;

/**
 * A viewer's changes to the tiles of one read-only view, per widget id: only the keys the viewer
 * changed. A held key whose value is `undefined` means "missing" (the drawn default), so a viewer
 * can go back to a default the owner changed. In memory only.
 */
export class ViewerChanges {
	readonly #held = new SvelteMap<string, Options>();

	/** The keys held for `widgetId`, if any. */
	get(widgetId: string): Options | undefined {
		return this.#held.get(widgetId);
	}

	/** Holds `values` over what's held for `widgetId` (a key set to `undefined` is held as missing). */
	set(widgetId: string, values: Options): void {
		const keys = Object.keys(values);
		if (keys.length === 0) return;
		this.#held.set(widgetId, { ...this.#held.get(widgetId), ...values });
	}

	/** Forgets the held `keys` for `widgetId` (back to the owner's values). */
	drop(widgetId: string, keys: string[]): void {
		const held = this.#held.get(widgetId);
		if (!held) return;
		const rest = { ...held };
		for (const key of keys) delete rest[key];
		if (Object.keys(rest).length === 0) this.#held.delete(widgetId);
		else if (Object.keys(rest).length !== Object.keys(held).length) this.#held.set(widgetId, rest);
	}

	/** `doc` with the held changes over its widgets' options (a held key that doesn't validate is left out). */
	applyTo(doc: Dashboard): Dashboard {
		let changed = false;
		const widgets = doc.body.widgets.map((widget) => {
			const held = this.#held.get(widget.id);
			if (!held) return widget;
			const merged = merge(widget, held);
			if (merged === widget.options) return widget;
			changed = true;
			const next: WidgetInstance = { ...widget };
			if (merged === undefined) delete next.options;
			else next.options = merged;
			return next;
		});
		return changed ? { ...doc, body: { ...doc.body, widgets } } : doc;
	}

	/** Forgets the widgets no longer in `doc` (the owner removed them). */
	prune(doc: Dashboard): void {
		// A lookup, not state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const ids = new Set(doc.body.widgets.map((w) => w.id));
		for (const id of [...this.#held.keys()]) if (!ids.has(id)) this.#held.delete(id);
	}
}

export const TILE_OPTIONS_KEY = Symbol("tile-options");
/** Tests only: a function the grid hands its tile-options context to. */
export const TILE_OPTIONS_PROBE_KEY = Symbol("tile-options-probe");

/**
 * Where a tile's changes go. Edit: the app's current session, read at write time (the starter
 * hands off to its copy). View: the view's `ViewerChanges`. The grid provides one stable object
 * whose fields are getters, so a widget reads it once.
 */
export type TileOptionsContext =
	| { readonly mode: "edit"; session(): DocumentSession | null }
	| { readonly mode: "view"; readonly changes: ViewerChanges };

/** The grid's tile-options context, if any. */
export function useTileOptions(): TileOptionsContext | undefined {
	return getContext<TileOptionsContext | undefined>(TILE_OPTIONS_KEY);
}

/** The options the tile shows: the saved ones, with a viewer's held keys over in view mode. */
export function tileOptions(
	ctx: TileOptionsContext | undefined,
	widget: WidgetInstance
): Options | undefined {
	if (ctx?.mode !== "view") return widget.options;
	const held = ctx.changes.get(widget.id);
	if (!held) return widget.options;
	return merge(widget, held);
}

/**
 * The tile's options changed to `next` (all of them; `changedKeys` names the ones that changed).
 * Edit: one undoable change (nothing when equal, or when the widget isn't in the current
 * editable dashboard). View: the changed keys held for the visit.
 */
export function changeTileOptions(
	ctx: TileOptionsContext | undefined,
	widget: WidgetInstance,
	next: Options | undefined,
	changedKeys: string[]
): void {
	if (!ctx) return;
	if (ctx.mode === "view") {
		const values: Options = {};
		for (const key of changedKeys) values[key] = next?.[key];
		ctx.changes.set(widget.id, values);
		return;
	}
	const session = ctx.session();
	if (!session || session.readOnly) return;
	const current = session.doc.body.widgets.find((w) => w.id === widget.id);
	if (!current) return;
	const change = optionsChange(current, next);
	if (change) session.apply(change);
}

/** View mode: forgets the viewer's `keys` for `widget` (back to the owner's values). */
export function viewerReset(
	ctx: TileOptionsContext | undefined,
	widget: WidgetInstance,
	keys: string[]
): void {
	if (ctx?.mode === "view") ctx.changes.drop(widget.id, keys);
}

/** The setWidgetData change replacing `widget`'s options with `next`, or null when equal. */
function optionsChange(widget: WidgetInstance, next: Options | undefined): Change | null {
	const to = normalize(widget.type, next);
	if (same(widget.options, to)) return null;
	return {
		op: "setWidgetData",
		target: { widgetId: widget.id },
		from: widget.data,
		to: widget.data,
		options: { from: widget.options, to }
	};
}

/**
 * `widget`'s options with `held` over (keys held as missing left out). When that doesn't
 * validate, the held keys are added one at a time (in key order), each kept only if the options
 * still validate. Nothing kept: the saved options themselves (the same object).
 */
function merge(widget: WidgetInstance, held: Options): Options | undefined {
	const over = (keys: Options) => {
		const merged: Options = { ...widget.options, ...keys };
		for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
		return normalize(widget.type, merged);
	};
	const valid = (options: Options | undefined) => widgetOptionsValid(widget.type, options);
	const full = over(held);
	if (valid(full)) return full;
	let kept: Options = {};
	for (const key of Object.keys(held).sort()) {
		const next = { ...kept, [key]: held[key] };
		if (valid(over(next))) kept = next;
	}
	return Object.keys(kept).length ? over(kept) : widget.options;
}

/** No keys and no options are one thing: missing, where the type allows it. */
function normalize(type: string, options: Options | undefined): Options | undefined {
	if (options && Object.keys(options).length === 0 && widgetOptionsValid(type, undefined)) {
		return undefined;
	}
	return options;
}

/** Structural equality for JSON-shaped values (key order ignored). */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => same(v, b[i]));
	}
	const ak = Object.keys(a);
	const bo = b as Options;
	return (
		ak.length === Object.keys(b).length &&
		ak.every((k) => Object.hasOwn(bo, k) && same((a as Options)[k], bo[k]))
	);
}
