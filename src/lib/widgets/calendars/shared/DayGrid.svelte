<script lang="ts" module>
	/** One labelled group of rows (a month), drawn as a `rowgroup`. */
	export type DayGridSection = { key: string; label?: string; rows: (string | null)[][] };
</script>

<script lang="ts">
	import { tick, type Snippet } from "svelte";
	import type { DayState } from "$lib/calendars/day-state";
	import { clampSelectable, moveFocus, spanOf, type Layout } from "$lib/calendars/selection";
	import type { CalendarData } from "./calendar-data.svelte";
	import { useCalendarTip } from "./calendar-tip.svelte";
	import type { DaySpan } from "./write-selection";

	let {
		layout,
		rows,
		sections,
		data,
		selection,
		onselect,
		cell,
		name,
		label,
		stateOf,
		header,
		dragging = $bindable(false),
		preview = $bindable(null),
		class: className = "",
		sectionClass = "",
		rowClass = ""
	}: {
		layout: Layout;
		/** The rows of one unlabelled group; or give `sections`. */
		rows?: (string | null)[][];
		sections?: DayGridSection[];
		data: CalendarData;
		/** The selected days shown (already limited to the range). */
		selection: DaySpan | null;
		/** A finished gesture's selection: one per click, Shift-click, finished drag, or key. */
		onselect: (sel: DaySpan | null) => void;
		/** A day's drawing (hidden from assistive tech: `name` is what's read). */
		cell: Snippet<[DayState, { focused: boolean; selected: boolean }]>;
		/** A day cell's accessible name. */
		name: (state: DayState, selected: boolean) => string;
		/** The grid's accessible name (the widget's title). */
		label: string;
		/** A drawn day's state; defaults to the range's states (days outside it are empty). */
		stateOf?: (date: string) => DayState | undefined;
		/** Drawn at the top of each section (hidden headings, a row of column headers). */
		header?: Snippet<[DayGridSection]>;
		/** A pointer drag or Shift+arrows are extending the selection (not yet saved). */
		dragging?: boolean;
		/** The selection a drag or Shift+arrows in progress would make. */
		preview?: DaySpan | null;
		class?: string;
		sectionClass?: string;
		rowClass?: string;
	} = $props();

	const stateFor = $derived(stateOf ?? ((date: string) => data.states.get(date)));
	const groups = $derived<DayGridSection[]>(sections ?? [{ key: "all", rows: rows ?? [] }]);
	const shown = $derived(preview ?? selection);
	const s = $derived(data.selectable);

	let root = $state<HTMLElement>();
	/** The focus day the viewer moved to; `null` until they do. */
	let moved = $state<string | null>(null);
	/** The fixed end of a Shift-extended selection. */
	let anchor: string | null = null;

	const firstDate = $derived(groups.flatMap((g) => g.rows.flat()).find((d) => d !== null) ?? null);
	/** The one cell in the Tab order: the focus day, or the first day when none can be picked. */
	const focusDay = $derived.by(() => {
		if (!s) return firstDate;
		return clampSelectable(moved ?? selection?.end ?? s.last, s);
	});

	/**
	 * The day the tooltip shows: the hovered day, or the focused one. It says what the cell's name
	 * says. A pointer's tip goes when the pointer leaves or anything scrolls; a focus tip follows
	 * its cell through a scroll (moving focus may scroll the cell into view) and goes with focus.
	 */
	const tip = useCalendarTip();
	let tipAt = $state<{ date: string; source: "pointer" | "focus" } | null>(null);
	const tipText = $derived.by(() => {
		if (!tipAt) return null;
		const state = stateFor(tipAt.date);
		return state ? name(state, isSelected(tipAt.date)) : null;
	});
	$effect(() => {
		if (!tip) return;
		const cell = tipAt && root?.querySelector<HTMLElement>(`[data-date="${tipAt.date}"]`);
		if (tipText && cell) tip.show({ text: tipText, cell });
		else tip.hide();
	});
	$effect(() => () => tip?.hide());
	// The pointer left the tooltip for somewhere off the grid: the tip goes too.
	$effect(() =>
		tip?.onleave(() => {
			if (tipAt?.source === "pointer") tipAt = null;
		})
	);
	// Escape dismisses a pointer's tip wherever focus is (WCAG 1.4.13); the grid's own Escape
	// handles the rest.
	$effect(() => {
		if (tipAt?.source !== "pointer") return;
		const onkey = (event: KeyboardEvent) => {
			if (event.key === "Escape") tipAt = null;
		};
		window.addEventListener("keydown", onkey);
		return () => window.removeEventListener("keydown", onkey);
	});
	$effect(() => {
		if (!tipAt) return;
		const source = tipAt.source;
		const onscroll = () => {
			if (source === "pointer") tipAt = null;
			else tip?.reposition();
		};
		window.addEventListener("scroll", onscroll, { capture: true, passive: true });
		return () => window.removeEventListener("scroll", onscroll, { capture: true });
	});

	const dayOf = (target: EventTarget | null): string | undefined => {
		const el = (target as Element | null)?.closest?.<HTMLElement>("[data-date]");
		return el && root?.contains(el) ? el.dataset.date : undefined;
	};

	function onpointerover(event: PointerEvent): void {
		if (event.pointerType === "touch") return;
		const date = dayOf(event.target);
		if (date) tipAt = { date, source: "pointer" };
		else if (tipAt?.source === "pointer") tipAt = null;
	}

	function onpointerleave(event: PointerEvent): void {
		// Onto the tooltip: it stays while the pointer is over it (WCAG 1.4.13).
		const to = event.relatedTarget as Element | null;
		if (to?.closest?.("[data-calendar-tip]")) return;
		if (tipAt?.source === "pointer") tipAt = null;
	}

	function onfocusin(event: FocusEvent): void {
		const date = dayOf(event.target);
		if (date) tipAt = { date, source: "focus" };
	}

	function onfocusout(event: FocusEvent): void {
		if (root?.contains(event.relatedTarget as Node | null)) return;
		finishExtend();
		if (tipAt?.source === "focus") tipAt = null;
	}

	const isSelected = (date: string) => !!shown && date >= shown.start && date <= shown.end;
	const pickable = (date: string | undefined): date is string =>
		!!date && !!s && date >= s.first && date <= s.last;

	/** The fixed end to extend from: the last anchor while it still bounds the selection. */
	function anchorFor(from: string): string {
		if (selection && anchor && (anchor === selection.start || anchor === selection.end)) {
			return anchor;
		}
		return selection?.start ?? from;
	}

	async function focusCell(date: string): Promise<void> {
		moved = date;
		await tick();
		root?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
	}

	const NAV = new Set([
		"ArrowLeft",
		"ArrowRight",
		"ArrowUp",
		"ArrowDown",
		"Home",
		"End",
		"PageUp",
		"PageDown"
	]);

	/**
	 * A Shift+arrow extension in progress, from its fixed end: shown as a preview and saved once
	 * Shift is let go (or focus leaves, or another key is pressed), so the whole gesture is one
	 * change, one undo step and one announcement, as a drag is.
	 */
	let extending: { from: string } | null = null;

	function finishExtend(): void {
		if (!extending) return;
		const sel = preview;
		extending = null;
		end();
		if (sel) onselect(sel);
	}

	const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta"]);

	function onkeyup(event: KeyboardEvent): void {
		if (event.key === "Shift") finishExtend();
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") {
			tipAt = null;
			const wasExtending = !!extending;
			if (wasExtending) {
				extending = null;
				end();
			}
			if (!selection && !wasExtending) return;
			event.preventDefault();
			event.stopPropagation();
			anchor = null;
			if (selection) onselect(null);
			return;
		}
		if (!s || !focusDay) return;
		if (NAV.has(event.key)) {
			event.preventDefault();
			const next = moveFocus(focusDay, event.key, layout, s);
			if (event.shiftKey) {
				extending ??= { from: selection ? anchorFor(focusDay) : focusDay };
				anchor = extending.from;
				const span = spanOf(extending.from, next);
				if (preview?.start !== span.start || preview?.end !== span.end) preview = span;
				dragging = true;
			} else {
				finishExtend();
			}
			void focusCell(next);
			return;
		}
		// A held Shift repeats its keydown on some systems: only other keys end the gesture.
		if (MODIFIERS.has(event.key)) return;
		finishExtend();
		if (event.key === " " || event.key === "Enter") {
			event.preventDefault();
			toggle(focusDay);
		}
	}

	/** Space/Enter on a day: select it alone, or clear it if it's all that's selected. */
	function toggle(date: string): void {
		anchor = date;
		if (selection?.start === date && selection.end === date) onselect(null);
		else onselect({ start: date, end: date });
	}

	/**
	 * A click or tap on a day, as a range picker does (one pointer is enough, WCAG 2.5.7): with one
	 * day selected, another day extends the selection to it; the only selected day clears it; with
	 * several days or none selected, it starts a new one-day selection.
	 */
	function click(date: string): void {
		const single = selection && selection.start === selection.end ? selection.start : null;
		if (single === null || single === date) return toggle(date);
		anchor = single;
		onselect(spanOf(single, date));
	}

	/** The pointer drag in progress: where it started, and whether it reached another day. */
	let drag: { from: string; pointer: number; moved: boolean } | null = null;

	function dateAt(x: number, y: number): string | undefined {
		const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-date]");
		return el && root?.contains(el) ? el.dataset.date : undefined;
	}

	function onpointerdown(event: PointerEvent): void {
		finishExtend();
		if (event.button !== 0 || !s) return;
		const date = (event.target as Element).closest<HTMLElement>("[data-date]")?.dataset.date;
		if (!pickable(date)) return;
		moved = date;
		if (event.shiftKey && selection) {
			const from = anchorFor(date);
			anchor = from;
			onselect(spanOf(from, date));
			return;
		}
		drag = { from: date, pointer: event.pointerId, moved: false };
		// Touch keeps its swipe to scroll (the browser cancels the pointer); a tap is a click.
		if (event.pointerType === "touch") return;
		// No preventDefault: the press still focuses the day (`select-none` stops text selection).
		try {
			root?.setPointerCapture(event.pointerId);
		} catch {
			// A synthetic or finished pointer: moves still arrive over the grid.
		}
	}

	function onpointermove(event: PointerEvent): void {
		if (!drag || drag.pointer !== event.pointerId || event.pointerType === "touch" || !s) return;
		const date = dateAt(event.clientX, event.clientY);
		if (!date) return;
		const to = clampSelectable(date, s);
		if (to === drag.from && !drag.moved) return;
		drag.moved = true;
		dragging = true;
		const next = spanOf(drag.from, to);
		if (preview?.start !== next.start || preview?.end !== next.end) preview = next;
	}

	function onpointerup(event: PointerEvent): void {
		if (!drag || drag.pointer !== event.pointerId) return;
		const done = drag;
		const sel = preview;
		end();
		if (done.moved && sel) {
			anchor = done.from;
			onselect(sel);
		} else {
			click(done.from);
		}
	}

	function end(): void {
		drag = null;
		preview = null;
		dragging = false;
	}

	function onpointercancel(event: PointerEvent): void {
		if (drag?.pointer === event.pointerId) end();
	}
