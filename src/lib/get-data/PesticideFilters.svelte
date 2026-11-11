<script lang="ts">
	import type { PesticidesMeta } from "@sjvair/sdk/pesticides";
	import { filterLabels, pesticideMeta } from "./sources";
	import { LIMITS, type PesticideFilters } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import SearchPicker from "./SearchPicker.svelte";

	let {
		filters,
		onchange
	}: {
		/** The layer's saved filters. */
		filters: PesticideFilters | undefined;
		/** The whole new set (empty ones are dropped by the caller). */
		onchange: (filters: PesticideFilters) => void;
	} = $props();

	const uid = $props.id();

	let meta = $state.raw<PesticidesMeta | "unavailable" | undefined>();
	$effect(() => {
		const controller = new AbortController();
		pesticideMeta(controller.signal).then(
			(found) => (meta = found),
			() => {
				if (!controller.signal.aborted) meta = "unavailable";
			}
		);
		return () => controller.abort();
	});
	const known = $derived(meta && meta !== "unavailable" ? meta : undefined);

	type Named = "chemical" | "commodity" | "product";

	// The names of the chosen ids: from the pick itself, else looked up once.
	let names = $state<Partial<Record<Named, { id: string; name: string }>>>({});
	$effect(() => {
		const saved = {
			chemical: filters?.chemical,
			commodity: filters?.commodity,
			product: filters?.product
		};
		const missing = (Object.keys(saved) as Named[]).filter(
			(k) => saved[k] && names[k]?.id !== saved[k]
		);
		if (missing.length === 0) return;
		const controller = new AbortController();
		filterLabels(saved, controller.signal).then(
			(labels) => {
				for (const k of missing) {
					const name = labels[k];
					if (name && saved[k]) names[k] = { id: saved[k], name };
				}
			},
			() => {
				// A gone id shows the layer's "no longer available"; the picker shows it unnamed.
			}
		);
		return () => controller.abort();
	});

	function nameOf(kind: Named): string | undefined {
		const id = filters?.[kind];
		return id && names[kind]?.id === id ? names[kind].name : undefined;
	}

	function change(patch: Partial<PesticideFilters>): void {
		const next: PesticideFilters = { ...filters, ...patch };
		for (const key of Object.keys(patch) as (keyof PesticideFilters)[]) {
			if (patch[key] === undefined) delete next[key];
		}
		onchange(next);
	}

	function pickNamed(kind: Named, id: string | undefined, name?: string): void {
		if (id && name) names[kind] = { id, name };
		change({ [kind]: id });
	}

	const categories = $derived(known?.categories.filter((c) => c.in_use) ?? []);
	const chosenCategories = $derived(filters?.category ?? []);
	const categoriesFull = $derived(chosenCategories.length >= LIMITS.CATEGORIES_MAX);

	function toggleCategory(key: string, on: boolean): void {
		const rest = chosenCategories.filter((c) => c !== key);
		const next = on ? [...rest, key] : rest;
		change({ category: next.length > 0 ? next : undefined });
	}

	const iarcDescription = $derived(
		known?.iarc_groups.find((g) => g.key === filters?.iarcGroup)?.description
	);
	const narrowDescription = $derived(
		known?.narrows.find((n) => n.key === filters?.narrow)?.description
	);

	const selectClass =
		"border-input bg-card text-field h-8 w-full min-w-0 rounded-(--radius-control) border px-2 md:text-sm";
</script>

<div class="flex flex-col gap-3" data-testid="pesticide-filters">
	<SearchPicker
		type="chemical"
		label={m.get_data_filter_chemical()}
		value={filters?.chemical}
		name={nameOf("chemical")}
		onchange={(id, name) => pickNamed("chemical", id, name)}
	/>
	<SearchPicker
		type="commodity"
		label={m.get_data_filter_crop()}
		value={filters?.commodity}
		name={nameOf("commodity")}
		onchange={(id, name) => pickNamed("commodity", id, name)}
	/>
	<SearchPicker
		type="product"
		label={m.get_data_filter_product()}
		value={filters?.product}
		name={nameOf("product")}
		onchange={(id, name) => pickNamed("product", id, name)}
	/>

	{#if meta === undefined}
		<p role="status" class="text-muted-foreground text-xs">{m.get_data_loading()}</p>
	{:else if meta === "unavailable"}
		<p role="status" class="text-muted-foreground text-xs">{m.get_data_filters_unavailable()}</p>
	{:else}
		{#if categories.length > 0}
			<fieldset class="flex flex-col gap-1">
				<legend class="mb-1 text-xs font-medium">{m.get_data_filter_category()}</legend>
				{#each categories as category (category.key)}
					{@const on = chosenCategories.includes(category.key)}
					{@const descId = `${uid}-category-${category.key}`}
					<label class="flex min-h-6 items-start gap-2 text-sm">
						<input
							type="checkbox"
							class="accent-primary mt-0.5 size-4 shrink-0"
							checked={on}
							disabled={!on && categoriesFull}
							aria-describedby={category.description ? descId : undefined}
							onchange={(e) => toggleCategory(category.key, e.currentTarget.checked)}
						/>
						<span class="flex flex-col">
							<span>{category.label}</span>
							{#if category.description}
								<span id={descId} class="text-muted-foreground text-xs">{category.description}</span
								>
							{/if}
						</span>
					</label>
				{/each}
			</fieldset>
		{/if}

		<div class="flex flex-col gap-1">
			<label for="{uid}-iarc" class="text-xs font-medium">{m.get_data_filter_iarc()}</label>
			<select
				id="{uid}-iarc"
				class={selectClass}
				value={filters?.iarcGroup ?? ""}
				aria-describedby={iarcDescription ? `${uid}-iarc-desc` : undefined}
				onchange={(e) => change({ iarcGroup: e.currentTarget.value || undefined })}
			>
				<option value="">{m.get_data_filter_any()}</option>
				{#each known!.iarc_groups as group (group.key)}
					<option value={group.key}>{group.label}</option>
				{/each}
			</select>
			{#if iarcDescription}
				<p id="{uid}-iarc-desc" class="text-muted-foreground text-xs">{iarcDescription}</p>
			{/if}
		</div>

		<div class="flex flex-col gap-1">
			<label for="{uid}-method" class="text-xs font-medium">{m.get_data_filter_method()}</label>
			<select
				id="{uid}-method"
				class={selectClass}
				value={filters?.method ?? ""}
				onchange={(e) => change({ method: e.currentTarget.value || undefined })}
			>
				<option value="">{m.get_data_filter_any()}</option>
				{#each known!.methods as method (method.key)}
					<option value={method.key}>{method.label}</option>
				{/each}
			</select>
		</div>

		<div class="flex flex-col gap-1">
			<label for="{uid}-narrow" class="text-xs font-medium">{m.get_data_filter_narrow()}</label>
			<select
				id="{uid}-narrow"
				class={selectClass}
				value={filters?.narrow ?? ""}
				aria-describedby={narrowDescription ? `${uid}-narrow-desc` : undefined}
				onchange={(e) => change({ narrow: e.currentTarget.value || undefined })}
			>
				<option value="">{m.get_data_filter_any()}</option>
				{#each known!.narrows as narrow (narrow.key)}
					<option value={narrow.key}>{narrow.label}</option>
				{/each}
			</select>
			{#if narrowDescription}
				<p id="{uid}-narrow-desc" class="text-muted-foreground text-xs">{narrowDescription}</p>
			{/if}
		</div>
	{/if}
</div>
