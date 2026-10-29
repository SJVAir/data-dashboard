<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import { on } from "svelte/events";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import { announce } from "$lib/a11y/announcer.svelte";
	import { menuScope } from "$lib/actions/scope";
	import type { MenuProvider } from "$lib/actions/types";
	import { widgetActions, widgetTitle } from "$lib/actions/widget";
	import { pendingFocusTarget, takeFocus } from "$lib/layout/focus-request.svelte";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import type { Rect, WidgetInstance } from "$lib/documents/schema";
	import {
		useArrangement,
		type ArrangeDirection,
		type ArrangeMode
	} from "$lib/layout/arrangement.svelte";
	import { dropText, pickUpText, positionText, sizeText } from "$lib/layout/announcements";
	import { DRAG_THRESHOLD, LONG_PRESS_TOLERANCE } from "$lib/layout/config";
	import { startLongPress } from "$lib/layout/long-press";
	import { startPointerDrag, type DragKind, type ResizeEdge } from "$lib/layout/pointer-drag";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { getWidgetType } from "$lib/widgets/registry";
	import ResizeHandles from "./ResizeHandles.svelte";

	let {
		widget,
		rect,
		phoneRow
	}: {
		widget: WidgetInstance;
		/** Where it's shown (the tidied layout or the arrangement's preview), in desktop cells. */
		rect: Rect;
		/** Its first row (0-based) in the phone's one-column layout. */
		phoneRow: number;
	} = $props();

	const app = useApp();
	const arrangement = useArrangement();
	const type = $derived(getWidgetType(widget.type));
	const title = $derived(widgetTitle(widget));
	const titleId = $derived(`widget-title-${widget.id}`);

	// The type's own items first, then the common widget actions.
	const provider: MenuProvider = (ctx) => [
		...(type?.menu(ctx) ?? []),
		...widgetActions(app, widget.id, arrangement)(ctx)
	];

	let more = $state<HTMLButtonElement | null>(null);
	let bar = $state<HTMLDivElement | null>(null);
	let section = $state<HTMLElement | null>(null);
	// `aria-description` (ARIA 1.3) isn't in Svelte's attribute types yet, so it's spread.
	const hint = $derived({ "aria-description": m.layout_title_bar_hint() });

	const ARROWS: Record<string, ArrangeDirection> = {
		ArrowUp: "up",
		ArrowDown: "down",
		ArrowLeft: "left",
		ArrowRight: "right"
	};

	/** This widget's arrangement, when it's the one picked up. */
	function mine() {
		const active = arrangement.active;
		return active?.id === widget.id ? active : null;
	}

	function phone(): boolean {
		return arrangement.columns === 1;
	}

	function pickUp(mode: ArrangeMode): void {
		const before = arrangement.active;
		arrangement.pickUp(widget.id, mode, "keyboard");
		const preview = arrangement.preview;
		if (!mine() || !preview) return;
		const text = pickUpText(preview, widget.id, phone(), mode, title);
		// Another widget's touch or pointer arrangement was replaced: say so first (one
		// announcement, as a newer one would replace it before it's read).
		const replacedOne = before && before.id !== widget.id ? cancelledText(before.id) : null;
		announce(replacedOne ? `${replacedOne} ${text}` : text);
	}

	function drop(): void {
		selecting = false;
		const preview = arrangement.preview;
		const pushed = arrangement.pushedCount;
		const change = arrangement.drop();
		if (!preview) return;
		// Nothing applied (it's where it was, or the layout would pass the row caps).
		if (!change) announce(m.layout_cancelled({ title }));
		else announce(dropText(preview, widget.id, phone(), title, pushed));
	}

	function cancel(): void {
		selecting = false;
		arrangement.cancel();
		announce(m.layout_cancelled({ title }));
	}

	function onkeydown(event: KeyboardEvent): void {
		// Keys pressed on the ⋯ button bubble here too.
		if (event.target !== event.currentTarget) return;
		if (event.ctrlKey || event.altKey || event.metaKey) return;
		const key = event.key;
		const active = mine();
		// A pointer drag owns its arrangement (its Escape is handled before this).
		if (active && active.input !== "keyboard") return;
		if (!active) {
			if (key === "Enter" || key === " ") {
				event.preventDefault();
				pickUp("move");
			}
			return;
		}
		if (key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			cancel();
		} else if (key === "Enter" || key === " ") {
			event.preventDefault();
			drop();
		} else if (key in ARROWS) {
			// The arrows arrange the widget; they don't scroll the page.
			event.preventDefault();
			const dir = ARROWS[key];
			if (event.shiftKey) {
				arrangement.grow(dir);
				const preview = arrangement.preview;
				if (preview) announce(sizeText(preview, widget.id, phone()));
				return;
			}
			const result = arrangement.step(dir);
			const preview = arrangement.preview;
			if (result === "at-bottom") announce(m.layout_at_bottom({ title }));
			else if (preview) announce(positionText(preview, widget.id, phone()));
		}
	}

	/**
	 * A click from a screen reader's browse mode (`detail` 0: no pointer behind it) acts like
	 * Enter, since browse mode may turn Enter into a click instead of passing the key on.
	 */
	function onclick(event: MouseEvent): void {
		if (event.detail !== 0 || event.target !== event.currentTarget) return;
		const active = mine();
		if (active && active.input !== "keyboard") return;
		event.preventDefault();
		if (active) drop();
		else pickUp("move");
	}

	// The pointer drag in progress (or waiting for the press to move far enough).
	let stopDrag: (() => void) | null = null;
	// A touch press waiting to become a long-press.
	let stopLongPress: (() => void) | null = null;
	onDestroy(() => {
		stopLongPress?.();
		stopDrag?.();
	});

	/** What's said when the arrangement of widget `id` is cancelled. */
	function cancelledText(id: string): string {
		const other = app.current.session?.editTarget.doc.body.widgets.find((w) => w.id === id);
		return m.layout_cancelled({ title: other ? widgetTitle(other) : title });
	}

	/** A drag replaced another arrangement in progress: say that one was cancelled. */
	function replaced(id: string): void {
		announce(cancelledText(id));
	}

	/** Mouse and pen only here; touch lifts by long-press. */
	function startDrag(event: PointerEvent, kind: DragKind): void {
		if (event.button !== 0 || !event.isPrimary || !section) return;
		if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
		stopDrag?.();
		const handle = event.currentTarget as Element;
		stopDrag = startPointerDrag(event, handle, {
			arrangement,
			id: widget.id,
			frame: section,
			kind,
			input: "pointer",
			threshold: DRAG_THRESHOLD,
			drop,
			cancel,
			replaced
		});
	}

	// Touch: a long-press on the title bar lifts the widget. Sliding then moves it and the
	// release drops it; a release without sliding selects it instead, with touch-sized resize
	// handles and a Done button. While selected, the title bar and handles drag at once, and
	// everything done in the selection is one change when Done (or a tap outside) finishes it.
	/** The touch selection's state (true from a still release until it finishes). */
	let selecting = $state(false);
	/** A touch gesture is under way (the long-press's drag, or one in the selection). */
	let gesture = $state(false);
	const touchActive = $derived(mine()?.input === "touch");
	const selected = $derived(selecting && touchActive);

	/** Follow a touch on a lifted widget: from the long-press, or a selected widget's gesture. */
	function touchDrag(event: PointerEvent, handle: Element, kind: DragKind, fromLongPress: boolean) {
		if (!section) return;
		stopDrag?.();
		gesture = true;
		stopDrag = startPointerDrag(event, handle, {
			arrangement,
			id: widget.id,
			frame: section,
			kind,
			input: "touch",
			lifted: true,
			threshold: fromLongPress ? LONG_PRESS_TOLERANCE : DRAG_THRESHOLD,
			drop,
			cancel,
			release: (moved) => {
				if (fromLongPress && moved) drop();
				else selecting = true;
			},
			replaced,
			onEnd: () => (gesture = false)
		});
	}

	function onTouchPress(event: PointerEvent): void {
		if (!event.isPrimary) return;
		const handle = event.currentTarget as Element;
		if (selected) {
			touchDrag(event, handle, { mode: "move" }, false);
			return;
		}
		stopLongPress?.();
		stopLongPress = startLongPress(event, (at) => {
			stopLongPress = null;
			selecting = false;
			touchDrag(at, handle, { mode: "move" }, true);
		});
	}

	function onpointerdown(event: PointerEvent): void {
		// The ⋯ button isn't a drag handle.
		if ((event.target as Element).closest("button")) return;
		if (event.pointerType === "touch") onTouchPress(event);
		else startDrag(event, { mode: "move" });
	}

	function onHandleStart(event: PointerEvent, edge: ResizeEdge): void {
		const kind: DragKind = { mode: "resize", edge };
		if (event.pointerType !== "touch") startDrag(event, kind);
		else if (selected && event.isPrimary) {
			touchDrag(event, event.currentTarget as Element, kind, false);
		}
	}

	// While selected, a tap outside the frame finishes the selection (a swipe there just
	// scrolls); Escape, or a new window width (e.g. a rotation), cancels it.
	$effect(() => {
		if (!selected) return;
		const width = window.innerWidth;
		let tap: { id: number; x: number; y: number } | null = null;
		const onDown = (event: PointerEvent) => {
			const inside = event.target instanceof Node && section?.contains(event.target);
			tap = inside || !event.isPrimary ? null : { id: event.pointerId, ...client(event) };
		};
		const onMove = (event: PointerEvent) => {
			if (tap?.id !== event.pointerId) return;
			if (distance(tap, client(event)) > LONG_PRESS_TOLERANCE) tap = null;
		};
		const onUp = (event: PointerEvent) => {
			const tapped = tap?.id === event.pointerId;
			tap = null;
			if (tapped && mine()?.input === "touch") drop();
		};
		const onCancel = () => (tap = null);
		const onResize = () => {
			if (window.innerWidth !== width && mine()?.input === "touch") cancel();
		};
		const onKey = (event: KeyboardEvent) => {
			// A gesture's own Escape may have cancelled it already.
			if (event.key !== "Escape" || mine()?.input !== "touch") return;
			event.preventDefault();
			event.stopPropagation();
			cancel();
		};
		const listeners: [string, EventListener][] = [
			["pointerdown", onDown as EventListener],
			["pointermove", onMove as EventListener],
			["pointerup", onUp as EventListener],
			["pointercancel", onCancel],
			["keydown", onKey as EventListener]
		];
		for (const [type, listener] of listeners) window.addEventListener(type, listener, true);
		window.addEventListener("resize", onResize);
		return () => {
			for (const [type, l] of listeners) window.removeEventListener(type, l, true);
			window.removeEventListener("resize", onResize);
		};
	});

	const client = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });
	const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
		Math.hypot(a.x - b.x, a.y - b.y);

	/**
	 * Keep the page from scrolling under a touch gesture. Attached (non-passive) to the title bar
	 * and the touch handles from the start: browsers decide at touchstart whether a touch's moves
	 * can be cancelled, so a listener added at the lift would come too late.
	 */
	function blockScroll(event: TouchEvent): void {
		if (gesture && touchActive && event.cancelable) event.preventDefault();
	}
	const scrollBlocker = (el: HTMLElement) => on(el, "touchmove", blockScroll, { passive: false });

	/**
	 * A touch long-press on the title bar or a touch handle is the drag gesture, never a menu
	 * (native or ours). The widget's body keeps its native long-press menus.
	 */
	function oncontextmenu(event: MouseEvent): void {
		const touchEvent = event instanceof PointerEvent && event.pointerType === "touch";
		if (touchEvent || touchActive) event.preventDefault();
	}

	const noMenu = (el: HTMLElement) => on(el, "contextmenu", oncontextmenu);

	const dragging = $derived(mine()?.input === "pointer" || (gesture && touchActive));

	// Moving focus away cancels a keyboard arrangement: Tab, a click elsewhere, or the window
	// losing focus.
	function onblur(): void {
		if (mine()?.input === "keyboard") cancel();
	}

	// After a drop (the element may have moved, or the page been rebuilt for a starter's copy).
	$effect(() => {
		if (!bar || arrangement.pendingFocus !== widget.id) return;
		bar.focus();
		arrangement.pendingFocus = null;
	});

	// After a restore: focus the title bar and bring the widget into view.
	$effect(() => {
		const request = pendingFocusTarget();
		if (!bar || request?.kind !== "title" || request.id !== widget.id) return;
		untrack(() => {
			if (!takeFocus({ kind: "title", id: widget.id })) return;
			bar!.focus();
			const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
			section?.scrollIntoView({ block: "nearest", behavior: reduced ? "instant" : "smooth" });
		});
	});

	// Move… / Resize… from the menu: focus first, then pick up, so the focus move can't cancel it.
	$effect(() => {
		const request = arrangement.pickUpRequest;
		if (!bar || request?.id !== widget.id) return;
		untrack(() => {
			arrangement.pickUpRequest = null;
			bar!.focus();
			pickUp(request.mode);
		});
	});
