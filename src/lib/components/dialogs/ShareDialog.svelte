<script lang="ts">
	import { share, type ShareCopy, type SharePoints } from "./lazy.svelte";
	import { refusedMessage } from "$lib/components/shell/sync-messages";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { m } from "$lib/paraglide/messages.js";
	import { BASE } from "$lib/routing";
	import { useApp } from "$lib/store/app.svelte";
	import { RemoteRefusal, RemoteUnavailable } from "$lib/sync/remote";
	import type { ShareResult } from "$lib/sync/share";
	import type { Dashboard } from "$lib/documents/schema";
	import { hasPoints, swapNotice } from "$lib/sharing/points";
	import { tick, untrack } from "svelte";
	import { serializeSearch } from "sv-router";
	import { p, route } from "../../../router";
	import { returnPath } from "../shell/AccountMenu.svelte";
	import { confirmAction } from "./ConfirmDialog.svelte";

	const app = useApp();

	const copyId = "share-link";
	const liveId = "share-live-link";
	const liveHeadingId = "share-live-heading";
	const copyHeadingId = "share-copy-heading";
	const nameId = "share-display-name";
	const nameHelpId = "share-display-name-help";
	const nameErrorId = "share-display-name-error";

	let copyInput = $state<HTMLInputElement | null>(null);
	let liveInput = $state<HTMLInputElement | null>(null);
	let createButton = $state<HTMLButtonElement | null>(null);

	/** "Link copied", "Link turned off", "Name saved", announced in the status region. */
	let status = $state("");
	/** What the last Create link or Stop sharing said. */
	let notes = $state<string[]>([]);
	let busy = $state(false);
	let name = $state("");
	let nameState = $state<"loading" | "ready" | "failed">("loading");
	/** Why the name couldn't be loaded (set with `nameState` "failed"). */
	let nameLoadError = $state("");
	let nameError = $state("");
	let nameBusy = $state(false);
	let nameLoad = 0;

	/** An exact location's regions: being looked up, failed, or found (`SharePoints`). */
	let lookup = $state.raw<"none" | "looking" | "failed" | SharePoints>("none");
	let lookupController: AbortController | null = null;
	/** "Share my exact location instead" for the copy link and file (each opening). */
	let exact = $state(false);
	/** "Use … instead" swapped the owner's points: the dashboard holds none now. */
	let regionUsed = $state(false);
	/** "Share my exact location" for the live link. */
	let exactLive = $state(false);

	const points = $derived(typeof lookup === "string" ? null : lookup);
	/** The copy link and file on offer; none while an exact location's region is unknown. */
	const copyOffer = $derived.by<ShareCopy | null>(() => {
		const opts = share.opts;
		if (!opts) return null;
		if (!opts.points) return opts;
		if (!points) return null;
		return exact && !regionUsed ? points.exact : points.swapped;
	});
	/** Before a live link, a dashboard holding an exact location asks how to share it. */
	const asksBeforeLink = $derived(!!share.opts?.points && !regionUsed && !exactLive);
	const useRegionLabel = $derived.by(() => {
		switch (points?.summary.kind) {
			case "one":
				return m.share_points_use_region({ region: points.summary.region });
			case "removed":
				return m.share_points_leave_out();
			default:
				return m.share_points_use_regions();
		}
	});

	const live = $derived(share.opts?.live ?? null);
	// Signed out meanwhile: the copy link only.
	const sync = $derived(live ? app.sync : null);
	const token = $derived(live && sync ? (sync.states[live.docId]?.shareToken ?? null) : null);
	const liveUrl = $derived(token ? `${location.origin}${BASE}/shared/${token}` : null);
	const linkNote = $derived(
		!copyOffer
			? ""
			: copyOffer.url
				? m.share_note()
				: copyOffer.linkUnavailable === "read-only"
					? m.share_read_only()
					: m.share_too_big()
	);
	const signedOut = $derived(!sync && app.account.identity.state !== "signed-in");
	// Back to this page after signing in.
	const signInHref = $derived(
		app.platform.identity.signInUrl(
			returnPath({ pathname: p(route.pathname), search: serializeSearch(route.search) ?? "" })
		)
	);

	// Each opening starts fresh, and loads the display name when a live link is offered.
	$effect(() => {
		const open = share.open;
		const opts = share.opts;
		untrack(() => {
			status = "";
			notes = [];
			nameError = "";
			nameLoad++;
			nameState = "loading";
			if (open && opts?.live && app.sync) void loadName();
			lookupController?.abort();
			lookupController = null;
			if (!open) return;
			exact = false;
			regionUsed = false;
			exactLive = false;
			lookup = "none";
			if (opts?.points) startLookup(opts.points);
		});
	});

	// Unmounted mid-lookup: it's no longer wanted.
	$effect(() => () => lookupController?.abort());

	function startLookup(load: (signal: AbortSignal) => Promise<SharePoints>) {
		lookupController?.abort();
		const controller = new AbortController();
		lookupController = controller;
		lookup = "looking";
		load(controller.signal).then(
			(found) => {
				if (lookupController === controller) lookup = found;
			},
			() => {
				if (lookupController === controller) lookup = "failed";
			}
		);
	}

	function retryLookup() {
		const load = share.opts?.points;
		if (load) startLookup(load);
	}

	/**
	 * "Use … instead": the owner's points become their regions (one undoable edit, stored), then
	 * the link is turned on, or an existing link's copy updated, only once the uploaded version
	 * holds no point. A point added or re-picked since the lookup looks up again first.
	 */
	async function useRegionAndShare() {
		if (!points || busy) return;
		busy = true;
		status = "";
		notes = [];
		let applied: "applied" | "stale";
		try {
			applied = await points.useRegion();
		} catch {
			notes = [m.share_live_failed()];
			return;
		} finally {
			busy = false;
		}
		if (applied === "stale") {
			retryLookup();
			return;
		}
		// Until it succeeds, the choice stays offered (pressing it again retries).
		if (await shareLink()) regionUsed = true;
	}

	/** "Share my exact location": the warning stays shown; without a link yet, it's created. */
	async function shareExact() {
		exactLive = true;
		if (!liveUrl) await shareLink();
	}

	// While the name is missing, a return to being online loads it again.
	$effect(() => {
		if (!share.open || nameState !== "failed") return;
		return app.platform.online.onChange((online) => {
			if (online) void loadName();
		});
	});

	async function loadName() {
		const load = nameLoad;
		nameState = "loading";
		name = "";
		try {
			const value = await app.sync!.displayName();
			if (load !== nameLoad) return;
			name = value ?? "";
			nameState = "ready";
		} catch (error) {
			if (load !== nameLoad) return;
			nameLoadError = nameLoadErrorFor(error);
			nameState = "failed";
		}
	}

	/** Loading isn't saving: its own words, and "offline" only for the connection. */
	function nameLoadErrorFor(error: unknown): string {
		if (error instanceof RemoteUnavailable) return m.share_live_offline();
		if (error instanceof RemoteRefusal && error.code === "unauthorized") {
			return m.share_name_load_signed_out();
		}
		return m.share_name_load_failed();
	}

	function nameErrorFor(error: unknown): string {
		if (error instanceof RemoteRefusal) {
			if (error.code === "invalid") return m.share_name_refused();
			if (error.code === "rate_limited") return m.share_name_rate_limited();
			if (error.code === "unauthorized") return m.share_name_signed_out();
		}
		return error instanceof RemoteUnavailable ? m.share_live_offline() : m.share_live_failed();
	}

	function download() {
		copyOffer?.onDownload();
		status = m.share_downloaded();
	}

	async function saveName() {
		if (!sync) return;
		nameBusy = true;
		nameError = "";
		status = "";
		try {
			name = (await sync.setDisplayName(name.trim() || null)) ?? "";
			status = m.share_name_saved();
		} catch (error) {
			nameError = nameErrorFor(error);
		} finally {
			nameBusy = false;
		}
	}

	function notesFor(result: ShareResult): string[] {
		switch (result.kind) {
			case "shared":
				return result.unsynced ? [m.share_live_unsynced()] : [];
			case "not-on-server": {
				// Why: the account refused it ("Only on this device"), or it couldn't upload.
				const why =
					result.hold?.kind === "refused"
						? refusedMessage(result.hold.code)
						: sync?.offline
							? m.share_live_offline()
							: null;
				return why ? [m.share_live_not_on_server(), why] : [m.share_live_not_on_server()];
			}
			case "blocked":
				return [m.share_live_blocked()];
			case "offline":
				return [m.share_live_offline()];
			case "check-failed":
				return [sync?.offline ? m.share_live_offline() : m.share_points_not_saved()];
		}
	}

	function createLink() {
		void shareLink();
	}

	/**
	 * Uploads, then turns the link on (or keeps it, with the uploaded version); resolves whether it
	 * did. Unless the owner chose "Share my exact location", a dashboard that held an exact location
	 * is shared only if the uploaded version holds none.
	 */
	async function shareLink(): Promise<boolean> {
		if (!live || !sync) return false;
		const onlyIf = share.opts?.points && !exactLive ? (doc: Dashboard) => !hasPoints(doc) : null;
		busy = true;
		status = "";
		notes = [];
		try {
			const result = await sync.share(live.docId, onlyIf ? { onlyIf } : undefined);
			notes = notesFor(result);
			if (result.kind !== "shared") return false;
			await tick();
			select(liveInput);
			return true;
		} catch {
			notes = [m.share_live_failed()];
			return false;
		} finally {
			busy = false;
		}
	}

	async function stopSharing() {
		if (!live || !sync) return;
		let settled = () => {};
		const done = new Promise<void>((resolve) => (settled = resolve));
		const confirmed = await confirmAction({
			title: m.share_stop_title(),
			body: m.share_stop_body(),
			confirm: m.share_stop_confirm(),
			destructive: true,
			// The Stop sharing button is gone once the link is off.
			restoreFocus: async () => {
				await done;
				await tick();
				(createButton ?? liveInput)?.focus();
			}
		});
		if (!confirmed) return;
		busy = true;
		status = "";
		notes = [];
		try {
			await sync.unshare(live.docId);
			status = m.share_stopped();
		} catch (error) {
			notes = [error instanceof RemoteUnavailable ? m.share_live_offline() : m.share_live_failed()];
		} finally {
			busy = false;
			settled();
		}
	}

	async function copy(url: string | null, input: HTMLInputElement | null) {
		if (!url) return;
		status = "";
		const copied = await app.platform.clipboard.writeText(url);
		// Refused: leave the whole link selected so Ctrl+C works.
		if (copied) status = m.share_copied();
		else select(input);
	}

	function select(input: HTMLInputElement | null) {
		input?.focus();
		input?.select();
	}
