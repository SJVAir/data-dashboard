<script lang="ts">
	import { Slider as SliderPrimitive } from "bits-ui";
	import { cn, type WithoutChildrenOrChild } from "$lib/utils.js";

	// A single-value slider (shadcn-svelte's Slider, trimmed to the one-thumb case). `thumbProps`
	// carries the thumb's own attributes (the thumb is the element with role "slider").
	let {
		ref = $bindable(null),
		value = $bindable(0),
		class: className,
		thumbProps = {},
		...restProps
	}: WithoutChildrenOrChild<
		Omit<SliderPrimitive.RootProps, "type" | "value" | "onValueChange" | "onValueCommit">
	> & {
		value?: number;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
		thumbProps?: Record<string, unknown>;
	} = $props();
</script>

<SliderPrimitive.Root
	bind:ref
	bind:value
	type="single"
	data-slot="slider"
	class={cn(
		"relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50",
		className
	)}
	{...restProps}
>
	<span
		data-slot="slider-track"
		class="bg-muted relative h-1.5 w-full grow overflow-hidden rounded-full"
	>
		<SliderPrimitive.Range data-slot="slider-range" class="bg-primary absolute h-full" />
	</span>
	<!-- No focus or hover ring of its own: the app's one focus indicator (app.css) applies, and
	     hover only tints the thumb, so focus never looks like hover. -->
	<SliderPrimitive.Thumb
		index={0}
		data-slot="slider-thumb"
		class="border-primary bg-background hover:bg-accent duration-fast ease-standard block size-4 shrink-0 rounded-full border shadow-sm transition-[color,background-color,box-shadow] disabled:pointer-events-none disabled:opacity-50"
		{...thumbProps}
	/>
</SliderPrimitive.Root>
