<script lang="ts">
	import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
	import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
	import { tick, untrack } from "svelte";
	import { Button } from "$lib/components/ui/button";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { PlaceDirectory } from "./directory";
	import OptionContent from "./OptionContent.svelte";
	import type { PickerState } from "./picker-state.svelte";
	import type { PlaceOption, RegionOption, RegionTypeInfo } from "./types";

	type Parent = { type: string; code: string };
	type View =
		| { kind: "types" }
		| { kind: "children"; parent: Parent & { name: string } }
		| { kind: "type"; type: string; parent: Parent | null }
		| { kind: "monitors"; parent: Parent | null };
	type Load =
		{ status: "loading" } | { status: "error" } | { status: "ready"; options: PlaceOption[] };

	/** Rows drawn at a time; "Show more" adds another page (a tract list is ~1,160 rows). */
	const PAGE = 50;

	let {
		picker,
		directory,
		entryType,
		activeOnly,
		multiple,
		id
	}: {
		picker: PickerState;
		directory: PlaceDirectory;
		entryType: string;
		activeOnly: boolean;
		multiple: boolean;
		id: string;
	} = $props();

	let types = $state<RegionTypeInfo[] | null>(null);
	let typesFailed = $state(false);
	let labels = $state(new Map<string, string>());
	let view = $state.raw<View>({ kind: "types" });
	/** The views Back returns to, each with the key of the control that opened the next. */
	let trail = $state.raw<{ view: View; key: string }[]>([]);
	let load = $state.raw<Load>({ status: "loading" });
	/** The choices for "In:" (the parent type's regions). */
	let parents = $state.raw<RegionOption[]>([]);
	let filter = $state("");
	let shown = $state(PAGE);
	let focus = $state({ row: 0, col: 0 });
	let attempt = $state(0);
	let root = $state<HTMLElement | null>(null);
	let restoreKey: string | null = null;

	$effect(() => {
		void attempt;
		const controller = new AbortController();
		untrack(() => (typesFailed = false));
		Promise.all([
			directory.regionTypes(controller.signal),
			directory.regionTypeLabels(controller.signal)
		]).then(
			([list, names]) => {
				if (controller.signal.aborted) return;
				types = list;
				labels = names;
			},
			() => {
				if (!controller.signal.aborted) typesFailed = true;
			}
		);
		return () => controller.abort();
	});

	function info(type: string): RegionTypeInfo | undefined {
		return types?.find((t) => t.type === type);
	}
	function pluralOf(type: string): string {
		return info(type)?.plural ?? labels.get(type) ?? type;
	}

	// Load the list for the current view.
	$effect(() => {
		const current = view;
		void attempt;
		if (current.kind === "types" || current.kind === "children") return;
		const controller = new AbortController();
		const { signal } = controller;
		untrack(() => (load = { status: "loading" }));
		const fetched: Promise<PlaceOption[]> =
			current.kind === "monitors"
				? current.parent
					? directory.monitorsIn(entryType, current.parent, { activeOnly }, signal)
					: directory.monitors(entryType, { activeOnly }, signal)
				: directory.regionsIn(current.type, current.parent, signal);
		const parentTypes =
			current.kind === "type"
				? (untrack(() => info(current.type))?.parents ?? [])
				: untrack(() => (monitorParentType ? [monitorParentType] : []));
		const choices: Promise<RegionOption[]> = Promise.all(
			parentTypes.map((p) => directory.regionsIn(p, null, signal))
		).then((lists) => lists.flat());
		Promise.all([fetched, choices]).then(
			([options, choiceList]) => {
				if (signal.aborted) return;
				parents = choiceList;
				load = { status: "ready", options };
			},
			() => {
				if (!signal.aborted) load = { status: "error" };
			}
		);
		return () => controller.abort();
	});

	const typeView = $derived(view.kind === "type" ? view : null);
	const heading = $derived.by(() => {
		switch (view.kind) {
			case "types":
				return "";
			case "monitors":
				return m.place_picker_browse_monitors();
			case "children":
				return m.place_picker_browse_inside({ name: view.parent.name });
			case "type":
				return pluralOf(view.type);
		}
	});
	const filterLabel = $derived(
		view.kind === "monitors"
			? m.place_picker_browse_monitors()
			: typeView
				? pluralOf(typeView.type)
				: ""
	);
	/** Monitors narrow by the first parent type the metadata declares (today: county). */
	const monitorParentType = $derived(
		(types ?? []).find((t) => t.parents.length > 0)?.parents[0] ?? null
	);
	const parentType = $derived(
		typeView
			? (info(typeView.type)?.parents[0] ?? null)
			: view.kind === "monitors"
				? monitorParentType
				: null
	);
	const narrowable = $derived(view.kind === "type" || view.kind === "monitors" ? view : null);
	const parentValue = $derived(
		narrowable?.parent ? `${narrowable.parent.type}:${narrowable.parent.code}` : ""
	);

	/** Types a county-like region can be browsed inside: those listing its type as a parent. */
	function childTypes(parent: Parent): RegionTypeInfo[] {
		return (types ?? []).filter((t) => t.parents.includes(parent.type));
	}

	const filtered = $derived.by(() => {
		if (load.status !== "ready") return [];
		const needle = filter.trim().toLowerCase();
		return needle === ""
			? load.options
			: load.options.filter((o) => o.name.toLowerCase().includes(needle));
	});
	const rows = $derived(filtered.slice(0, shown).map((o, i) => picker.rowFor(o, `${id}-r${i}`)));

	async function go(next: View, key: string) {
		restoreKey = null;
		trail = [...trail, { view, key }];
		view = next;
		filter = "";
		shown = PAGE;
		focus = { row: 0, col: 0 };
		await tick();
		root?.querySelector<HTMLElement>("[data-browse-heading]")?.focus();
	}

	async function back() {
		const previous = trail[trail.length - 1];
		if (!previous) return;
		trail = trail.slice(0, -1);
		view = previous.view;
		filter = "";
		shown = PAGE;
		focus = { row: 0, col: 0 };
		restoreKey = previous.key;
		await tick();
		restoreFocus();
	}

	/** Whether the current view's controls are drawn (its list isn't still loading). */
	function settled(): boolean {
		if (view.kind === "types") return types !== null || typesFailed;
		if (view.kind === "children") return true;
		return load.status !== "loading";
	}

	/**
	 * Focus the control Back came from; its list may still be loading, so this retries after loads.
	 * Once the list has settled without it (gone, or past the first page), it's given up on.
	 */
	function restoreFocus() {
		if (restoreKey === null) return;
		const target = root?.querySelector<HTMLElement>(
			`[data-browse-key="${CSS.escape(restoreKey)}"]`
		);
		if (!target) {
			if (settled()) restoreKey = null;
			return;
		}
		restoreKey = null;
		target.focus();
	}
	$effect(() => {
		void rows;
		void view;
		tick().then(restoreFocus);
	});

	function setFilter(value: string) {
		restoreKey = null;
		filter = value;
		shown = PAGE;
		focus = { row: 0, col: 0 };
	}

	function chooseParent(value: string) {
		if (!narrowable) return;
		restoreKey = null;
		const choice = parents.find((p) => `${p.type}:${p.code}` === value);
		const parent = choice ? { type: choice.type, code: choice.code } : null;
		view = narrowable.kind === "type" ? { ...narrowable, parent } : { kind: "monitors", parent };
		setFilter("");
	}

	async function focusCell(row: number, col: number) {
		const hasInside = root?.querySelector(`[data-cell="${row}-1"]`) != null;
		focus = { row, col: col === 1 && hasInside ? 1 : 0 };
		await tick();
		root?.querySelector<HTMLElement>(`[data-cell="${row}-${focus.col}"]`)?.focus();
	}

	function ongridkeydown(event: KeyboardEvent) {
		const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cell]");
		if (!target) return;
		const [row, col] = target.dataset.cell!.split("-").map(Number);
		const last = rows.length - 1;
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				focusCell(Math.min(row + 1, last), col);
				break;
			case "ArrowUp":
				event.preventDefault();
				focusCell(Math.max(row - 1, 0), col);
				break;
			case "ArrowRight":
				event.preventDefault();
				focusCell(row, 1);
				break;
			case "ArrowLeft":
				event.preventDefault();
				focusCell(row, 0);
				break;
			// W3C APG grid: Home/End within the row; Ctrl+Home/End to the first/last cell of the grid.
			case "Home":
				event.preventDefault();
				if (event.ctrlKey) focusCell(0, 0);
				else focusCell(row, 0);
				break;
			case "End":
				event.preventDefault();
				if (event.ctrlKey) focusCell(last, 1);
				else focusCell(row, 1);
				break;
			case "Enter":
			case " ":
				// The Inside button handles its own Enter and Space.
				if (col === 0) {
					event.preventDefault();
					picker.pick(rows[row]);
				}
				break;
		}
	}

	/** The roving tab stop follows real focus (a click, or Back's restore). */
	function ongridfocusin(event: FocusEvent) {
		const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-cell]")?.dataset.cell;
		if (!cell) return;
		const [row, col] = cell.split("-").map(Number);
		if (focus.row !== row || focus.col !== col) focus = { row, col };
	}

	function onfilterkeydown(event: KeyboardEvent) {
		if (event.key !== "Escape" || filter === "") return;
		// Clearing is handled here; don't let a host dialog close too.
		event.preventDefault();
		event.stopPropagation();
		setFilter("");
	}

	/** What a screen reader hears when the list settles, narrows, or fails. */
	const status = $derived.by(() => {
		if (view.kind === "types") return typesFailed ? [m.place_picker_browse_error()] : [];
		if (view.kind === "children") return [];
		if (load.status === "error") return [m.place_picker_browse_error()];
		if (load.status !== "ready") return [];
		return filtered.length === 0
			? [m.place_picker_browse_empty()]
			: [
					m.place_picker_count({
						count: formatNumber(filtered.length),
						countValue: filtered.length
					})
				];
	});

	const hasChildren = (option: PlaceOption) =>
		option.kind === "region" && childTypes(option).length > 0;
