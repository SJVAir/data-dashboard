<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import DashboardGrid from "$lib/components/dashboard/DashboardGrid.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { STARTER_ID } from "$lib/starter/starter";
	import { currentDashboardName, homeTarget, useApp } from "$lib/store/app.svelte";
	import type { DocumentSession } from "$lib/store/document-session.svelte";
	import { navigate } from "../router";

	const app = useApp();
	const name = $derived(currentDashboardName(app));
	/** The starter's session while it's shown here. */
	let starter: DocumentSession | null = null;

	// `/` shows the starter in place, or moves on to the dashboard it resolves to.
	onMount(() => {
		// Until the target resolves, nothing is current: undo must not reach the last page's dashboard.
		app.current = { session: null, isStarter: false };
		let active = true;
		void (async () => {
			const target = await homeTarget(app);
			if (!active) return;
			if (target.kind === "dashboard") {
				await navigate("/dashboards/:id", { params: { id: target.id }, replace: true });
				return;
			}
			const session = await app.sessions.get(STARTER_ID);
			if (!active) return;
			starter = session;
			app.current = { session, isStarter: true };
		})();
		return () => {
			active = false;
		};
	});

	// The starter's first edit made a copy and made it current: show it at its own URL.
	$effect(() => {
		const { session, isStarter } = app.current;
		if (!starter || isStarter || !session || session === starter) return;
		if (session.doc.copiedFrom !== STARTER_ID) return;
		starter = null;
		void navigate("/dashboards/:id", { params: { id: session.doc.id }, replace: true });
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
