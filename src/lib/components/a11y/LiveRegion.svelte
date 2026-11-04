<script lang="ts">
	import { onDestroy } from "svelte";
	import { announcer, PAGE_REGION, registerDialogRegion } from "$lib/a11y/announcer.svelte";

	// "page": the page's one region (mounted once, in App). "dialog": an open dialog's own region,
	// in its content, since a modal dialog hides the page's region from screen readers. `open`
	// (dialog layer only) turns false when the dialog starts closing, before it unmounts.
	let { layer = "page", open = true }: { layer?: "page" | "dialog"; open?: boolean } = $props();

	// The layer is fixed for the region's life.
	// svelte-ignore state_referenced_locally
	const region = layer === "dialog" ? registerDialogRegion() : null;
	const id = region?.id ?? PAGE_REGION;
	$effect(() => region?.setOpen(open));
	onDestroy(() => region?.release());
</script>

<!-- Text goes through `announce`, which picks the topmost region. -->
<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">
	{announcer.textFor(id)}
</div>
