<script lang="ts">
	import { untrack } from "svelte";
	import DashboardGrid from "$lib/components/dashboard/DashboardGrid.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { STARTER_ID } from "$lib/starter/starter";
	import { currentDashboardName, useApp } from "$lib/store/app.svelte";
	import { navigate, p, route } from "../router";

	const app = useApp();
	/** The id isn't stored in this space (or was deleted). */
	let missing = $state(false);
	const name = $derived(missing ? null : currentDashboardName(app));

	$effect(() => {
		const id = route.params.id;
		if (!id) return;
		// The starter lives at `/`, where its first edit is handled.
		if (id === STARTER_ID) {
			void navigate("/", { replace: true });
			return;
		}
		let active = true;
		missing = false;
		// Already current after the starter's hand-off to its copy: keep it, no flicker.
		if (untrack(() => app.current.session?.doc.id) !== id) {
			app.current = { session: null, isStarter: false };
		}
		void app.sessions.get(id).then((session) => {
			if (!active) return;
			// A soft-deleted dashboard is gone until its delete is undone.
			const deleted = typeof session?.doc.deletedAt === "string";
			missing = session === null || deleted;
			app.current = { session: deleted ? null : session, isStarter: false };
		});
		return () => {
			active = false;
		};
	});

	$effect(() => {
		if (missing) document.title = m.page_title_not_here();
		else if (name) document.title = m.page_title({ name });
	});
</script>

{#if missing}
	<div class="flex flex-col items-start gap-2 p-4">
		<h1 class="text-lg font-medium">{m.dashboard_not_here()}</h1>
		<a href={p("/dashboards")} class="text-primary underline underline-offset-4">
			{m.your_dashboards()}
		</a>
	</div>
{:else}
	{#if name}
		<h1 class="sr-only">{name}</h1>
	{/if}
	<DashboardGrid />
{/if}
