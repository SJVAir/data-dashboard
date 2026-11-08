<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { m } from "$lib/paraglide/messages.js";

	let {
		label,
		duration,
		sentences
	}: { label: string; duration: string | null; sentences: string[] } = $props();

	// Open or closed is per tile and not saved.
	let open = $state(false);
	const id = $props.id();
</script>

<li data-activity class="border-border border-b py-1 last:border-b-0">
	<button
		type="button"
		aria-expanded={open}
		aria-controls="{id}-text"
		class="hover:bg-muted focus-visible:ring-ring flex w-full items-start gap-2 rounded-(--radius-control) px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
		onclick={() => (open = !open)}
	>
		<ChevronDown
			class={["mt-0.5 size-4 shrink-0 transition-transform", open && "rotate-180"]}
			aria-hidden="true"
		/>
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="flex flex-wrap items-baseline gap-x-2">
				<span class="text-sm font-semibold">{label}</span>
				{#if duration}<span class="text-muted-foreground text-xs">{duration}</span>{/if}
			</span>
			{#if !open}
				<span id="{id}-text" class="text-muted-foreground block truncate text-sm">
					{sentences[0] ?? m.outside_no_guidance()}
				</span>
			{/if}
		</span>
	</button>
	{#if open}
		<div id="{id}-text" class="px-2 pb-1 pl-8 text-sm">
			{#if sentences.length}
				{#each sentences as sentence, i (i)}
					<p>{sentence}</p>
				{/each}
			{:else}
				<p class="text-muted-foreground">{m.outside_no_guidance()}</p>
			{/if}
		</div>
	{/if}
</li>
