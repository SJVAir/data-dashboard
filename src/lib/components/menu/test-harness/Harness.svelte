<script lang="ts">
	import { menuScope } from "$lib/actions/scope";
	import type { MenuItem } from "$lib/actions/types";
	import ContextMenuHost from "../ContextMenuHost.svelte";
	import { openMenuFor } from "../menu-state.svelte";

	let {
		outer,
		inner,
		payload = {}
	}: { outer: MenuItem[]; inner: MenuItem[]; payload?: Record<string, unknown> } = $props();
	let more = $state<HTMLButtonElement>();
</script>

<ContextMenuHost>
	<div {@attach menuScope(() => outer)} data-testid="outer">
		<div {@attach menuScope(() => inner)} data-testid="inner">
			<button data-testid="focusable">Focus me</button>
		</div>
		<button bind:this={more} onclick={() => more && openMenuFor(more, payload)}>More</button>
	</div>
</ContextMenuHost>
