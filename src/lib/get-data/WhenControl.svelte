<script lang="ts">
	import CheckIcon from "@lucide/svelte/icons/check";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import { Select } from "bits-ui";
	import { Input } from "$lib/components/ui/input";
	import { DateRangeSpecSchema, type DateRangeSpec } from "$lib/data/schema";
	import { formatDateRange, todayPacific } from "$lib/format";
	import { resolveRange } from "$lib/format/range";
	import { m } from "$lib/paraglide/messages.js";
	import type { WidgetType } from "$lib/widgets/registry";
	import {
		blockedBySpan,
		presetIdFor,
		presetsFor,
		type Preset,
		type PresetGroup
	} from "./date-presets";

	let {
		type,
		value,
		now,
		onchange
	}: {
		/** The widget type the range is for: its date methods and span limit the list. */
		type: Pick<WidgetType, "dateMethods" | "span">;
		value: DateRangeSpec;
		now: Date;
		onchange: (spec: DateRangeSpec) => void;
	} = $props();

	const uid = $props.id();

	const presets = $derived(presetsFor(type, now));
	const selectedId = $derived.by(() => {
		const id = presetIdFor(value);
		return presets.some((p) => p.id === id) ? id : "custom";
	});
	const selected = $derived(presets.find((p) => p.id === selectedId));

	const GROUP_LABEL: Record<Exclude<PresetGroup, "custom">, () => string> = {
		last: () => m.get_data_group_last(),
		"to-date": () => m.get_data_group_to_date(),
		specific: () => m.get_data_group_specific()
	};
	const groups = $derived(
		(["last", "to-date", "specific", "custom"] as const)
			.map((group) => ({ group, items: presets.filter((p) => p.group === group) }))
			.filter((g) => g.items.length > 0)
	);

	/** The spec a preset would set now: its own, or the dates it asks for, started from today. */
	function specFor(preset: Preset): DateRangeSpec {
		if (preset.spec) return preset.spec;
		const today = todayPacific(now);
		if (preset.needs === "range") {
			const r = resolveRange(value, now);
			return { kind: "custom", start: r.firstDate, end: r.lastDate };
		}
		const unit = preset.needs as "day" | "week" | "month" | "year";
		const start = value.kind === "set" && value.unit === unit ? value.start : today;
		return { kind: "set", unit, start };
	}

	function blockText(spec: DateRangeSpec): string | null {
		const block = blockedBySpan(spec, type.span, now);
		if (block === "too-short") return m.get_data_span_too_short();
		if (block === "too-long") return m.get_data_span_too_long();
		return null;
	}

	/** Why each preset can't be chosen now (by id); fixed presets only, the rest check their dates. */
	const reasons = $derived(
		new Map(
			presets.map((p) => [p.id, p.spec || p.needs !== "range" ? blockText(specFor(p)) : null])
		)
	);

	function choose(id: string): void {
		const preset = presets.find((p) => p.id === id);
		if (!preset || reasons.get(id)) return;
		inputError = null;
		onchange(specFor(preset));
	}

	const resolved = $derived(resolveRange(value, now));
	const rangeText = $derived.by(() => {
		const range = formatDateRange(resolved.firstDate, resolved.lastDate);
		return resolved.rolling ? m.get_data_range_rolling({ range }) : range;
	});

	/** A date the person typed in, or why it can't be used (shown under the input). */
	let inputError = $state<string | null>(null);

	function apply(spec: DateRangeSpec): void {
		const parsed = DateRangeSpecSchema.safeParse(spec);
		if (!parsed.success) {
			inputError =
				spec.kind === "custom" && spec.start > spec.end ? m.get_data_custom_order() : null;
			return;
		}
		const block = blockText(parsed.data);
		inputError = block;
		if (!block) onchange(parsed.data);
	}

	function setStart(unit: "day" | "week" | "month" | "year", raw: string): void {
		if (!raw) return;
		const start =
			unit === "month" ? `${raw}-01` : unit === "year" ? `${raw.padStart(4, "0")}-01-01` : raw;
		apply({ kind: "set", unit, start });
	}

	// "Custom range" shows its dates even for a rolling length the list doesn't have (a saved
	// "last 45 days"): seeded from what it resolves to now, the first edit makes it custom.
	const custom = $derived.by(() => {
		if (value.kind === "custom") return value;
		if (selectedId !== "custom") return null;
		return { kind: "custom" as const, start: resolved.firstDate, end: resolved.lastDate };
	});
	const setSpec = $derived(value.kind === "set" ? value : null);

	const errorId = `${uid}-error`;
	const labelId = `${uid}-label`;
	const valueId = `${uid}-value`;
	const triggerId = `${uid}-trigger`;
	const inputClass = "w-full max-w-56";
