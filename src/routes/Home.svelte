<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { STARTER_ID } from "$lib/starter/starter";
	import { currentDashboardName, homeTarget, useApp } from "$lib/store/app.svelte";
	import { navigate } from "../router";

	const app = useApp();
	const name = $derived(currentDashboardName(app));

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
			if (active) app.current = { session, isStarter: true };
		})();
		return () => {
			active = false;
		};
	});

	$effect(() => {
		if (name) document.title = m.page_title({ name });
	});
</script>

<!-- Task 16 renders the dashboard (the starter's grid and hint) here. -->
{#if name}
	<h1 class="sr-only">{name}</h1>
{/if}
