<script lang="ts">
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import type { Snippet } from "svelte";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as Popover from "$lib/components/ui/popover";
	import { cn } from "$lib/utils";

	/**
	 * A type's own settings (e.g. "Chart options"), beside Show as: a button that opens them in a
	 * panel floating over the preview, so the preview doesn't move. Esc, a click outside or Tab past
	 * its last control closes it. The panel follows the button in the page (not portalled), so Tab
	 * moves on from it to what comes next. On a phone it takes the screen's width less its margins.
	 */
	let {
		label,
		open = $bindable(false),
		children
	}: { label: string; open?: boolean; children: Snippet } = $props();

	/**
	 * Closed with Esc: focus goes back to the button. Closed by a click or Tab elsewhere, focus
	 * stays where the person put it (a non-modal panel: focus isn't trapped in it).
	 */
	let byEscape = false;
	function onCloseAutoFocus(e: Event): void {
		if (!byEscape) e.preventDefault();
		byEscape = false;
	}
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
		trapFocus={false}
		onEscapeKeydown={() => (byEscape = true)}
		onFocusOutside={() => (open = false)}
		{onCloseAutoFocus}
		portalProps={{ disabled: true }}
		role="dialog"
		aria-label={label}
		class="max-h-(--bits-popover-content-available-height) w-[calc(100vw-1rem)] overflow-y-auto motion-reduce:animate-none sm:w-80"
	>
		{@render children()}
	</Popover.Content>
</Popover.Root>