</script>

{#snippet copyLink()}
	{#if copyOffer?.url}
		<div class="grid gap-2">
			<Label for={copyId}>{m.share_link_label()}</Label>
			<Input id={copyId} bind:ref={copyInput} readonly value={copyOffer.url} />
		</div>
	{/if}
{/snippet}

{#snippet copyButtons()}
	{#if copyOffer?.url}
		<Button onclick={() => copy(copyOffer?.url ?? null, copyInput)}>{m.share_copy()}</Button>
	{/if}
	{#if copyOffer}
		<Button variant="outline" onclick={download}>
			{m.share_download_instead()}
		</Button>
	{/if}
{/snippet}

{#snippet lookupStatus()}
	{#if share.opts?.points}
		<!-- Rendered empty first, so its messages are announced. -->
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<p role="status">
				{#if lookup === "looking"}{m.share_points_looking()}{:else if lookup === "failed"}{m.share_points_failed()}{/if}
			</p>
			{#if lookup === "failed"}
				<Button variant="outline" size="sm" onclick={retryLookup}>{m.share_points_retry()}</Button>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet pointsNotice()}
	{#if points && !regionUsed}
		<div class="grid gap-2 text-sm">
			<p>{swapNotice(points.summary)}</p>
			<label class="flex items-center gap-2">
				<input type="checkbox" class="accent-primary size-4" bind:checked={exact} />
				{m.share_points_exact()}
			</label>
			<p role="status">{exact ? m.share_points_exact_warning() : ""}</p>
		</div>
	{/if}
{/snippet}

<Dialog.Root bind:open={share.open}>
	<Dialog.Content
		class="max-h-[90dvh] overflow-y-auto"
		onOpenAutoFocus={(event) => {
			// The live link when there is one; signed out, the copy link.
			const input = sync ? (liveUrl ? liveInput : null) : copyOffer?.url ? copyInput : null;
			if (!input) return;
			event.preventDefault();
			select(input);
		}}
	>
		<Dialog.Header>
			<Dialog.Title>{m.share_title()}</Dialog.Title>
			{#if !sync && linkNote}
				<Dialog.Description>
					{linkNote}
				</Dialog.Description>
			{/if}
		</Dialog.Header>
		{@render lookupStatus()}
		{#if sync}
			<section aria-labelledby={liveHeadingId} class="grid gap-3">
				<h3 id={liveHeadingId} class="text-base font-semibold">{m.share_live_heading()}</h3>
				{#if liveUrl}
					<div class="grid gap-2">
						<Label for={liveId}>{m.share_live_link_label()}</Label>
						<Input id={liveId} bind:ref={liveInput} readonly value={liveUrl} />
					</div>
				{:else}
					<p class="text-muted-foreground text-sm">{m.share_live_description()}</p>
				{/if}
				{#if asksBeforeLink && points}
					<p class="text-sm">{m.share_points_live_notice()}</p>
				{/if}
				{#if exactLive}
					<p class="text-sm">{m.share_points_exact_warning()}</p>
				{/if}
				<div role="status" class="grid gap-1 text-sm">
					{#each notes as note (note)}
						<p>{note}</p>
					{/each}
				</div>
				<div class="flex flex-wrap gap-2">
					{#if asksBeforeLink && points}
						<Button disabled={busy} onclick={useRegionAndShare}>{useRegionLabel}</Button>
						<Button variant="outline" disabled={busy} onclick={shareExact}>
							{m.share_points_share_exact()}
						</Button>
					{/if}
					{#if liveUrl}
						<Button disabled={busy} onclick={() => copy(liveUrl, liveInput)}>
							{m.share_copy()}
						</Button>
						<Button variant="outline" disabled={busy} onclick={stopSharing}>
							{m.share_live_stop()}
						</Button>
					{:else if asksBeforeLink}
						<!-- Asked first (above), once the regions are known. -->
					{:else}
						<Button bind:ref={createButton} disabled={busy} onclick={createLink}>
							{m.share_live_create()}
						</Button>
					{/if}
				</div>
				<div class="grid gap-2">
					<Label for={nameId}>{m.share_name_label()}</Label>
					<div class="flex flex-wrap gap-2">
						<Input
							id={nameId}
							class="min-w-0 flex-1"
							bind:value={name}
							disabled={nameState !== "ready"}
							aria-invalid={nameError ? true : undefined}
							aria-describedby={nameError ? `${nameHelpId} ${nameErrorId}` : nameHelpId}
						/>
						<Button
							variant="outline"
							disabled={nameState !== "ready" || nameBusy}
							onclick={saveName}
						>
							{m.share_name_save()}
						</Button>
					</div>
					<p id={nameHelpId} class="text-muted-foreground text-sm">{m.share_name_help()}</p>
					{#if nameState === "failed"}
						<div class="flex flex-wrap items-center gap-2 text-sm">
							<p>{nameLoadError}</p>
							<Button variant="outline" size="sm" onclick={loadName}>{m.share_name_retry()}</Button>
						</div>
					{/if}
					<p id={nameErrorId} role="alert" class="text-destructive text-sm">{nameError}</p>
				</div>
			</section>
			<section aria-labelledby={copyHeadingId} class="grid gap-3">
				<h3 id={copyHeadingId} class="text-base font-semibold">{m.share_copy_heading()}</h3>
				{#if linkNote}
					<p class="text-muted-foreground text-sm">
						{linkNote}
					</p>
				{/if}
				{@render pointsNotice()}
				{@render copyLink()}
				<div class="flex flex-wrap gap-2">
					{@render copyButtons()}
				</div>
			</section>
			<p role="status" class="text-muted-foreground text-sm">{status}</p>
		{:else}
			{@render pointsNotice()}
			{@render copyLink()}
			{#if signedOut}
				<p class="text-sm">
					<a href={signInHref} class="text-link underline underline-offset-4">{m.share_sign_in()}</a
					>
				</p>
			{/if}
			<p role="status" class="text-muted-foreground text-sm">{status}</p>
			<Dialog.Footer>
				{@render copyButtons()}
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
