<script lang="ts" module>
	import type { LocationGroup } from "$lib/data/metadata";
	import type { RegionTypeInfo } from "$lib/places/types";
	import { goneTypes } from "./what-sections";

	/**
	 * Whether the Map's options have anything to show: a location group, a dropped type, a fill type
	 * to offer, or a saved fill (its None stays, so it can be removed when no type is offered).
	 */
	export function hasMapOptions(
		groups: LocationGroup[] | undefined,
		ticked: readonly string[],
		fillTypes: RegionTypeInfo[] | undefined,
		fill: string | undefined
	): boolean {
		return (
			(groups?.length ?? 0) > 0 ||
			(groups !== undefined && goneTypes(groups, ticked).length > 0) ||
			(fillTypes?.length ?? 0) > 0 ||
			fill !== undefined
		);
	}
</script>

<script lang="ts">
	import { m } from "$lib/paraglide/messages.js";
	import { toggledLocationTypes } from "./what-sections";

	/**
	 * The Map's own settings, in its options panel: Points of interest (a group of checkboxes per
	 * location group, from the regions meta, and the saved types no group lists any more) and Fill
	 * regions by. Plain headings, no accordions.
	 */
	let {
		groups,
		ticked,
		onlocations,
		fill,
		fillTypes,
		onfill
	}: {
		/** The location groups (the meta's, by order); undefined while loading or when they failed. */
		groups: LocationGroup[] | undefined;
		/** The locations layer's ticked types (saved order). */
		ticked: readonly string[];
		/** The ticked location types after a change (in the meta's order; `[]`: none). */
		onlocations: (types: string[]) => void;
		/** The region type saved as the fill (missing: none). */
		fill: string | undefined;
		/** The types the directory offers; undefined while loading or when it failed. */
		fillTypes: RegionTypeInfo[] | undefined;
		/** A fill chosen (a region type), or none (undefined). */
		onfill: (type: string | undefined) => void;
	} = $props();

	const uid = $props.id();

	/** Saved, but no group lists them any more (only once the groups are known). */
	const gone = $derived(groups ? goneTypes(groups, ticked) : []);
	const fillChoices = $derived(fillTypes ?? []);
	/** The saved fill, only while it's offered (else None shows; the saved value stays). */
	const fillShown = $derived(fillChoices.find((t) => t.type === fill));

	function tick(locationType: string, on: boolean): void {
		onlocations(toggledLocationTypes(groups ?? [], ticked, locationType, on));
	}
</script>

<div class="flex flex-col gap-3">
	{#if (groups?.length ?? 0) > 0 || gone.length > 0}
		<section class="flex flex-col gap-2" aria-labelledby="{uid}-points">
			<h3 id="{uid}-points" class="text-primary text-sm font-semibold">
				{m.getdata_map_points_of_interest()}
			</h3>
			{#each groups ?? [] as group (group.key)}
				<fieldset class="flex flex-col gap-1">
					<legend class="mb-1 text-sm font-medium">{group.label}</legend>
					{#each group.types as locationType (locationType.type)}
						<label class="flex min-h-6 items-center gap-2 text-sm">
							<input
								type="checkbox"
								class="accent-primary size-4"
								checked={ticked.includes(locationType.type)}
								onchange={(e) => tick(locationType.type, e.currentTarget.checked)}
							/>
							<span>{locationType.label}</span>
						</label>
					{/each}
				</fieldset>
			{/each}
			{#if gone.length > 0}
				<fieldset class="flex flex-col gap-1">
					<legend class="mb-1 text-sm font-medium">{m.getdata_map_locations_gone()}</legend>
					{#each gone as id (id)}
						{@const reasonId = `${uid}-location-gone-${id}`}
						<!-- Saved, but no meta group lists it any more: greyed with why, still untickable. -->
						<div class="flex min-h-6 flex-wrap items-center gap-x-2 text-sm">
							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									class="accent-primary size-4"
									checked={ticked.includes(id)}
									aria-describedby={reasonId}
									onchange={(e) => tick(id, e.currentTarget.checked)}
								/>
								<span class="text-muted-foreground">{id}</span>
							</label>
							<span id={reasonId} class="text-muted-foreground text-xs">
								{m.getdata_map_location_type_gone()}
							</span>
						</div>
					{/each}
				</fieldset>
			{/if}
		</section>
	{/if}
	{#if fillChoices.length > 0 || fill !== undefined}
		<fieldset class="flex flex-col gap-1">
			<legend class="mb-1">
				<h3 class="text-primary text-sm font-semibold">{m.getdata_map_fill()}</h3>
			</legend>
			<label class="flex min-h-6 items-center gap-2 text-sm">
				<input
					type="radio"
					name="{uid}-fill"
					class="accent-primary size-4"
					checked={!fillShown}
					onchange={() => onfill(undefined)}
				/>
				<span>{m.getdata_map_fill_none()}</span>
			</label>
			{#each fillChoices as choice (choice.type)}
				<label class="flex min-h-6 items-center gap-2 text-sm">
					<input
						type="radio"
						name="{uid}-fill"
						class="accent-primary size-4"
						checked={fillShown?.type === choice.type}
						onchange={() => onfill(choice.type)}
					/>
					<span>{choice.plural}</span>
				</label>
			{/each}
		</fieldset>
	{/if}
</div>
