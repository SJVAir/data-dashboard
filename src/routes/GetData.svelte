<script lang="ts">
	import { onMount } from "svelte";
	import { loadDraft, type Draft } from "$lib/get-data/draft.svelte";
	import GetDataView from "$lib/get-data/GetDataView.svelte";
	import { parseGetDataMode } from "$lib/get-data/mode";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { navigate, route } from "../router";

	const app = useApp();
	// No dashboard is open here: undo, redo and the preview's widget actions never reach one (as
	// on the dashboards list).
	app.current = { session: null, isStarter: false };

	const mode = $derived(parseGetDataMode(route.params));
	let heading = $state<HTMLElement>();
	let initial = $state.raw<Draft | null>(null);

	// Arriving on the page puts focus on its heading (as the dashboard list does).
	onMount(() => heading?.focus());

	$effect(() => {
		// Edit data starts from the widget (wired with Save changes).
		if (mode.kind !== "new") return;
		const search = route.search as Record<string, unknown>;
		const type = typeof search.type === "string" ? search.type : undefined;
		let active = true;
		void loadDraft(app.platform, app.space, type).then((d) => {
			if (active) initial = d;
		});
		return () => {
			active = false;
		};
	});

	function cancel(): void {
		if (history.length > 1) history.back();
		else void navigate("/");
	}
</script>

<div class="flex min-h-full flex-col">
	<h1
		bind:this={heading}
		id="get-data-heading"
		tabindex="-1"
		class="text-primary px-(--grid-gap) pt-(--grid-gap) text-lg font-semibold outline-none"
	>
		{mode.kind === "edit" ? m.edit_data_heading() : m.get_data_heading()}
	</h1>
	{#if initial}
		<GetDataView {mode} {initial} onCancel={cancel} />
	{/if}
</div>
