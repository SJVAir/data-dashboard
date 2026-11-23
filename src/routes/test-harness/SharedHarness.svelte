<script lang="ts">
	import { setContext } from "svelte";
	import { Router } from "sv-router";
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import ExistingCopyDialog from "$lib/components/dialogs/ExistingCopyDialog.svelte";
	import NotificationsDialog from "$lib/components/dialogs/NotificationsDialog.svelte";
	import UndoRedo from "$lib/components/shell/UndoRedo.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import {
		TILE_OPTIONS_PROBE_KEY,
		type TileOptionsContext
	} from "$lib/widgets/shared/tile-options.svelte";
	import "../../router";
	import SharedPage from "../SharedPage.svelte";

	/** `routed`: through the app's router (it listens for Back), as the real page is. */
	/** `onTileOptions`: handed the grid's tile-options context (to change a tile as a widget does). */
	let {
		routed = false,
		onTileOptions
	}: { routed?: boolean; onTileOptions?: (ctx: TileOptionsContext) => void } = $props();
	setContext(TILE_OPTIONS_PROBE_KEY, (ctx: TileOptionsContext) => onTileOptions?.(ctx));
</script>

<UndoRedo />
<main>
	{#if routed}
		<Router />
	{:else}
		<SharedPage />
	{/if}
</main>
<ExistingCopyDialog />
<NotificationsDialog />
<Toaster />
<LiveRegion />
