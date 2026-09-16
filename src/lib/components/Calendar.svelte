<!-- src/lib/components/Calendar.svelte -->
<script lang="ts">
	import { groupDaysByMonth, type CalendarDay } from "$lib/calendar";

	interface Props {
		days: Array<CalendarDay>;
	}

	let { days }: Props = $props();

	let months = $derived(groupDaysByMonth(days));
</script>

<div class="flex flex-row flex-wrap gap-4">
	{#each months as group (group.month)}
		<div>
			<h3 class="text-muted-foreground mb-1 text-sm font-medium">{group.month}</h3>
			<div class="grid grid-cols-7 gap-1">
				{#each group.days as day (day.date)}
					<div
						class="text-foreground flex h-8 w-8 items-center justify-center rounded text-xs"
						style:background-color={day.color ?? "var(--muted)"}
						title={day.value !== null ? `${day.date}: ${day.value.toFixed(1)}` : day.date}
					>
						{Number(day.date.slice(-2))}
					</div>
				{/each}
			</div>
		</div>
	{/each}
</div>
