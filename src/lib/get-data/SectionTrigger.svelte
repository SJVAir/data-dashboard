<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Accordion } from "bits-ui";

	let {
		label,
		detail,
		reasonId
	}: {
		/** The section's name. */
		label: string;
		/** What's chosen in it, shown under the name (none when empty). */
		detail?: string;
		/** A greyed-out section (its item disabled): the id of the text saying why. */
		reasonId?: string;
	} = $props();
</script>

<Accordion.Header level={3}>
	<Accordion.Trigger
		aria-describedby={reasonId}
		class="enabled:hover:bg-secondary disabled:text-muted-foreground flex min-h-8 w-full items-center gap-2 rounded-(--radius-control) px-2 py-1 text-left text-sm font-medium [&[data-state=open]>svg]:rotate-180"
	>
		<span class="flex min-w-0 flex-1 flex-col">
			<span>{label}</span>
			{#if detail}
				<span class="text-muted-foreground text-xs font-normal">{detail}</span>
			{/if}
		</span>
		{#if !reasonId}
			<ChevronDownIcon
				class="text-muted-foreground duration-fast ease-standard size-4 shrink-0 transition-transform"
				aria-hidden="true"
			/>
		{/if}
	</Accordion.Trigger>
</Accordion.Header>
