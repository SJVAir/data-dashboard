<script lang="ts">
	import { onDestroy, setContext, untrack } from "svelte";
	import { on } from "svelte/events";
	import { MediaQuery } from "svelte/reactivity";
	import { toast } from "svelte-sonner";
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
	import { Flip, flipRect } from "$lib/layout/flip";
	import { requestFocus } from "$lib/layout/focus-request.svelte";
	import {
		checkDeepLink,
		exitPlan,
		FULLSCREEN_PARAM,
		FULLSCREEN_STATE,
		fullscreenId
	} from "$lib/layout/fullscreen";
	import { shownLayout } from "$lib/layout/items";
	import { taskbarWidgets } from "$lib/layout/windowing";
	import { STARTER_ID } from "$lib/starter/starter";
	import { useApp } from "$lib/store/app.svelte";
	import { navigate, route } from "../../../router";
	import AddWidgetButton from "./AddWidgetButton.svelte";
	import EmptyState from "./EmptyState.svelte";
	import Taskbar from "./Taskbar.svelte";
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
	const minimized = $derived(editable ? taskbarWidgets(editable.doc.body.widgets) : []);
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

	// Fullscreen: `?widget=<id>` on this page's own URL. A view, never an edit.
	const requested = $derived(fullscreenId(route.search));
	// The session is this page's: the dashboard in the route, or on `/` the starter or its copy.
	// Until then a previous page's session may still be current, and isn't checked against.
	const loaded = $derived.by(() => {
		if (!session) return false;
		const id = route.params.id;
		if (id) return session.doc.id === id;
		return app.current.isStarter || session.doc.copiedFrom === STARTER_ID;
	});
	const check = $derived(requested ? checkDeepLink(session, loaded, requested) : null);
	const shownId = $derived(check === "show" ? requested : null);
	const shownWidget = $derived(shownId ? byId.get(shownId) : undefined);

	/** This page's path, without the query (so without `widget`). */
	const here = () => route.pathname as "/";

	function openFullscreen(id: string): void {
		if (arrangement.active) arrangement.cancel();
		if (requested === id) return;
		void navigate(here(), {
			search: { [FULLSCREEN_PARAM]: id },
			state: FULLSCREEN_STATE,
			scrollToTop: false
		});
	}

	// The `widget` this page is leaving (until the URL drops it), so it's left only once.
	let leaving: string | null = null;
	$effect(() => {
		if (requested !== leaving) leaving = null;
	});

	/** Back if this page pushed the entry, else replace it without `widget`. */
	function exitFullscreen(): void {
		if (!requested || leaving === requested) return;
		leaving = requested;
		if (exitPlan(route.state).kind === "back") window.history.back();
		else void navigate(here(), { replace: true, scrollToTop: false });
	}

	// A link to a widget that isn't here, or one deleted in another tab: leave, with a notice. (This
	// tab's own Delete leaves first, so it gets only its own toast.) On a read-only page (no widgets
	// shown) it's dropped silently.
	$effect(() => {
		const result = check;
		const id = requested;
		if (result !== "missing" && result !== "read-only") return;
		untrack(() => {
			if (leaving === id) return;
			exitFullscreen();
			if (result === "missing") toast(m.fullscreen_widget_missing());
		});
	});

	// The dashboard area's top, where a fullscreen widget starts (notice bars can move it, and
	// the page may be scrolled past the top bar).
	let root = $state<HTMLElement | null>(null);
	function measureTop(): void {
		if (!root) return;
		const area = root.closest("main") ?? root;
		root.style.setProperty(
			"--fullscreen-top",
			`${Math.max(0, area.getBoundingClientRect().top)}px`
		);
	}
	$effect(() => {
		if (!shownId || !root) return;
		const area = root.closest("main") ?? root;
		const observer = new ResizeObserver(measureTop);
		for (const el of area.parentElement?.children ?? []) if (el !== area) observer.observe(el);
		const offs = [on(window, "scroll", measureTop), on(window, "resize", measureTop)];
		return () => {
			observer.disconnect();
			for (const off of offs) off();
		};
	});

	const frameOf = (id: string | null) =>
		id ? (root?.querySelector<HTMLElement>(`[data-flip-id="${CSS.escape(id)}"]`) ?? null) : null;

	// Entering and leaving fullscreen: grow from (or shrink back to) the grid cell, then move
	// focus to the title bar, or on leaving to the taskbar item of a minimized widget.
	let lastShown: string | null = null;
	// Whether the shown widget was minimized, and whether focus was in its frame, before an update
	// (another tab's minimize or restore moves it to the other frame, so it's mounted again).
	let lastMinimized = false;
	let focusWasIn = false;
	// Boxes measured before the DOM update and read once after it: not state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const from = new Map<string, DOMRect>();
	$effect.pre(() => {
		const next = shownId;
		void shownWidget?.minimized;
		untrack(() => {
			from.clear();
			const el = frameOf(lastShown);
			focusWasIn = !!el && el.contains(document.activeElement);
			if (next === lastShown) return;
			for (const id of [lastShown, next]) {
				const el = frameOf(id);
				if (id && el) from.set(id, el.getBoundingClientRect());
			}
		});
	});
	$effect(() => {
		const next = shownId;
		const nowMinimized = !!shownWidget?.minimized;
		untrack(() => {
			const prev = lastShown;
			const moved = nowMinimized !== lastMinimized;
			lastMinimized = nowMinimized;
			if (next === prev) {
				// Moved to the other frame: put focus back in it.
				if (next && moved && focusWasIn) requestFocus({ kind: "title", id: next });
				return;
			}
			lastShown = next;
			if (next) measureTop();
			for (const [id, rect] of from) {
				const el = frameOf(id);
				if (el) flipRect(el, rect);
			}
			from.clear();
			if (next) requestFocus({ kind: "title", id: next });
			// Not when the route has moved on to another dashboard (it isn't this page's widget).
			else if (prev && loaded) {
				const widget = byId.get(prev);
				if (widget) requestFocus({ kind: widget.minimized ? "taskbar" : "title", id: prev });
			}
		});
	});
