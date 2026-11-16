<script lang="ts">
	import { RadioGroup as RadioGroupPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<RadioGroupPrimitive.ItemProps> = $props();
</script>

<RadioGroupPrimitive.Item
	bind:ref
	data-slot="radio-group-item"
	class={cn(
		"border-input text-primary aria-invalid:border-destructive dark:bg-input/30 duration-fast ease-standard data-[state=checked]:border-primary relative flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
	{...restProps}
>
	{#snippet children({ checked })}
		{#if checked}
			<span data-slot="radio-group-indicator" class="bg-primary size-2 rounded-full"></span>
		{/if}
	{/snippet}
</RadioGroupPrimitive.Item>
