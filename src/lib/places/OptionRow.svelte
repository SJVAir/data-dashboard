<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import OptionContent from "./OptionContent.svelte";
	import type { Row } from "./picker-state.svelte";

	let {
		row,
		multiple,
		selected,
		active = false,
		tag = "li",
		onpick,
		...rest
	}: {
		row: Row;
		multiple: boolean;
		/** The `aria-selected` state. */
		selected: boolean;
		/** Drawn as the active (or focused) row. */
		active?: boolean;
		tag?: "li" | "div";
		onpick: () => void;
	} & Omit<HTMLAttributes<HTMLElement>, "onclick" | "id" | "role"> = $props();
</script>

<!-- The search combobox keeps focus (aria-activedescendant); Browse moves focus onto the row. -->
<svelte:element
	this={tag}
	{...rest}
	id={row.id}
	role="option"
	aria-selected={selected ? "true" : "false"}
	aria-disabled={row.reason ? "true" : undefined}
	aria-describedby={row.reason ? `${row.id}-reason` : undefined}
	data-active={active ? "true" : undefined}
	class="data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:outline-ring hover:bg-secondary focus-visible:outline-ring flex min-w-0 flex-1 cursor-default items-start gap-2 rounded-(--radius-control) px-2 py-1.5 text-sm focus-visible:outline-2 aria-disabled:cursor-not-allowed data-[active=true]:outline-2"
	onclick={onpick}
>
	<OptionContent {row} {multiple} />
</svelte:element>
