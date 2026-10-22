<script module lang="ts">
	// DEV ONLY: the hidden dev data page (spec 2, section 11). Registered only in dev builds and
	// never linked; its English text skips Paraglide because it never ships.
	import { platform } from "$lib/platform";
	import { airQualityAdapter } from "$lib/data/adapters/air-quality";
	import {
		createWebRegionResolver,
		type AdapterRequest,
		type DatasetAdapter
	} from "$lib/data/adapters/registry";
	import { createWebMetadata, withCatalog, type CatalogEntry } from "$lib/data/metadata";
	import { createQueryClient, type QueryClient } from "$lib/data/query/client";
	import { loadDevCatalog } from "./dev-catalog";

	type LogRow = {
		id: number;
		what: string;
		started: number;
		ended?: number;
		status: "started" | "finished" | "failed" | "aborted";
		points?: number;
		error?: string;
	};

	/** Every adapter fetch the page's query client starts, newest first. */
	const log = $state<LogRow[]>([]);
	let nextLogId = 0;

	function describe(req: AdapterRequest): string {
		const target = req.target.kind === "monitors" ? req.target.ids.join(",") : req.target.kind;
		const raw = req.downsampleFromRaw ? " from raw" : "";
		return `${req.entryType} ${target} ${req.resolution}${raw} ${req.range.firstDate}..${req.range.lastDate}`;
	}

	/** The air-quality adapter, logging each fetch's start and how it ended. */
	const loggingAdapter: DatasetAdapter = {
		...airQualityAdapter,
		async fetch(req, ctx, signal) {
			log.unshift({ id: ++nextLogId, what: describe(req), started: Date.now(), status: "started" });
			if (log.length > 100) log.length = 100;
			const row = log[0];
			const onAbort = () => Object.assign(row, { status: "aborted", ended: Date.now() });
			signal.addEventListener("abort", onAbort, { once: true });
			try {
				const data = await airQualityAdapter.fetch(req, ctx, signal);
				if (!signal.aborted) {
					const points = data.series.reduce((n, s) => n + s.points.length, 0);
					Object.assign(row, { status: "finished", ended: Date.now(), points });
				}
				return data;
			} catch (error) {
				if (!signal.aborted) {
					Object.assign(row, { status: "failed", ended: Date.now(), error: String(error) });
				}
				throw error;
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
		}
	};

	type Setup = {
		client: QueryClient;
		catalog: CatalogEntry[];
		metadata: ReturnType<typeof createWebMetadata>;
	};
	let setup: Promise<Setup> | undefined;

	/** One client for the page's lifetime in this tab, so its poller isn't started twice. */
	function loadSetup(): Promise<Setup> {
		setup ??= loadDevCatalog().then((catalog) => {
			const metadata = withCatalog(createWebMetadata(), catalog);
			const client = createQueryClient({
				adapters: [loggingAdapter],
				metadata,
				regions: createWebRegionResolver(),
				activity: platform().activity
			});
			return { client, catalog, metadata };
		});
		setup.catch(() => (setup = undefined));
		return setup;
	}
</script>

<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import LevelSwatch from "$lib/components/data/LevelSwatch.svelte";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { LiveQuery } from "$lib/data/live-query.svelte";
	import type { Level, MonitorSummary } from "$lib/data/metadata";
	import type { QueryEntryInfo } from "$lib/data/query/client";
	import { backoffDelay, nextPollDelay } from "$lib/data/query/poller";
	import { chooseResolution } from "$lib/data/resolution";
	import { DateRangeSpecSchema, type DateRangeSpec, type Resolution } from "$lib/data/schema";
	import type { QueryData, QueryInput, QueryState } from "$lib/data/types";
	import { formatDateTime, formatNumber, todayPacific } from "$lib/format";
	import { rangeSpanDays, resolveRange } from "$lib/format/range";

	const RESOLUTIONS: Resolution[] = ["raw", "hour", "day", "month", "quarter", "season", "year"];

	let ready = $state<Setup | null>(null);
	let setupError = $state<string | null>(null);
	let monitors = $state<MonitorSummary[]>([]);
	let levels = $state<Level[]>([]);
	let entries = $state<QueryEntryInfo[]>([]);
	let visible = $state(true);
	let now = $state(Date.now());
	let panelA = $state<LiveQuery | null>(null);
	let panelB = $state<LiveQuery | null>(null);
	/** When each cache entry's last fetch settled, and how many failed in a row (for poll info). */
	const settled = new SvelteMap<string, { at: number; failures: number }>();
	const wasInFlight = new SvelteSet<string>();

	// Inputs.
	let monitorFilter = $state("");
	let monitorId = $state("");
	let entryType = $state("pm25");
	let override = $state<"auto" | Resolution>("auto");
	let rangeKind = $state<DateRangeSpec["kind"]>("trailing");
	let setUnit = $state<"year" | "month" | "week" | "day">("month");
	let setStart = $state(todayPacific());
	let toDateUnit = $state<"year" | "month" | "week">("year");
	let trailingAmount = $state(24);
	let trailingUnit = $state<"hour" | "day" | "month">("hour");
	let customStart = $state(todayPacific());
	let customEnd = $state(todayPacific());

	const spec = $derived.by((): DateRangeSpec => {
		switch (rangeKind) {
			case "set":
				return { kind: "set", unit: setUnit, start: setStart };
			case "to-date":
				return { kind: "to-date", unit: toDateUnit };
			case "trailing":
				return { kind: "trailing", amount: Number(trailingAmount), unit: trailingUnit };
			case "custom":
				return { kind: "custom", start: customStart, end: customEnd };
		}
	});
	const specCheck = $derived(DateRangeSpecSchema.safeParse(spec));

	const input = $derived.by((): QueryInput | null => {
		if (!monitorId || !specCheck.success) return null;
		return {
			layer: {
				dataset: "air-quality",
				entryType,
				place: { kind: "monitor", id: monitorId },
				resolution: override
			},
			dateRange: specCheck.data
		};
	});

	const entryTypes = $derived(ready?.catalog[0].entryTypes ?? []);
	const entryMeta = $derived(entryTypes.find((e) => e.id === entryType));
	const monitor = $derived(monitors.find((m) => m.id === monitorId));
	const shownMonitors = $derived.by(() => {
		const q = monitorFilter.trim().toLowerCase();
		const list = q
			? monitors.filter((m) => `${m.name} ${m.type} ${m.id}`.toLowerCase().includes(q))
			: monitors;
		const shown = list.slice(0, 300);
		// Keep the selected monitor selectable even when the filter hides it.
		if (monitor && !shown.includes(monitor)) shown.unshift(monitor);
		return shown;
	});

	/** What the query client will do, worked out here the same way, to show the reasons. */
	const plan = $derived.by(() => {
		if (!specCheck.success || !entryMeta || !monitorId) return null;
		const range = resolveRange(specCheck.data, new Date(now));
		const offered = airQualityAdapter.offered(entryMeta.resolutions, {
			kind: "monitors",
			ids: [monitorId]
		});
		try {
			const choice = chooseResolution({ spanDays: rangeSpanDays(range), offered, override });
			return { range, offered, choice, error: null };
		} catch (error) {
			return { range, offered, choice: null, error: String(error) };
		}
	});

	const active = $derived(entries.find((e) => e.subscribers > 0));

	const poll = $derived.by(() => {
		if (!active) return null;
		if (!active.includesNow) return { text: "not polled: the range doesn't include now" };
		if (!active.polling) return { text: "not polled: no subscriber polls" };
		if (active.inFlight) return { text: "fetching now" };
		const last = settled.get(active.key);
		if (!last) return { text: "waiting for the first fetch to settle" };
		const due =
			last.failures > 0
				? last.at + backoffDelay(last.failures)
				: last.at + nextPollDelay(active.resolution, new Date(last.at));
		return {
			text: `${formatDateTime(new Date(due))} (in ${Math.max(0, Math.round((due - now) / 1000))} s)`
		};
	});

	function refreshEntries(client: QueryClient) {
		const next = client.entries();
		entries = next;
		for (const e of next) {
			if (e.inFlight) wasInFlight.add(e.key);
			else if (wasInFlight.delete(e.key)) {
				const prev = settled.get(e.key);
				const failures = e.failed ? (prev?.failures ?? 0) + 1 : 0;
				settled.set(e.key, { at: Date.now(), failures });
			}
		}
	}

	function preset(kind: "24h" | "30d" | "year" | "3y") {
		if (kind === "24h") {
			rangeKind = "trailing";
			trailingAmount = 24;
			trailingUnit = "hour";
		} else if (kind === "30d") {
			rangeKind = "trailing";
			trailingAmount = 30;
			trailingUnit = "day";
		} else if (kind === "year") {
			rangeKind = "to-date";
			toDateUnit = "year";
		} else {
			const today = todayPacific();
			rangeKind = "custom";
			customStart = `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`;
			customEnd = today;
		}
	}

	onMount(() => {
		const activity = platform().activity;
		visible = activity.visible();
		const offActivity = activity.onChange((v) => (visible = v));
		const ticker = setInterval(() => (now = Date.now()), 1000);
		let offClient = () => {};
		let closed = false;
		loadSetup().then(
			async (s) => {
				if (closed) return;
				ready = s;
				offClient = s.client.onChange(() => refreshEntries(s.client));
				refreshEntries(s.client);
				panelA = new LiveQuery(s.client, null);
				panelB = new LiveQuery(s.client, null);
				monitors = await s.metadata.monitors();
			},
			(error) => (setupError = String(error))
		);
		return () => {
			closed = true;
			offActivity();
			clearInterval(ticker);
			offClient();
			panelA?.destroy();
			panelB?.destroy();
		};
	});

	// Both panels follow the same input; the client shares one entry and one request.
	$effect(() => {
		const next = input ? $state.snapshot(input) : null;
		const [a, b] = [panelA, panelB];
		// Setting starts fetches that write page state (the log, entries); don't depend on it.
		untrack(() => {
			a?.set(next);
			b?.set(next);
		});
	});

	$effect(() => {
		const metadata = ready?.metadata;
		const type = entryType;
		if (!metadata) return;
		let current = true;
		metadata.levels(type).then((l) => {
			if (current) levels = l;
		});
		return () => (current = false);
	});

	function levelOf(value: number): Level | undefined {
		let found: Level | undefined;
		for (const level of levels) if (value >= level.range[0]) found = level;
		return found;
	}

	const num = (n: number) => formatNumber(n, { maximumFractionDigits: 2 });
	const time = (ms: number | undefined) => (ms === undefined ? "—" : formatDateTime(new Date(ms)));

	function pointCount(data: QueryData | undefined): number {
		return data?.series.reduce((n, s) => n + s.points.length, 0) ?? 0;
	}

	function stateText(state: QueryState): string {
		if (state.status === "unavailable") return `unavailable (${state.reason})`;
		if (state.status === "error") return `error: ${String(state.error)}`;
		return state.status;
	}

	const selectClass = "border-input bg-background h-8 rounded-lg border px-2 text-sm";
</script>

{#snippet field(label: string, value: string | number | boolean | null | undefined)}
	<div class="contents">
		<dt class="text-muted-foreground">{label}</dt>
		<dd class="font-mono break-all" data-field={label}>{value ?? "—"}</dd>
	</div>
{/snippet}

<div class="mx-auto flex max-w-6xl flex-col gap-4 p-4 text-sm">
	<header class="flex flex-col gap-1">
		<h1 class="text-xl font-medium">Dev data page</h1>
		<p class="text-muted-foreground">
			Dev builds only. Live data through the spec 2 data layer, with a stand-in air-quality catalog.
		</p>
	</header>

	{#if setupError}
		<p class="text-destructive">Setup failed: {setupError}</p>
	{:else if !ready}
		<p class="text-muted-foreground">Loading the catalog…</p>
	{:else}
		<section class="bg-card grid gap-3 rounded-lg border p-4 md:grid-cols-2" aria-label="Inputs">
			<div class="flex flex-col gap-2">
				<Label for="monitor-filter">Filter monitors ({monitors.length})</Label>
				<Input id="monitor-filter" bind:value={monitorFilter} placeholder="name, type or id" />
				<Label for="monitor">Monitor</Label>
				<select id="monitor" class={selectClass} bind:value={monitorId}>
					<option value="">Pick a monitor</option>
					{#each shownMonitors as m (m.id)}
						<option value={m.id}>{m.name} ({m.type}) {m.id}</option>
					{/each}
				</select>
				<Label for="entry-type">Entry type</Label>
				<select id="entry-type" class={selectClass} bind:value={entryType}>
					{#each entryTypes as e (e.id)}
						<option value={e.id}>{e.label} ({e.id}; {e.resolutions.join(", ")})</option>
					{/each}
				</select>
				<Label for="override">Resolution override</Label>
				<select id="override" class={selectClass} bind:value={override}>
					<option value="auto">auto (ladder)</option>
					{#each RESOLUTIONS as r (r)}
						<option value={r}>{r}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex flex-wrap gap-2">
					<Button size="sm" variant="outline" onclick={() => preset("24h")}>Last 24 hours</Button>
					<Button size="sm" variant="outline" onclick={() => preset("30d")}>Last 30 days</Button>
					<Button size="sm" variant="outline" onclick={() => preset("year")}>This year</Button>
					<Button size="sm" variant="outline" onclick={() => preset("3y")}>Custom 3 years</Button>
				</div>
				<Label for="range-kind">Range kind</Label>
				<select id="range-kind" class={selectClass} bind:value={rangeKind}>
					<option value="set">set (a calendar unit)</option>
					<option value="to-date">to-date</option>
					<option value="trailing">trailing</option>
					<option value="custom">custom</option>
				</select>
				{#if rangeKind === "set"}
					<Label for="set-unit">Unit</Label>
					<select id="set-unit" class={selectClass} bind:value={setUnit}>
						{#each ["year", "month", "week", "day"] as u (u)}<option value={u}>{u}</option>{/each}
					</select>
					<Label for="set-start">Containing date</Label>
					<Input id="set-start" type="date" bind:value={setStart} />
				{:else if rangeKind === "to-date"}
					<Label for="to-date-unit">Unit</Label>
					<select id="to-date-unit" class={selectClass} bind:value={toDateUnit}>
						{#each ["year", "month", "week"] as u (u)}<option value={u}>{u}</option>{/each}
					</select>
				{:else if rangeKind === "trailing"}
					<Label for="trailing-amount">Amount</Label>
					<Input id="trailing-amount" type="number" min="1" bind:value={trailingAmount} />
					<Label for="trailing-unit">Unit</Label>
					<select id="trailing-unit" class={selectClass} bind:value={trailingUnit}>
						{#each ["hour", "day", "month"] as u (u)}<option value={u}>{u}</option>{/each}
					</select>
				{:else}
					<Label for="custom-start">Start</Label>
					<Input id="custom-start" type="date" bind:value={customStart} />
					<Label for="custom-end">End</Label>
					<Input id="custom-end" type="date" bind:value={customEnd} />
				{/if}
				{#if !specCheck.success}
					<p class="text-destructive">Invalid range: {specCheck.error.issues[0]?.message}</p>
				{/if}
			</div>
		</section>

		<div class="grid gap-4 md:grid-cols-2">
			<section class="bg-card rounded-lg border p-4" aria-label="Plan">
				<h2 class="mb-2 font-medium">Plan</h2>
				<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					{@render field("Spec", JSON.stringify(spec))}
					{@render field("Monitor type", monitor?.type)}
					{#if plan}
						{@render field("First date", plan.range.firstDate)}
						{@render field("Last date", plan.range.lastDate)}
						{@render field("Start", formatDateTime(plan.range.start))}
						{@render field("End (exclusive)", formatDateTime(plan.range.end))}
						{@render field("Span (days)", num(rangeSpanDays(plan.range)))}
						{@render field("Rolling", plan.range.rolling)}
						{@render field("Includes now", plan.range.includesNow)}
						{@render field("Offered", plan.offered.join(", "))}
						{@render field("Resolution", plan.choice?.resolution ?? plan.error)}
						{@render field("Reason", plan.choice?.reason)}
						{@render field("Downsample from raw", plan.choice?.downsampleFromRaw)}
					{/if}
				</dl>
			</section>

			<section class="bg-card rounded-lg border p-4" aria-label="Query and polling">
				<h2 class="mb-2 font-medium">Query and polling</h2>
				<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					{@render field("Status", panelA ? stateText(panelA.state) : null)}
					{@render field("Cache key", active?.key)}
					{@render field("Subscribers", active?.subscribers)}
					{@render field(
						"Processor",
						panelA?.state.status !== "unavailable" ? panelA?.state.data?.processor : null
					)}
					{@render field(
						"From raw",
						panelA?.state.status !== "unavailable" ? panelA?.state.data?.fromRaw : null
					)}
					{@render field(
						"Data resolution",
						panelA?.state.status !== "unavailable" ? panelA?.state.data?.resolution : null
					)}
					{@render field("Last fetch", time(active?.fetchedAt))}
					{@render field("Next poll", poll?.text)}
					{@render field("Tab visible", visible)}
					{@render field("Polling paused", !visible)}
				</dl>
			</section>
		</div>

		<section class="bg-card rounded-lg border p-4" aria-label="Second panel">
			<h2 class="mb-2 font-medium">Second panel (same input)</h2>
			{#if panelB}
				{@const b = panelB.state}
				{@const bData = b.status === "unavailable" ? undefined : b.data}
				{@const aData = panelA?.state.status === "unavailable" ? undefined : panelA?.state.data}
				<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					{@render field("Panel B status", stateText(b))}
					{@render field("Panel B points", pointCount(bData))}
					{@render field("Panel B fetched", time(bData?.fetchedAt))}
					{@render field("Same fetch as panel A", bData !== undefined && aData === bData)}
				</dl>
			{/if}
		</section>

		<section class="bg-card rounded-lg border p-4" aria-label="Request log">
			<div class="mb-2 flex items-center gap-3">
				<h2 class="font-medium">Request log</h2>
				<Button size="xs" variant="outline" onclick={() => (log.length = 0)}>Clear</Button>
			</div>
			<div class="max-h-64 overflow-auto">
				<table class="w-full text-left font-mono text-xs" data-table="log">
					<thead class="text-muted-foreground">
						<tr
							><th>#</th><th>Status</th><th>Request</th><th>Started</th><th>ms</th><th>Points</th
							></tr
						>
					</thead>
					<tbody>
						{#each log as row (row.id)}
							<tr data-status={row.status}>
								<td>{row.id}</td>
								<td>{row.status}</td>
								<td>{row.what}{row.error ? ` (${row.error})` : ""}</td>
								<td>{time(row.started)}</td>
								<td>{row.ended ? row.ended - row.started : ""}</td>
								<td>{row.points ?? ""}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section class="bg-card rounded-lg border p-4" aria-label="Cache entries">
			<h2 class="mb-2 font-medium">Cache entries ({entries.length})</h2>
			<div class="max-h-48 overflow-auto">
				<table class="w-full text-left font-mono text-xs">
					<thead class="text-muted-foreground">
						<tr
							><th>Key</th><th>Subs</th><th>In flight</th><th>Fetched</th><th>Now</th><th>Poll</th
							></tr
						>
					</thead>
					<tbody>
						{#each entries as e (e.key)}
							<tr>
								<td class="break-all">{e.key}</td>
								<td>{e.subscribers}</td>
								<td>{e.inFlight}</td>
								<td>{time(e.fetchedAt)}</td>
								<td>{e.includesNow}</td>
								<td>{e.polling}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section class="bg-card rounded-lg border p-4" aria-label="Data">
			{#if panelA && panelA.state.status !== "unavailable" && panelA.state.data}
				{#each panelA.state.data.series as series (series.place)}
					<h2 class="mb-2 font-medium">
						{series.place}: {series.points.length} points ({entryMeta?.units})
					</h2>
					<div class="max-h-[32rem] overflow-auto">
						<table class="w-full text-left text-xs" data-table="data">
							<thead class="text-muted-foreground">
								<tr>
									<th>Time (Pacific)</th><th>Mean</th><th>Min</th><th>Max</th><th>Count</th><th
										>Partial</th
									><th>Level</th>
								</tr>
							</thead>
							<tbody class="font-mono">
								{#each series.points as point (point.t)}
									{@const level = levelOf(point.mean)}
									<tr data-partial={point.partial}>
										<td>{formatDateTime(new Date(point.t))}</td>
										<td>{num(point.mean)}</td>
										<td>{num(point.min)}</td>
										<td>{num(point.max)}</td>
										<td>{point.count}</td>
										<td>{point.partial ? "partial" : ""}</td>
										<td>
											{#if level}<LevelSwatch color={level.color} label={level.label} />{/if}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/each}
			{:else}
				<p class="text-muted-foreground">No data yet.</p>
			{/if}
		</section>
	{/if}
</div>
