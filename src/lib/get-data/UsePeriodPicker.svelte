<script lang="ts">
	import { formatMonthName, formatYear } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { parsePeriod, periodKey } from "$lib/widgets/map/use-period";

	let {
		value,
		years,
		onchange
	}: {
		/** The saved `usePeriod` (`YYYY` or `YYYY-MM`). */
		value: string | undefined;
		/** The years with use data (the pesticide meta's), newest first. */
		years: readonly number[];
		/** A period chosen, as `YYYY` or `YYYY-MM`. */
		onchange: (value: string) => void;
	} = $props();

	const uid = $props.id();
	const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
	const pad = (n: number) => String(n).padStart(2, "0");

	const period = $derived(parsePeriod(value));
	/** The listed years, plus a saved one that isn't (so the select shows what's saved). */
	const choices = $derived(
		period && !years.includes(period.year) ? [...years, period.year] : [...years]
	);
	const year = $derived(period?.year ?? years[0]);
	const month = $derived(period?.month ?? null);

	function choose(nextYear: number, nextMonth: number | null): void {
		onchange(periodKey({ year: nextYear, month: nextMonth }));
	}
</script>

<div class="flex flex-wrap gap-2">
	<div class="flex flex-col gap-1">
		<label for="{uid}-year" class="text-sm font-medium">{m.getdata_map_use_period()}</label>
		<select
			id="{uid}-year"
			value={year === undefined ? "" : String(year)}
			onchange={(e) => choose(Number(e.currentTarget.value), month)}
			class="border-input bg-card text-field h-8 max-w-full min-w-0 rounded-(--radius-control) border px-2 md:text-sm"
		>
			{#each choices as y (y)}
				<option value={String(y)}>{formatYear(`${String(y).padStart(4, "0")}-01-01`)}</option>
			{/each}
		</select>
	</div>
	<div class="flex flex-col gap-1">
		<label for="{uid}-month" class="text-sm font-medium">{m.getdata_map_use_month()}</label>
		<select
			id="{uid}-month"
			value={month === null ? "" : pad(month)}
			disabled={year === undefined}
			onchange={(e) => {
				if (year === undefined) return;
				const next = e.currentTarget.value;
				choose(year, next ? Number(next) : null);
			}}
			class="border-input bg-card text-field h-8 max-w-full min-w-0 rounded-(--radius-control) border px-2 md:text-sm"
		>
			<option value="">{m.getdata_map_use_whole_year()}</option>
			{#each MONTHS as n (n)}
				<!-- A month's name doesn't depend on its year. -->
				<option value={pad(n)}>{formatMonthName(`2000-${pad(n)}-01`)}</option>
			{/each}
		</select>
	</div>
</div>
