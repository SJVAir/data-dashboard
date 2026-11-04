<script lang="ts">
	import { Dialog as DialogPrimitive } from "bits-ui";
	import XIcon from "@lucide/svelte/icons/x";
	import LiveRegion from "$lib/components/a11y/LiveRegion.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";
	import * as Dialog from "./index.js";
	import DialogPortal from "./dialog-portal.svelte";
	import type { Snippet } from "svelte";
	import type { ComponentProps } from "svelte";

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		showCloseButton = true,
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: WithoutChildrenOrChild<ComponentProps<typeof DialogPortal>>;
		children: Snippet;
		showCloseButton?: boolean;
	} = $props();

	// Whether the dialog is open, from bits-ui's `data-state`: it turns "closed" as soon as the
	// dialog starts closing, while the content stays on screen for its close animation.
	let open = $state(true);
	$effect(() => {
		const node = ref;
		if (!node) return;
		const update = () => (open = node.getAttribute("data-state") !== "closed");
		update();
		const observer = new MutationObserver(update);
		observer.observe(node, { attributes: true, attributeFilter: ["data-state"] });
		return () => observer.disconnect();
	});
</script>

<DialogPortal {...portalProps}>
	<Dialog.Overlay />
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			"bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 border-card-border shadow-card duration-fast ease-standard fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%_-_2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border p-4 text-sm outline-none sm:max-w-sm",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		<!-- The page's live region is cut off while this modal is open; announcements come here. -->
		<LiveRegion layer="dialog" {open} />
		{#if showCloseButton}
			<DialogPrimitive.Close data-slot="dialog-close">
				{#snippet child({ props })}
					<Button variant="ghost" class="absolute top-2 right-2" size="icon-sm" {...props}>
						<XIcon />
						<span class="sr-only">Close</span>
					</Button>
				{/snippet}
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</DialogPortal>
