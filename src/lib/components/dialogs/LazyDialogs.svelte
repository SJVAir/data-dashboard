<script lang="ts">
	import { BitsConfig, Portal } from "bits-ui";
	import { useApp } from "$lib/store/app.svelte";
	import { requested } from "./lazy.svelte";

	const app = useApp();

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
		{#if requested.share}
			{#await import("./ShareDialog.svelte") then { default: ShareDialog }}
				<ShareDialog />
			{/await}
		{/if}
		{#if requested.restoreVersion}
			{#await import("./RestoreVersionDialog.svelte") then { default: RestoreVersionDialog }}
				<RestoreVersionDialog />
			{/await}
		{/if}
		{#if requested.clearData}
			{#await import("./ClearDataDialog.svelte") then { default: ClearDataDialog }}
				<ClearDataDialog />
			{/await}
		{/if}
		{#if requested.privacy}
			{#await import("./PrivacyDialog.svelte") then { default: PrivacyDialog }}
				<PrivacyDialog />
			{/await}
		{/if}
		{#if requested.existingCopy}
			{#await import("./ExistingCopyDialog.svelte") then { default: ExistingCopyDialog }}
				<ExistingCopyDialog />
			{/await}
		{/if}
		<!-- Asked once the app starts in an account space. -->
		{#if app.space !== "anonymous"}
			{#await import("./MoveToAccountDialog.svelte") then { default: MoveToAccountDialog }}
				<MoveToAccountDialog />
			{/await}
		{/if}
	</BitsConfig>
{/if}
