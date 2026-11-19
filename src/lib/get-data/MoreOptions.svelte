<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Collapsible } from "bits-ui";
	import type { Snippet } from "svelte";
	import { m } from "$lib/paraglide/messages.js";

	let { children }: { children: Snippet } = $props();
</script>

<!-- Collapsed by default: the teacher never needs it. -->
<Collapsible.Root class="flex flex-col gap-2">
	<h2>
		<Collapsible.Trigger
			class="hover:bg-secondary text-primary flex min-h-8 w-full items-center gap-2 rounded-(--radius-control) px-1 text-left text-sm font-semibold [&[data-state=open]>svg]:rotate-180"
		>
			<span class="flex-1">{m.get_data_more_options()}</span>
			<ChevronDownIcon
				class="text-muted-foreground duration-fast ease-standard size-4 transition-transform"
				aria-hidden="true"
			/>
		</Collapsible.Trigger>
	</h2>
	<Collapsible.Content class="flex flex-col gap-3">
		{@render children()}
	</Collapsible.Content>
</Collapsible.Root>
