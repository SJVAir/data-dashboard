<script lang="ts">
	import { untrack } from "svelte";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import { announce } from "$lib/a11y/announcer.svelte";
	import { menuScope } from "$lib/actions/scope";
	import type { MenuProvider } from "$lib/actions/types";
	import { widgetActions, widgetTitle } from "$lib/actions/widget";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import type { Rect, WidgetInstance } from "$lib/documents/schema";
	import {
		useArrangement,
		type ArrangeDirection,
		type ArrangeMode
	} from "$lib/layout/arrangement.svelte";
	import { dropText, pickUpText, positionText, sizeText } from "$lib/layout/announcements";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { getWidgetType } from "$lib/widgets/registry";

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
		arrangement.pickUp(widget.id, mode, "keyboard");
		const preview = arrangement.preview;
		if (mine() && preview) announce(pickUpText(preview, widget.id, phone(), mode, title));
	}

	function drop(): void {
		const preview = arrangement.preview;
		const pushed = arrangement.pushedCount;
		arrangement.drop();
		if (preview) announce(dropText(preview, widget.id, phone(), title, pushed));
	}

	function cancel(): void {
		arrangement.cancel();
		announce(m.layout_cancelled({ title }));
	}

	function onkeydown(event: KeyboardEvent): void {
		// Keys pressed on the ⋯ button bubble here too.
		if (event.target !== event.currentTarget) return;
		if (event.ctrlKey || event.altKey || event.metaKey) return;
		const key = event.key;
		const active = mine();
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
	class="bg-card text-card-foreground border-border [grid-column:1/-1] [grid-row:var(--prow)] flex min-h-0 flex-col overflow-hidden rounded-lg border md:[grid-column:var(--col)] md:[grid-row:var(--row)]"
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
		class="border-border focus-visible:ring-ring/50 flex items-center gap-2 border-b py-1 pr-1 pl-3 outline-none focus-visible:ring-3"
		tabindex="0"
		role="group"
		aria-labelledby={titleId}
		{...hint}
		aria-keyshortcuts="Enter Shift+F10"
		{onkeydown}
		{onblur}
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
	<div class="min-h-0 flex-1">
		{#if type}
			<type.component {widget} />
		{/if}
	</div>
</section>
