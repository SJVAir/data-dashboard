<script lang="ts">
	import { untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import DashboardGrid from "$lib/components/dashboard/DashboardGrid.svelte";
	import { FULLSCREEN_PARAM, fullscreenId } from "$lib/layout/fullscreen";
	import { m } from "$lib/paraglide/messages.js";
	import { STARTER_ID } from "$lib/starter/starter";
	import { currentDashboardName, homeTarget, useApp } from "$lib/store/app.svelte";
	import type { DocumentSession } from "$lib/store/document-session.svelte";
	import { navigate, route } from "../router";

	const app = useApp();
	const name = $derived(currentDashboardName(app));
	/** The starter's session while it's shown here. */
	let starter: DocumentSession | null = null;

	// `/` shows the starter in place, or moves on to the dashboard it resolves to. Runs again
	// after the data is cleared while `/` is showing.
	$effect(() => {
		void app.resetCount;
		return untrack(() => {
			// Until the target resolves, nothing is current: undo must not reach the last page's dashboard.
			app.current = { session: null, isStarter: false };
			starter = null;
			let active = true;
			void (async () => {
				const target = await homeTarget(app);
				if (!active) return;
				if (target.kind === "dashboard") {
					// `widget` belongs to the starter, so it isn't carried over.
					await navigate("/dashboards/:id", { params: { id: target.id }, replace: true });
					return;
				}
				const session = await app.sessions.get(STARTER_ID);
				if (!active) return;
				starter = session;
				app.current = { session, isStarter: true };
				// Edits a starter page left mid-hand-off (it went away) are handed off now.
				void session?.replayPending();
			})();
			return () => {
				active = false;
			};
		});
	});

	// The starter's first edit made a copy and made it current: show it at its own URL.
	$effect(() => {
		const { session, isStarter } = app.current;
		if (!starter || isStarter || !session || session === starter) return;
		if (session.doc.copiedFrom !== STARTER_ID) return;
		starter = null;
		// Fullscreen stays open on the copy (a starter widget keeps its id there), and so does the
		// entry's state, so exiting still goes back if this page pushed the entry.
		const widget = fullscreenId(location.search);
		// A plain copy: history entries can't hold the router's reactive state.
		const state = untrack(() => $state.snapshot(route.state));
		void navigate("/dashboards/:id", {
			params: { id: session.doc.id },
			replace: true,
			scrollToTop: false,
			...(widget ? { search: { [FULLSCREEN_PARAM]: widget }, state } : {})
		});
		toast(m.starter_copied());
	});

	$effect(() => {
		if (name) document.title = m.page_title({ name });
	});
</script>

{#if name}
	<h1 class="sr-only">{name}</h1>
{/if}
<DashboardGrid />
