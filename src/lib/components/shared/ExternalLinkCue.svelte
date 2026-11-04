<script lang="ts">
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import { m } from "$lib/paraglide/messages.js";

	// Goes inside every link that opens in a new tab: an icon for sight, words for screen readers.
	let { class: className = "" }: { class?: string } = $props();
</script>

<!-- The space between the two keeps the words apart in the link's name. -->
<ExternalLink aria-hidden="true" class={className} />
<span class="sr-only">{m.opens_in_new_tab()}</span>
