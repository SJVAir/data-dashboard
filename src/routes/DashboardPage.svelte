<script lang="ts">
	import { untrack } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { currentDashboardName, useApp } from "$lib/store/app.svelte";
	import { route } from "../router";

	const app = useApp();
	/** The id isn't stored in this space. */
	let missing = $state(false);
	const name = $derived(missing ? null : currentDashboardName(app));

	$effect(() => {
		const id = route.params.id;
		if (!id) return;
		let active = true;
		missing = false;
		// Already current after the starter's hand-off to its copy: keep it, no flicker.
		if (untrack(() => app.current.session?.doc.id) !== id) {
			app.current = { session: null, isStarter: false };
		}
		void app.sessions.get(id).then((session) => {
			if (!active) return;
			missing = session === null;
			app.current = { session, isStarter: false };
		});
		return () => {
			active = false;
		};
	});

	$effect(() => {
		if (name) document.title = m.page_title({ name });
	});
</script>

<!-- Task 16 renders the dashboard here, and the message for an unknown id. -->
{#if name}
	<h1 class="sr-only">{name}</h1>
{/if}
