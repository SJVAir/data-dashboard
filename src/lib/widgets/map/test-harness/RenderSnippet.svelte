<script lang="ts">
	import type { Snippet } from "svelte";
	import type { CardContext } from "@sjvair/map-sdk";

	// Renders a plugin's tooltip snippet, as map-sdk's card does; with `card`, a card actions
	// snippet, as map-sdk renders MapView's `card.actions` for it.
	let { snippet, card }: { snippet: Snippet | Snippet<[CardContext]>; card?: CardContext } =
		$props();
</script>

{#if card}
	{@render (snippet as Snippet<[CardContext]>)(card)}
{:else}
	{@render (snippet as Snippet)()}
{/if}
