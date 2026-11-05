<script lang="ts">
	import { BitsConfig, Portal } from "bits-ui";
	import { useApp } from "$lib/store/app.svelte";
	import { loadDialog, requested, type LazyDialog } from "./lazy.svelte";

	const app = useApp();
	const DIALOGS: LazyDialog[] = [
		"share",
		"restoreVersion",
		"clearData",
		"privacy",
		"existingCopy",
		"moveToAccount",
		"placePicker"
	];

	/** Opened at least once; Move to account is asked once the app starts in an account space. */
	function wanted(key: LazyDialog): boolean {
		return key === "moveToAccount" ? app.space !== "anonymous" : requested[key];
	}

	// The dialogs kept out of the initial bundle (see `lazy.svelte.ts`): each loads on its first
	// opening, opens as it mounts, and then stays mounted. Dialogs stack in the order their layers
	// join the page, so a dialog loaded later would cover one mounted after this component (a
	// confirm asked over the Share dialog). They render into this layer instead, which joins the
	// page when this component mounts.
	let layer = $state<HTMLElement | null>(null);
</script>

<Portal>
	<div bind:this={layer} data-slot="dialog-layer"></div>
</Portal>
{#if layer}
	<BitsConfig defaultPortalTo={layer}>
		{#each DIALOGS as key (key)}
			{#if wanted(key)}
				{#await loadDialog(key) then Dialog}
					<Dialog />
				{:catch}
					<!-- `loadDialog` offered a reload and undid the request. -->
				{/await}
			{/if}
		{/each}
	</BitsConfig>
{/if}