</script>

<div bind:this={root} class="flex flex-col gap-1">
	<!-- One persistent region, so changes are announced; whole messages, one per node. -->
	<div data-browse-live role="status" class="sr-only">
		{#each status as text, i (i)}<p>{text}</p>{/each}
	</div>
	{#if view.kind === "types"}
		{#if typesFailed}
			<p class="flex flex-wrap items-center gap-2 px-2 text-sm">
				<span>{m.place_picker_browse_error()}</span>
				<Button variant="outline" size="xs" onclick={() => attempt++}>
					{m.place_picker_retry()}
				</Button>
			</p>
		{:else if types === null}
			<p class="text-muted-foreground px-2 text-sm">{m.place_picker_browse_loading()}</p>
		{:else}
			<ul aria-label={m.place_picker_browse_types()} class="flex flex-col">
				{#each types as t (t.type)}
					{@render typeButton(
						t.plural,
						formatNumber(t.count),
						{ kind: "type", type: t.type, parent: null },
						`type:${t.type}`
					)}
				{/each}
				<!-- A one-time count would need the whole monitor list, so Monitors shows none. -->
				{@render typeButton(
					m.place_picker_browse_monitors(),
					null,
					{ kind: "monitors", parent: null },
					"monitors"
				)}
			</ul>
		{/if}
	{:else}
		<div class="flex flex-col items-start gap-2">
			<Button variant="ghost" size="sm" data-browse-back onclick={back}>
				<ChevronLeftIcon aria-hidden="true" />
				{m.place_picker_browse_back()}
			</Button>
			<h3 tabindex="-1" data-browse-heading class="px-2 text-sm font-medium">{heading}</h3>
		</div>

		{#if view.kind === "children"}
			<ul aria-label={heading} class="flex flex-col">
				{#each childTypes(view.parent) as t (t.type)}
					{@render typeButton(
						t.plural,
						null,
						{
							kind: "type",
							type: t.type,
							parent: { type: view.parent.type, code: view.parent.code }
						},
						`type:${t.type}`
					)}
				{/each}
				{@render typeButton(
					m.place_picker_browse_monitors(),
					null,
					{ kind: "monitors", parent: { type: view.parent.type, code: view.parent.code } },
					"monitors"
				)}
			</ul>
		{:else}
			{#if parentType}
				{@const parentLabel = pluralOf(parentType)}
				<label class="flex items-center gap-2 px-2 text-sm">
					<span>{m.place_picker_browse_in()}</span>
					<select
						value={parentValue}
						onchange={(e) => chooseParent(e.currentTarget.value)}
						class="border-input bg-card focus-visible:border-ring focus-visible:outline-ring text-field h-9 min-w-0 flex-1 rounded-(--radius-control) border px-2 focus-visible:outline-2"
					>
						<option value="">{m.place_picker_browse_all({ types: parentLabel })}</option>
						{#each parents as p (`${p.type}:${p.code}`)}
							<option value="{p.type}:{p.code}">{p.name}</option>
						{/each}
					</select>
				</label>
			{/if}
			<input
				type="text"
				autocomplete="off"
				spellcheck="false"
				aria-label={m.place_picker_browse_filter({ types: filterLabel })}
				placeholder={m.place_picker_browse_filter({ types: filterLabel })}
				value={filter}
				oninput={(e) => setFilter(e.currentTarget.value)}
				onkeydown={onfilterkeydown}
				class="border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-ring text-field h-9 w-full min-w-0 rounded-(--radius-control) border px-2.5 focus-visible:outline-2"
			/>
			{#if load.status === "loading"}
				<p class="text-muted-foreground px-2 text-sm">
					{m.place_picker_browse_loading()}
				</p>
			{:else if load.status === "error"}
				<p class="flex flex-wrap items-center gap-2 px-2 text-sm">
					<span>{m.place_picker_browse_error()}</span>
					<Button variant="outline" size="xs" onclick={() => attempt++}>
						{m.place_picker_retry()}
					</Button>
				</p>
			{:else if rows.length === 0}
				<p class="text-muted-foreground px-2 text-sm">{m.place_picker_browse_empty()}</p>
			{:else}
				<div
					role="grid"
					tabindex="-1"
					aria-label={m.place_picker_browse_places()}
					aria-multiselectable={multiple ? "true" : undefined}
					class="flex flex-col"
					onkeydown={ongridkeydown}
					onfocusin={ongridfocusin}
				>
					{#each rows as row, index (row.id)}
						<div
							role="row"
							id={row.id}
							aria-selected={multiple ? (row.selected ? "true" : "false") : undefined}
							aria-disabled={row.reason ? "true" : undefined}
							aria-describedby={row.reason ? `${row.id}-reason` : undefined}
							class="flex items-start gap-1"
						>
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								role="gridcell"
								data-cell="{index}-0"
								data-browse-key="row:{row.id}"
								tabindex={focus.row === index && focus.col === 0 ? 0 : -1}
								class="hover:bg-secondary focus-visible:outline-ring flex min-w-0 flex-1 cursor-default rounded-(--radius-control) px-2 py-1.5 text-sm focus-visible:outline-2 {row.reason
									? 'cursor-not-allowed'
									: ''}"
								onclick={() => picker.pick(row)}
							>
								<OptionContent {row} {multiple} />
							</div>
							{#if row.option.kind === "region" && hasChildren(row.option)}
								{@const region = row.option}
								<div role="gridcell">
									<Button
										variant="ghost"
										size="sm"
										data-cell="{index}-1"
										data-browse-key="inside:{region.type}:{region.code}"
										tabindex={focus.row === index && focus.col === 1 ? 0 : -1}
										aria-label={m.place_picker_browse_inside({ name: region.name })}
										onclick={() =>
											go(
												{
													kind: "children",
													parent: { type: region.type, code: region.code, name: region.name }
												},
												`inside:${region.type}:${region.code}`
											)}
									>
										{m.place_picker_browse_inside_short()}
									</Button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
				{#if filtered.length > rows.length}
					<Button variant="outline" size="sm" class="self-start" onclick={() => (shown += PAGE)}>
						{m.place_picker_browse_more()}
					</Button>
				{/if}
			{/if}
		{/if}
	{/if}
</div>

{#snippet typeButton(name: string, count: string | null, next: View, key: string)}
	<li>
		<button
			type="button"
			data-browse-key={key}
			class="hover:bg-secondary focus-visible:outline-ring flex w-full items-center justify-between gap-2 rounded-(--radius-control) px-2 py-1.5 text-left text-sm focus-visible:outline-2"
			onclick={() => go(next, key)}
		>
			<span class="min-w-0 break-words">{name}</span>
			<span class="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
				{#if count}{count}{/if}
				<ChevronRightIcon class="size-4" aria-hidden="true" />
			</span>
		</button>
	</li>
{/snippet}
