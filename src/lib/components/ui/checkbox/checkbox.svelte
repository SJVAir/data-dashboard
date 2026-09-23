<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from "bits-ui";
	import CheckIcon from "@lucide/svelte/icons/check";
	import { cn, type WithoutChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		class: className,
		...restProps
	}: WithoutChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
	bind:ref
	bind:checked
	data-slot="checkbox"
	class={cn(
		"border-input data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground flex size-4 shrink-0 items-center justify-center rounded border",
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		{#if checked}
			<CheckIcon class="size-3" />
		{/if}
	{/snippet}
</CheckboxPrimitive.Root>