</script>

{#if session}
	<ContextMenuHost>
		<div bind:this={root} class="flex min-h-full flex-col gap-4 p-4" {@attach menuScope(actions)}>
			{#if session.readOnly}
				<!-- A read-only document may not be valid, so its widgets aren't rendered. -->
				<p role="status" class="bg-muted rounded-lg px-4 py-2 text-sm">
					{session.readOnly === "newer" ? m.doc_readonly_newer() : m.doc_readonly_invalid()}
				</p>
			{:else}
				<!-- While a widget is fullscreen, the rest of the dashboard is inert. -->
				{#if app.current.isStarter}
					<div class="contents" inert={!!shownId}><StarterHint /></div>
				{/if}
				{#if placed.length === 0}
					<div class="contents" inert={!!shownId}>
						<EmptyState />
						<Taskbar widgets={minimized} onfullscreen={openFullscreen} />
					</div>
				{:else}
					<div
						bind:this={grid}
						class="grid auto-rows-[var(--grid-row-height)] grid-cols-1 gap-(--grid-gap) md:grid-cols-[repeat(12,minmax(0,1fr))]"
					>
						{#each placed as { widget, rect, phoneRow } (widget.id)}
							<WidgetFrame
								{widget}
								{rect}
								{phoneRow}
								fullscreen={widget.id === shownId}
								inert={!!shownId && widget.id !== shownId}
								onfullscreen={() => openFullscreen(widget.id)}
								onexit={exitFullscreen}
							/>
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
					<div inert={!!shownId}>
						<AddWidgetButton />
					</div>
					<div class="contents" inert={!!shownId}>
						<Taskbar widgets={minimized} onfullscreen={openFullscreen} />
					</div>
				{/if}
				{#if shownWidget?.minimized}
					<!-- A minimized widget has no frame in the grid to lift, so it gets its own. -->
					<WidgetFrame
						widget={shownWidget}
						rect={shownWidget.rect}
						phoneRow={0}
						fullscreen={true}
						onfullscreen={() => {}}
						onexit={exitFullscreen}
					/>
				{/if}
			{/if}
		</div>
	</ContextMenuHost>
{/if}
