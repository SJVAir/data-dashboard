<script lang="ts">
	import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
	import type { PesticidesMeta } from "@sjvair/sdk";
	import { tick, untrack } from "svelte";
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import { pesticideMeta } from "$lib/data/pesticide-meta";
	import { formatDate, formatDateTime, formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { NoticeItem } from "./data/notices";
	import { webHref } from "./notice-links";

	// A spray notice marker's card: one notice's detail, or a list of a section's notices, each
	// row opening its detail. The explainer, the SprayDays link and the method labels come from the
	// pesticide meta.
	// On hover (map-sdk's non-interactive tooltip) it is a static summary with nothing focusable.
	let {
		notices,
		section,
		county,
		onNow,
		interactive = true,
		now = () => new Date()
	}: {
		notices: NoticeItem[];
		section: string | null;
		county: string | null;
		/** On now (not a past day): an active notice gets its "Active" tag. */
		onNow: boolean;
		/** The pinned card (default); false for the hover tooltip's static form. */
		interactive?: boolean;
		/** The clock for the "Active" tag (for tests). */
		now?: () => Date;
	} = $props();

	const sorted = $derived(
		notices.toSorted((a, b) => Date.parse(a.scheduled) - Date.parse(b.scheduled))
	);
	/** The list row whose notice is open, when there are several. */
	let openId = $state<string | null>(null);
	const shown = $derived(
		sorted.length === 1 ? sorted[0] : (sorted.find((n) => n.id === openId) ?? null)
	);

	let meta = $state.raw<PesticidesMeta | null>(null);
	$effect(() => {
		// The hover form shows neither the explainer nor the link.
		if (!interactive) return;
		const controller = new AbortController();
		pesticideMeta(controller.signal).then(
			(value) => (meta = value),
			// Without the meta the card leaves out the explainer and the link.
			() => {}
		);
		return () => controller.abort();
	});

	const explainer = $derived(meta?.notes.noi_meaning ?? null);
	const sourceHref = $derived(webHref(explainer?.source_url));
	const signupHref = $derived(webHref(meta?.links?.spraydays_signup));

	/**
	 * The method's name: the meta's label for the notice's method key; SprayDays' own wording
	 * while the meta hasn't loaded, or for a key it doesn't list (`none`, or one it dropped).
	 */
	function method(notice: NoticeItem): string {
		return meta?.methods.find((entry) => entry.key === notice.methodKey)?.label ?? notice.method;
	}

	// On a past day every notice shown was active that day, so none is tagged.
	function active(notice: NoticeItem): boolean {
		if (!onNow) return false;
		const at = now().getTime();
		return Date.parse(notice.scheduled) <= at && at <= Date.parse(notice.scheduledEnd);
	}

	const when = (iso: string) => formatDateTime(new Date(iso));

	const where = $derived.by(() => {
		if (section !== null && county !== null) return m.map_notice_where({ section, county });
		if (section !== null) return m.map_notice_where_section({ section });
		if (county !== null) return m.map_notice_where_county({ county });
		return m.map_notice_where_no_place();
	});

	function amount(notice: NoticeItem): string | null {
		if (notice.amount === null) return null;
		const value = formatNumber(notice.amount);
		return notice.units
			? m.map_notice_amount({ amount: value, units: notice.units })
			: m.map_notice_amount_no_units({ amount: value });
	}

	const countArgs = $derived({ count: formatNumber(sorted.length), countValue: sorted.length });

	let backButton = $state<HTMLButtonElement>();
	let cardElement = $state<HTMLDivElement>();
	const rows: Record<string, HTMLButtonElement> = {};

	/** The list row that has focus, by notice id, if one has. */
	function focusedRow(): string | null {
		const active = document.activeElement;
		for (const [id, row] of Object.entries(rows)) if (row && row === active) return id;
		return null;
	}

	// The marker's notices update in place (a refetch). When the open notice, or the focused list
	// row, is no longer among them (or the list collapses to one notice, which shows its detail),
	// the card goes back to the list (or the one notice left), and focus that was in the card
	// stays in it: on the list's first row, or on the card. Run before the DOM updates, while the
	// focused Back button or row is still there to be seen.
	$effect.pre(() => {
		// Read the notices every run, so a refetch always reruns this.
		const ids = sorted.map((n) => n.id);
		const has = (id: string) => ids.includes(id);
		const openGone = openId !== null && !has(openId);
		const row = untrack(focusedRow);
		const rowGone = row !== null && (ids.length <= 1 || !has(row));
		if (!openGone && !rowGone) return;
		const hadFocus = untrack(() => !!cardElement?.contains(document.activeElement));
		if (openGone) openId = null;
		if (!hadFocus) return;
		void tick().then(() => {
			const first = sorted.length > 1 ? rows[sorted[0].id] : undefined;
			(first ?? cardElement)?.focus();
		});
	});

	/** Opens a row's notice, moving focus into it (the row it was on goes away). */
	async function open(id: string) {
		openId = id;
		await tick();
		backButton?.focus();
	}

	/** Back to the list, with focus on the row that was open. */
	async function back() {
		const id = openId;
		openId = null;
		await tick();
		if (id !== null) rows[id]?.focus();
	}
</script>

{#snippet activeTag(notice: NoticeItem)}
	{#if active(notice)}
		<span class="border-border bg-muted text-foreground rounded-sm border px-1 text-xs font-medium">
			{m.map_notice_active()}
		</span>
	{/if}
{/snippet}

{#snippet names(items: { id: string; name: string; ofConcern?: boolean }[])}
	{#if items.length === 0}
		<p class="text-muted-foreground">{m.map_notice_none_listed()}</p>
	{:else}
		<ul class="flex flex-col gap-0.5">
			{#each items as item (item.id)}
				<li>
					<span>{item.name}</span>
					{#if item.ofConcern}
						<span class="text-foreground inline-flex items-center gap-0.5 text-xs font-medium">
							<TriangleAlert aria-hidden="true" class="size-3" />
							{m.map_notice_of_concern()}
						</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#if !interactive}
	<div class="flex flex-col gap-1" data-notice-card="hover">
		{#if sorted.length === 1}
			<div class="flex flex-wrap items-center gap-1">
				<p class="font-semibold">{when(sorted[0].scheduled)}</p>
				{@render activeTag(sorted[0])}
			</div>
			<p class="text-muted-foreground">{where}</p>
			{@const summed = amount(sorted[0])}
			{#if summed}
				<p>{summed}</p>
			{/if}
		{:else if sorted.length > 1}
			<p class="font-semibold">{m.map_notice_list_heading(countArgs)}</p>
			<p class="text-muted-foreground">{where}</p>
			<p>
				{m.map_notice_list_span({
					first: formatDate(new Date(sorted[0].scheduled)),
					last: formatDate(new Date(sorted[sorted.length - 1].scheduled))
				})}
			</p>
		{/if}
	</div>
{:else}
	<div
		bind:this={cardElement}
		tabindex="-1"
		class="mapsdk-tooltip-wide focus-visible:ring-ring flex max-h-80 flex-col gap-2 overflow-y-auto rounded-sm focus-visible:ring-2 focus-visible:outline-none"
		data-notice-card
	>
		{#if shown}
			{#if sorted.length > 1}
				<button
					bind:this={backButton}
					type="button"
					class="text-link focus-visible:ring-ring self-start rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
					onclick={back}
				>
					{m.map_notice_back(countArgs)}
				</button>
			{/if}
			<div class="flex flex-wrap items-center gap-1">
				<p class="font-semibold">{when(shown.scheduled)}</p>
				{@render activeTag(shown)}
			</div>
			<p>{m.map_notice_through({ date: when(shown.scheduledEnd) })}</p>
			<p class="text-muted-foreground">{where}</p>
			{@const summed = amount(shown)}
			{#if summed}
				<p>{summed}</p>
			{/if}
			{#if method(shown)}
				<p>{m.map_notice_method({ method: method(shown) })}</p>
			{/if}
			<div>
				<p class="font-medium">{m.map_notice_products()}</p>
				{@render names(shown.products)}
			</div>
			<div>
				<p class="font-medium">{m.map_notice_chemicals()}</p>
				{@render names(shown.chemicals)}
			</div>
		{:else}
			<p class="font-semibold">{m.map_notice_list_heading(countArgs)}</p>
			<p class="text-muted-foreground">{where}</p>
			<ul class="flex flex-col gap-1">
				{#each sorted as notice (notice.id)}
					{@const summed = amount(notice)}
					<li>
						<button
							bind:this={rows[notice.id]}
							type="button"
							class="border-border hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring flex w-full flex-col items-start rounded-sm border px-2 py-1 text-left focus-visible:ring-2 focus-visible:outline-none"
							onclick={() => open(notice.id)}
						>
							<span class="flex flex-wrap items-center gap-1">
								<span class="font-medium">{when(notice.scheduled)}</span>
								{@render activeTag(notice)}
							</span>
							{#if summed}
								<span>{summed}</span>
							{/if}
							{#if method(notice)}
								<span>{m.map_notice_method({ method: method(notice) })}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if explainer}
			<div class="border-border flex flex-col gap-0.5 border-t pt-2 text-xs">
				{#if sourceHref}
					<a
						href={sourceHref}
						target="_blank"
						rel="noopener noreferrer"
						class="text-link font-medium underline underline-offset-4"
					>
						{explainer.title}
						<ExternalLinkCue class="inline size-3 align-baseline" />
					</a>
				{:else}
					<p class="font-medium">{explainer.title}</p>
				{/if}
				<p class="text-muted-foreground">{explainer.summary}</p>
			</div>
		{/if}
		{#if signupHref}
			<a
				href={signupHref}
				target="_blank"
				rel="noopener noreferrer"
				class="text-link text-sm underline underline-offset-4"
			>
				{m.map_notice_spraydays()}
				<ExternalLinkCue class="inline size-3.5 align-baseline" />
			</a>
		{/if}
	</div>
{/if}
