<script lang="ts">
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Accordion } from "bits-ui";

	let {
		label,
		detail,
		reasonId,
		level = 3,
		warning
	}: {
		/** The section's name. */
		label: string;
		/** What's chosen in it, shown under the name (none when empty). */
		detail?: string;
		/** A greyed-out section (its item disabled): the id of the text saying why. */
		reasonId?: string;
		/** The heading level (3 inside a section group, 2 for a section of its own). */
		level?: 2 | 3;
		/** A problem with the choice, shown under it in the destructive colour. */
		warning?: string;
	} = $props();
</script>

<Accordion.Header {level}>
	<Accordion.Trigger
		aria-describedby={reasonId}
		class="enabled:hover:bg-secondary disabled:text-muted-foreground flex min-h-8 w-full items-center gap-2 rounded-(--radius-control) px-2 py-1 text-left text-sm font-medium [&[data-state=open]>svg]:rotate-180"
	>
		<span class="flex min-w-0 flex-1 flex-col">
			<span>{label}</span>
			{#if detail}
				<span class="text-muted-foreground text-xs font-normal">{detail}</span>
			{/if}
			{#if warning}
				<span class="text-destructive text-xs font-normal">{warning}</span>
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