</script>

<svelte:window {onblur} />

<!-- Not a named region: one landmark per widget would crowd the landmark list. -->
<section
	bind:this={section}
	class={[
		"group bg-card text-card-foreground border-border relative [grid-column:1/-1] [grid-row:var(--prow)] flex min-h-0 flex-col overflow-hidden rounded-lg border md:[grid-column:var(--col)] md:[grid-row:var(--row)]",
		dragging && "z-10 shadow-lg",
		touchActive && "ring-ring ring-2"
	]}
	style:--col="{rect.x + 1} / span {rect.w}"
	style:--row="{rect.y + 1} / span {rect.h}"
	style:--prow="{phoneRow + 1} / span {rect.h}"
	data-testid="widget-{widget.id}"
	data-flip-id={widget.id}
	{@attach menuScope(provider)}
>
	<!-- Focusable: Enter picks the widget up to move it; Shift+F10 / the Menu key opens its menu. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={bar}
		class={[
			"border-border focus-visible:ring-ring/50 flex items-center gap-2 border-b py-1 pr-1 pl-3 outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3",
			dragging ? "cursor-grabbing" : "pointer-fine:cursor-grab",
			// Page swipes over the title bar scroll; a lifted widget's next touch drags it.
			touchActive ? "touch-none" : "touch-pan-y"
		]}
		tabindex="0"
		role="group"
		aria-labelledby={titleId}
		{...hint}
		aria-keyshortcuts="Enter Shift+F10"
		{onkeydown}
		{onblur}
		{onpointerdown}
		{onclick}
		{@attach scrollBlocker}
		{@attach noMenu}
	>
		<h2 id={titleId} class="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
		<Button
			bind:ref={more}
			variant="ghost"
			size="icon-sm"
			aria-label={m.widget_menu({ title })}
			onclick={() => more && openMenuFor(more, { widgetId: widget.id })}
		>
			<Ellipsis aria-hidden="true" />
		</Button>
	</div>
	<div class="relative min-h-0 flex-1">
		{#if type}
			<type.component {widget} />
		{/if}
		{#if selected}
			<!-- Below the title bar, which still drags the selected widget. -->
			<div class="contents" {@attach scrollBlocker} {@attach noMenu}>
				<ResizeHandles
					phone={arrangement.columns === 1}
					shown={true}
					touch={true}
					onstart={onHandleStart}
				/>
			</div>
			<div class="pointer-events-none absolute inset-0 z-10 grid place-items-center">
				<Button class="pointer-events-auto min-h-11 min-w-11 shadow-md" onclick={drop}>
					{m.layout_done()}
				</Button>
			</div>
		{/if}
	</div>
	{#if !selected}
		<ResizeHandles
			phone={arrangement.columns === 1}
			shown={dragging && mine()?.mode === "resize"}
			onstart={onHandleStart}
		/>
	{/if}
</section>
