<script lang="ts">
	import { onMount } from "svelte";
	import { parseGetDataMode } from "$lib/get-data/mode";
	import { m } from "$lib/paraglide/messages.js";
	import { route } from "../router";

	const mode = $derived(parseGetDataMode(route.params));
	let heading = $state<HTMLElement>();

	// Arriving on the page puts focus on its heading (as the dashboard list does).
	onMount(() => heading?.focus());
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-4 p-4">
	<h1
		bind:this={heading}
		id="get-data-heading"
		tabindex="-1"
		class="text-primary text-lg font-semibold outline-none"
	>
		{mode.kind === "edit" ? m.edit_data_heading() : m.get_data_heading()}
	</h1>
</div>
