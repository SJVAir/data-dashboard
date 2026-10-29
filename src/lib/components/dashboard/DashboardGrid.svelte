<script lang="ts">
	import { onDestroy, setContext, untrack } from "svelte";
	import { MediaQuery } from "svelte/reactivity";
	import { announce } from "$lib/a11y/announcer.svelte";
	import { dashboardActions } from "$lib/actions/dashboard";
	import { historyActions } from "$lib/actions/global";
	import { menuScope } from "$lib/actions/scope";
	import type { MenuProvider } from "$lib/actions/types";
	import { widgetTitle } from "$lib/actions/widget";
	import ContextMenuHost from "$lib/components/menu/ContextMenuHost.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import type { Rect } from "$lib/documents/schema";
	import { ARRANGEMENT_KEY, Arrangement } from "$lib/layout/arrangement.svelte";
	import { GRID_COLUMNS, PHONE_QUERY } from "$lib/layout/config";
	import { Flip } from "$lib/layout/flip";
	import { shownLayout } from "$lib/layout/items";
	import { useApp } from "$lib/store/app.svelte";
	import AddWidgetButton from "./AddWidgetButton.svelte";
	import EmptyState from "./EmptyState.svelte";
	import StarterHint from "./StarterHint.svelte";
	import WidgetFrame from "./WidgetFrame.svelte";

	let {
		onArrangement
	}: {
		/** Tests only: hands over the grid's arrangement controller once it's made. */
		onArrangement?: (arrangement: Arrangement) => void;
	} = $props();

	const app = useApp();
	const dashboard = dashboardActions(app);
	const history = historyActions(app);
	// Not bubbled: a widget's menu lists only its own actions.
	const actions: MenuProvider = (ctx) => [...dashboard(ctx), ...history(ctx)];

	const session = $derived(app.current.session);
	const editable = $derived(session && !session.readOnly ? session : null);

	const phone = new MediaQuery(PHONE_QUERY);
	// The active widget's title, kept from pickup on: when it goes, it's no longer in the document.
	let activeTitle = "";
	const arrangement = new Arrangement(
		() => editable,
		() => (phone.current ? 1 : GRID_COLUMNS),
		{ onGone: () => announce(m.layout_gone({ title: activeTitle })) }
	);
	setContext(ARRANGEMENT_KEY, arrangement);
	untrack(() => onArrangement?.(arrangement));
	onDestroy(() => arrangement.dispose());

	// The shown (tidied) layout, always in desktop coordinates and in reading order, so the
	// single-column layout and the tab order follow it.
	const shown = $derived(editable ? shownLayout(editable.doc.body.widgets) : []);
	const byId = $derived(new Map(editable?.doc.body.widgets.map((w) => [w.id, w]) ?? []));
	// Each widget's place: the arrangement's preview while one is in progress, else the shown
	// layout. On a phone each widget is placed on explicit rows (its height, in the placed
	// layout's reading order), so the drop target can overlay a slot without moving the others.
	const places = $derived.by(() => {
		// Rebuilt whole on every change, never mutated after.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const out = new Map<string, { rect: Rect; phoneRow: number }>();
		let phoneRow = 0;
		for (const item of arrangement.preview ?? shown) {
			out.set(item.id, { rect: item.rect, phoneRow });
			phoneRow += item.rect.h;
		}
		return out;
	});
	// The DOM keeps the shown layout's order while arranging (only the places change): moving
	// the focused widget's element would drop its focus. It reorders once the drop lands.
	const placed = $derived(
		shown.flatMap((item) => {
			const widget = byId.get(item.id);
			const place = places.get(item.id);
			return widget && place ? [{ widget, ...place }] : [];
		})
	);
	const active = $derived(arrangement.active);
	const target = $derived(active ? placed.find((p) => p.widget.id === active.id) : undefined);

	$effect.pre(() => {
		const widget = active && byId.get(active.id);
		if (widget) activeTitle = widgetTitle(widget);
	});

	// Widgets that change place animate there (FLIP), except one that follows the pointer.
	let grid = $state<HTMLElement | null>(null);
	const flip = new Flip();
	$effect.pre(() => {
		void placed;
		untrack(() => flip.measure(grid));
	});
	$effect(() => {
		void placed;
		untrack(() => {
			const a = arrangement.active;
			flip.play(grid, a && a.input !== "keyboard" ? a.id : null);
		});
	});
</script>

{#if session}
	<ContextMenuHost>
		<div class="flex min-h-full flex-col gap-4 p-4" {@attach menuScope(actions)}>
			{#if session.readOnly}
				<!-- A read-only document may not be valid, so its widgets aren't rendered. -->
				<p role="status" class="bg-muted rounded-lg px-4 py-2 text-sm">
					{session.readOnly === "newer" ? m.doc_readonly_newer() : m.doc_readonly_invalid()}
				</p>
			{:else}
				{#if app.current.isStarter}
					<StarterHint />
				{/if}
				{#if placed.length === 0}
					<EmptyState />
				{:else}
					<div
						bind:this={grid}
						class="grid auto-rows-[var(--grid-row-height)] grid-cols-1 gap-(--grid-gap) md:grid-cols-[repeat(12,minmax(0,1fr))]"
					>
						{#each placed as { widget, rect, phoneRow } (widget.id)}
							<WidgetFrame {widget} {rect} {phoneRow} />
						{/each}
						{#if target}
							<!-- Where the active widget will land: an outline, not a tint. -->
							<div
								aria-hidden="true"
								data-testid="drop-target"
								class="border-ring pointer-events-none [grid-column:1/-1] [grid-row:var(--prow)] rounded-lg border-2 border-dashed md:[grid-column:var(--col)] md:[grid-row:var(--row)]"
								style:--col="{target.rect.x + 1} / span {target.rect.w}"
								style:--row="{target.rect.y + 1} / span {target.rect.h}"
								style:--prow="{target.phoneRow + 1} / span {target.rect.h}"
							></div>
						{/if}
					</div>
					<div>
						<AddWidgetButton />
					</div>
				{/if}
			{/if}
		</div>
	</ContextMenuHost>
{/if}
