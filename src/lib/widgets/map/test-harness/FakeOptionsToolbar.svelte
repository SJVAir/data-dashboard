<script lang="ts">
	import type { OptionCheckbox, OptionGroup, OptionRow, OptionValues } from "@sjvair/map-sdk";
	import { fakeToolbars } from "./fake-map.svelte";

	/**
	 * A stand-in for map-sdk's `OptionsToolbar`: every row as a plain control, calling `onchange`
	 * once per action with the whole new values and the changed keys, as map-sdk does. Read-only,
	 * as map-sdk's: every row stays focusable with `aria-disabled`, and nothing changes.
	 */
	let {
		groups,
		values,
		onchange,
		defaults,
		basemapKey,
		readonly
	}: {
		groups: OptionGroup[];
		values: OptionValues;
		onchange: (values: OptionValues, changed: string[]) => void;
		defaults?: OptionValues;
		basemapKey?: string;
		readonly?: boolean;
	} = $props();

	$effect(() => {
		fakeToolbars.last = { groups, values, defaults, basemapKey, readonly };
	});

	const ro = $derived(readonly || undefined);
	/** Read-only: a click changes nothing (not even the box's own checked state). */
	const hold = (e: Event) => {
		if (readonly) e.preventDefault();
	};

	function set(id: string, value: boolean | string) {
		if (readonly || values[id] === value) return;
		onchange({ ...values, [id]: value }, [id]);
	}

	function reset() {
		if (readonly || !defaults) return;
		const changed = Object.keys(defaults).filter((key) => values[key] !== defaults[key]);
		if (changed.length) onchange({ ...values, ...defaults }, changed);
	}

	/** The checkboxes a row shows (a group's children, a checkbox's children while it's on). */
	function checkboxes(row: OptionRow): OptionCheckbox[] {
		if (row.kind === "group") return row.children;
		if (row.kind !== "checkbox") return [];
		const under = values[row.id] === true ? (row.children ?? []).flatMap(checkboxes) : [];
		return [row, ...under];
	}
</script>

<div data-fake-toolbar>
	{#each groups as group (group.id)}
		<fieldset data-group={group.id}>
			<legend>{group.label}</legend>
			{#each group.rows as row, i (i)}
				{#if row.kind === "radio"}
					{#each row.choices as choice (choice.value)}
						<label>
							<input
								type="radio"
								name="{group.id}-{row.id}"
								value={choice.value}
								checked={values[row.id] === choice.value}
								aria-disabled={ro}
								onclick={hold}
								onchange={() => set(row.id, choice.value)}
							/>
							{choice.label}
						</label>
					{/each}
				{:else if row.kind === "select"}
					<label>
						{row.label}
						<select
							data-option={row.id}
							value={values[row.id]}
							aria-disabled={ro}
							onchange={(e) => set(row.id, e.currentTarget.value)}
						>
							{#each row.choices as choice (choice.value)}
								<option value={choice.value}>{choice.label}</option>
							{/each}
						</select>
					</label>
				{:else if row.kind === "reset"}
					<button type="button" aria-disabled={ro} onclick={reset}>{row.label}</button>
				{:else}
					{#each checkboxes(row) as box (box.id)}
						<label>
							<input
								type="checkbox"
								data-option={box.id}
								checked={values[box.id] === true}
								aria-disabled={ro}
								onclick={hold}
								onchange={(e) => set(box.id, e.currentTarget.checked)}
							/>
							{box.label}
						</label>
					{/each}
				{/if}
			{/each}
		</fieldset>
	{/each}
</div>