</script>

<div class="flex flex-col gap-2">
	<Select.Root type="single" value={selectedId} onValueChange={choose}>
		<span id={labelId} class="sr-only">{m.get_data_date_label()}</span>
		<Select.Trigger
			id={triggerId}
			aria-labelledby="{labelId} {valueId}"
			class="border-input bg-card text-foreground flex h-8 w-full max-w-64 items-center justify-between gap-2 rounded-(--radius-control) border px-2.5 text-sm"
		>
			<span id={valueId}>{selected?.label() ?? m.getdata_preset_custom()}</span>
			<ChevronDownIcon class="text-muted-foreground size-4" aria-hidden="true" />
		</Select.Trigger>
		<Select.Portal>
			<Select.Content
				sideOffset={4}
				class="border-card-border shadow-card bg-popover text-popover-foreground z-50 max-h-(--bits-select-content-available-height) min-w-(--bits-select-anchor-width) overflow-y-auto rounded-lg border p-1"
			>
				<Select.Viewport>
					{#each groups as g (g.group)}
						<Select.Group>
							{#if g.group !== "custom"}
								<Select.GroupHeading class="text-muted-foreground px-1.5 py-1 text-xs font-medium">
									{GROUP_LABEL[g.group]()}
								</Select.GroupHeading>
							{/if}
							{#each g.items as preset (preset.id)}
								{@const reason = reasons.get(preset.id)}
								<Select.Item
									value={preset.id}
									label={preset.label()}
									disabled={!!reason}
									class="data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:text-muted-foreground flex min-h-6 cursor-default items-start gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-disabled:cursor-not-allowed"
								>
									{#snippet children({ selected: on })}
										<span class="flex size-4 shrink-0 items-center">
											{#if on}<CheckIcon class="size-4" aria-hidden="true" />{/if}
										</span>
										<span class="flex flex-col">
											<span>{preset.label()}</span>
											{#if reason}<span class="text-xs">{reason}</span>{/if}
										</span>
									{/snippet}
								</Select.Item>
							{/each}
						</Select.Group>
					{/each}
				</Select.Viewport>
			</Select.Content>
		</Select.Portal>
	</Select.Root>

	{#if setSpec && !custom}
		{@const unit = setSpec.unit}
		<label class="flex flex-col gap-1 text-sm">
			<span class="text-muted-foreground text-xs">
				{unit === "day"
					? m.get_data_pick_day()
					: unit === "week"
						? m.get_data_pick_week()
						: unit === "month"
							? m.get_data_pick_month()
							: m.get_data_pick_year()}
			</span>
			{#if unit === "year"}
				<Input
					type="number"
					inputmode="numeric"
					max={todayPacific(now).slice(0, 4)}
					class={inputClass}
					value={setSpec.start.slice(0, 4)}
					aria-describedby={inputError ? errorId : undefined}
					onchange={(e) => setStart("year", e.currentTarget.value)}
				/>
			{:else if unit === "month"}
				<Input
					type="month"
					placeholder="YYYY-MM"
					class={inputClass}
					value={setSpec.start.slice(0, 7)}
					aria-describedby={inputError ? errorId : undefined}
					onchange={(e) => setStart("month", e.currentTarget.value)}
				/>
			{:else}
				<Input
					type="date"
					class={inputClass}
					value={setSpec.start}
					aria-describedby={inputError ? errorId : undefined}
					onchange={(e) => setStart(unit, e.currentTarget.value)}
				/>
			{/if}
		</label>
	{:else if custom}
		<div class="flex flex-wrap gap-2">
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-muted-foreground text-xs">{m.get_data_custom_start()}</span>
				<Input
					type="date"
					class={inputClass}
					value={custom.start}
					aria-describedby={inputError ? errorId : undefined}
					onchange={(e) =>
						e.currentTarget.value && apply({ ...custom, start: e.currentTarget.value })}
				/>
			</label>
			<label class="flex flex-col gap-1 text-sm">
				<span class="text-muted-foreground text-xs">{m.get_data_custom_end()}</span>
				<Input
					type="date"
					class={inputClass}
					value={custom.end}
					aria-describedby={inputError ? errorId : undefined}
					onchange={(e) =>
						e.currentTarget.value && apply({ ...custom, end: e.currentTarget.value })}
				/>
			</label>
		</div>
	{/if}
	{#if inputError}
		<p id={errorId} class="text-destructive text-xs">{inputError}</p>
	{/if}

	<p class="text-muted-foreground text-xs" data-testid="resolved-range">{rangeText}</p>
</div>
