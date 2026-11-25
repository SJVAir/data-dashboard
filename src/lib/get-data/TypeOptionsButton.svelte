<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import type { Snippet } from "svelte";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as Popover from "$lib/components/ui/popover";
	import { cn } from "$lib/utils";

	/**
	 * A type's own settings (e.g. "Chart options"), beside Show as: a button that opens them in a
	 * panel floating over the preview, so the preview doesn't move. Esc or a click outside closes
	 * it and focus returns to the button.
	 */
	let {
		label,
		open = $bindable(false),
		children
	}: { label: string; open?: boolean; children: Snippet } = $props();
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={cn(
			buttonVariants({ variant: "outline", size: "sm" }),
			"[&[data-state=open]>svg]:rotate-180"
		)}
	>
		{label}
		<ChevronDown
			aria-hidden="true"
			class="duration-fast ease-standard transition-transform motion-reduce:transition-none"
		/>
	</Popover.Trigger>
	<Popover.Content
		align="end"
		collisionPadding={8}
		role="dialog"
		aria-label={label}
		class="max-h-(--bits-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] overflow-y-auto motion-reduce:animate-none"
	>
		{@render children()}
	</Popover.Content>
</Popover.Root>