</script>

<!-- svelte-ignore a11y_interactive_supports_focus (focus lives on the cells: a roving tabindex) -->
<div
	bind:this={root}
	role="grid"
	aria-label={label}
	data-dragging={dragging ? "" : undefined}
	class={["select-none", className]}
	{onkeydown}
	{onkeyup}
	{onpointerdown}
	{onpointerover}
	{onpointerleave}
	{onfocusin}
	{onfocusout}
	{onpointermove}
	{onpointerup}
	{onpointercancel}
>
	{#each groups as group (group.key)}
		<div role="rowgroup" aria-label={group.label} class={sectionClass}>
			{@render header?.(group)}
			{#each group.rows as row, r (r)}
				<div role="row" class={rowClass}>
					{#each row as date, c (c)}
						{@const state = date ? stateFor(date) : undefined}
						{#if date && state}
							{@const selected = isSelected(date)}
							<div
								role="gridcell"
								data-date={date}
								data-kind={state.kind}
								data-selected={selected ? "" : undefined}
								tabindex={date === focusDay ? 0 : -1}
								class="rounded-sm focus-visible:relative focus-visible:z-10"
							>
								<!-- Named from this text, not aria-label: the drawn day's visible words
								     (number, value, level) then needn't be one phrase of it (WCAG 2.5.3). -->
								<span class="sr-only" data-name>{name(state, selected)}</span>
								<div aria-hidden="true" class="h-full">
									{@render cell(state, { focused: date === focusDay, selected })}
								</div>
							</div>
						{:else}
							<div role="gridcell"></div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	{/each}
</div>
