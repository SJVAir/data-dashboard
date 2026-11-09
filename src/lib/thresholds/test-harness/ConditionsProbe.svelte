<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import { CurrentConditions } from "$lib/widgets/shared/current.svelte";

	let {
		widget,
		polling,
		onready
	}: {
		widget: WidgetInstance;
		polling?: () => boolean;
		/** Given the instance once it's made, to read in the test. */
		onready: (current: CurrentConditions) => void;
	} = $props();

	// The props are fixed for a probe's life.
	// svelte-ignore state_referenced_locally
	const current = new CurrentConditions(() => widget, polling ? { polling } : undefined);
	// svelte-ignore state_referenced_locally
	onready(current);
</script>

<!-- Read reactively (as the tiles do), so a value that never updates shows here. -->
<p data-probe-meta>{current.meta?.entryType.label ?? ""}</p>
