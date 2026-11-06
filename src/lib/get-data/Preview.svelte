<script module lang="ts">
	export type PreviewSize = "large" | "dashboard";
</script>

<script lang="ts">
	import { setContext } from "svelte";
	import { ToggleGroup } from "bits-ui";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { GRID_COLUMNS } from "$lib/layout/config";
	import { m } from "$lib/paraglide/messages.js";
	import {
		getWidgetType,
		loadWidget,
		loadedWidget,
		type WidgetModule
	} from "$lib/widgets/registry";
	import WidgetSkeleton from "$lib/widgets/shared/WidgetSkeleton.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "$lib/widgets/shared/viewer";

	let {
		widget,
		title,
		size,
		gridWidth,
		phone,
		onsize
	}: {
		/** A view-only widget: it's in no dashboard, so nothing in it edits. */
		widget: WidgetInstance;
		title: string;
		size: PreviewSize;
		/** The dashboard grid's width at this viewport, in px. */
		gridWidth: number;
		/** The dashboard is one column on phones. */
		phone: boolean;
		onsize: (size: PreviewSize) => void;
	} = $props();

	// The draft's own places are the owner's: "your location", not "shared location".
	setContext<PlaceViewer>(PLACE_VIEWER_KEY, "owner");

	const uid = $props.id();
	const type = $derived(getWidgetType(widget.type));

	/** The size the widget lands at: its rect in the grid's columns and rows. */
	const dashboardStyle = $derived.by(() => {
		const { w, h } = widget.rect;
		const height = `calc(var(--grid-row-height) * ${h} + var(--grid-gap) * ${h - 1})`;
		if (phone) return `width: 100%; height: ${height};`;
		const column = `((${gridWidth}px - var(--grid-gap) * ${GRID_COLUMNS - 1}) / ${GRID_COLUMNS})`;
		return `width: calc(${column} * ${w} + var(--grid-gap) * ${w - 1}); height: ${height};`;
	});
</script>

<section class="flex min-w-0 flex-col gap-2" aria-labelledby="{uid}-heading">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 id="{uid}-heading" class="text-primary text-sm font-semibold">{m.get_data_preview()}</h2>
		<ToggleGroup.Root
			type="single"
			value={size}
			onValueChange={(v) => v && onsize(v as PreviewSize)}
			aria-label={m.get_data_preview_size()}
			class="border-input inline-flex rounded-(--radius-control) border p-0.5"
		>
			<ToggleGroup.Item
				value="large"
				class="data-[state=on]:bg-secondary hover:bg-secondary flex h-7 items-center rounded-(--radius-sm) px-2.5 text-sm font-medium data-[state=on]:font-semibold"
			>
				{m.get_data_preview_large()}
			</ToggleGroup.Item>
			<ToggleGroup.Item
				value="dashboard"
				class="data-[state=on]:bg-secondary hover:bg-secondary flex h-7 items-center rounded-(--radius-sm) px-2.5 text-sm font-medium data-[state=on]:font-semibold"
			>
				{m.get_data_preview_dashboard()}
			</ToggleGroup.Item>
		</ToggleGroup.Root>
	</div>
	<div
		class={[
			"bg-card border-card-border shadow-card flex max-w-full flex-col overflow-hidden rounded-lg border",
			size === "large" && "h-[min(36rem,70dvh)] min-h-80 w-full"
		]}
		style={size === "dashboard" ? dashboardStyle : undefined}
		data-testid="get-data-preview"
	>
		<h3
			class="border-card-border truncate border-b px-(--card-padding) py-1.5 text-sm font-semibold"
		>
			{title}
		</h3>
		<div class="relative min-h-0 flex-1 p-(--card-padding)">
			{#snippet body(mod: WidgetModule)}
				<mod.component {widget} />
			{/snippet}
			{#if type}
				{#key type}
					{@const loaded = loadedWidget(type)}
					{#if loaded}
						{@render body(loaded)}
					{:else}
						{#await loadWidget(type)}
							<WidgetSkeleton />
						{:then mod}
							{@render body(mod)}
						{:catch}
							<p class="text-muted-foreground flex h-full items-center justify-center text-sm">
								{m.widget_load_failed()}
							</p>
						{/await}
					{/if}
				{/key}
			{/if}
		</div>
	</div>
</section>
