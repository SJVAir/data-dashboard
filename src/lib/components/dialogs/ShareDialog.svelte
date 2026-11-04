<script module lang="ts">
	export type ShareOptions = {
		/** The copy link, or `null` when the dashboard is too big for one. */
		url: string | null;
		/** Why there is no copy link: `"read-only"` (a newer or invalid document) or `"too-big"`. */
		linkUnavailable: "too-big" | "read-only" | null;
		onDownload(): void;
		/**
		 * The dashboard a live link shares; `null` signed out, for the starter, or for a read-only
		 * dashboard (the copy link and file only).
		 */
		live: { docId: string } | null;
	};

	const share = $state<{ open: boolean; opts: ShareOptions | null }>({ open: false, opts: null });

	/** Opens the Share dialog (one is mounted in the app root). */
	export function openShare(opts: ShareOptions): void {
		share.opts = opts;
		share.open = true;
	}
</script>

<script lang="ts">
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

	const live = $derived(share.opts?.live ?? null);
	// Signed out meanwhile: the copy link only.
	const sync = $derived(live ? app.sync : null);
	const token = $derived(live && sync ? (sync.states[live.docId]?.shareToken ?? null) : null);
	const liveUrl = $derived(token ? `${location.origin}${BASE}/shared/${token}` : null);
	const linkNote = $derived(
		share.opts?.url
			? m.share_note()
			: share.opts?.linkUnavailable === "read-only"
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
		});
	});

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
		share.opts?.onDownload();
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
		}
	}

	async function createLink() {
		if (!live || !sync) return;
		busy = true;
		status = "";
		notes = [];
		try {
			const result = await sync.share(live.docId);
			notes = notesFor(result);
			if (result.kind === "shared") {
				await tick();
				select(liveInput);
			}
		} catch {
			notes = [m.share_live_failed()];
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
	{#if share.opts?.url}
		<div class="grid gap-2">
			<Label for={copyId}>{m.share_link_label()}</Label>
			<Input id={copyId} bind:ref={copyInput} readonly value={share.opts.url} />
		</div>
	{/if}
{/snippet}

{#snippet copyButtons()}
	{#if share.opts?.url}
		<Button onclick={() => copy(share.opts?.url ?? null, copyInput)}>{m.share_copy()}</Button>
	{/if}
	<Button variant="outline" onclick={download}>
		{m.share_download_instead()}
	</Button>
{/snippet}

<Dialog.Root bind:open={share.open}>
	<Dialog.Content
		class="max-h-[90dvh] overflow-y-auto"
		onOpenAutoFocus={(event) => {
			// The live link when there is one; signed out, the copy link.
			const input = sync ? (liveUrl ? liveInput : null) : share.opts?.url ? copyInput : null;
			if (!input) return;
			event.preventDefault();
			select(input);
		}}
	>
		<Dialog.Header>
			<Dialog.Title>{m.share_title()}</Dialog.Title>
			{#if !sync}
				<Dialog.Description>
					{linkNote}
				</Dialog.Description>
			{/if}
		</Dialog.Header>
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
				<div role="status" class="grid gap-1 text-sm">
					{#each notes as note (note)}
						<p>{note}</p>
					{/each}
				</div>
				<div class="flex flex-wrap gap-2">
					{#if liveUrl}
						<Button disabled={busy} onclick={() => copy(liveUrl, liveInput)}>
							{m.share_copy()}
						</Button>
						<Button variant="outline" disabled={busy} onclick={stopSharing}>
							{m.share_live_stop()}
						</Button>
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
				<p class="text-muted-foreground text-sm">
					{linkNote}
				</p>
				{@render copyLink()}
				<div class="flex flex-wrap gap-2">
					{@render copyButtons()}
				</div>
			</section>
			<p role="status" class="text-muted-foreground text-sm">{status}</p>
		{:else}
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
