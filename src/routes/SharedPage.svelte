<script lang="ts">
	import { setContext } from "svelte";
	import { toast } from "svelte-sonner";
	import DashboardGrid from "$lib/components/dashboard/DashboardGrid.svelte";
	import { askExistingCopy, openNotifications } from "$lib/components/dialogs/lazy.svelte";
	import MadeByBar from "$lib/components/shared/MadeByBar.svelte";
	import { Button } from "$lib/components/ui/button";
	import { forViewers } from "$lib/notes/options";
	import { m } from "$lib/paraglide/messages.js";
	import { loadLazy } from "$lib/safety/lazy";
	import { SharedDocumentView, type SharedView } from "$lib/shared/poll.svelte";
	import { sharedRemote } from "$lib/shared/remote";
	import { findCopyOf, saveCopy } from "$lib/sharing/copy";
	import { sharedDocumentOf } from "$lib/sharing/export";
	import { fingerprint } from "$lib/sharing/fingerprint";
	import { useApp } from "$lib/store/app.svelte";
	import { watchesThresholds } from "$lib/thresholds/watched";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "$lib/widgets/shared/viewer";
	import { navigate, p, route } from "../router";

	const app = useApp();
	// Someone else's dashboard, with no session: undo, redo, and the top bar never reach the
	// viewer's own dashboard from here. Set before the grid mounts.
	app.current = { session: null, isStarter: false };
	// Someone else's point reads as "(shared location)", in titles and CSV files.
	setContext<PlaceViewer>(PLACE_VIEWER_KEY, "shared");

	let shared = $state.raw<{ token: string; doc: SharedDocumentView } | null>(null);
	/** The remote's file won't load: `loadLazy` has shown the reload bar, so the page adds nothing. */
	let chunkFailed = $state(false);
	let busy = $state(false);

	const view = $derived<SharedView>(shared?.doc.view ?? { kind: "loading" });
	// Without the welcome Note: it tells the owner what to do, not a viewer.
	const viewerDoc = $derived(view.kind === "shown" ? forViewers(view.doc) : null);
	// Each viewer's own desktop notifications switch, once a widget here has an alert level.
	const watched = $derived(view.kind === "shown" && view.doc.body.widgets.some(watchesThresholds));

	$effect(() => {
		const token = route.params.token;
		// Leaving the page (a copy opened): the router unmounts it; until then the view stays.
		if (!token) return;
		let active = true;
		let doc: SharedDocumentView | null = null;
		shared = null;
		chunkFailed = false;
		void (async () => {
			try {
				const remote = await loadLazy(sharedRemote);
				if (!active) return;
				doc = new SharedDocumentView(remote, token);
				shared = { token, doc };
				doc.start();
			} catch {
				if (active) chunkFailed = true;
			}
		})();
		return () => {
			active = false;
			doc?.stop();
		};
	});

	async function openDashboard(id: string) {
		await navigate("/dashboards/:id", { params: { id } });
	}

	async function makeCopy() {
		const current = view;
		if (current.kind !== "shown" || busy) return;
		busy = true;
		try {
			const { doc, sourceId } = current;
			// Matched by source id, not content: a live link's content changes.
			const existing = await findCopyOf(app, sourceId);
			if (existing) {
				const choice = await askExistingCopy(existing);
				if (choice === "open") await openDashboard(existing.id);
				if (choice !== "new") return;
			}
			let id: string;
			try {
				id = await saveCopy(app, {
					kind: "document",
					doc,
					sourceId,
					fingerprint: await fingerprint(sharedDocumentOf(doc))
				});
			} catch {
				// Not reported: nothing from a shared document goes into an error report.
				toast(m.import_save_failed());
				return;
			}
			await openDashboard(id);
			toast(m.import_saved());
		} finally {
			busy = false;
		}
	}

	const message = $derived(
		view.kind === "newer"
			? m.shared_newer()
			: view.kind === "invalid"
				? m.shared_invalid()
				: view.kind === "offline"
					? m.shared_offline()
					: m.shared_unavailable()
	);

	$effect(() => {
		if (view.kind === "shown") {
			document.title = m.page_title({ name: view.doc.name ?? m.shared_untitled() });
		} else if (view.kind === "loading") document.title = m.app_name();
		else document.title = m.page_title_shared_unavailable();
	});
</script>

{#if chunkFailed}
	<!-- The reload bar says what to do. -->
{:else if view.kind === "loading"}
	<p role="status" class="p-4">{m.shared_opening()}</p>
{:else if view.kind === "shown" && shared}
	<MadeByBar displayName={view.displayName} token={shared.token} />
	<div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
		<h1 class="text-primary text-lg font-semibold">{view.doc.name ?? m.shared_untitled()}</h1>
		<div class="flex flex-wrap items-center gap-2">
			{#if watched}
				<Button variant="ghost" onclick={() => openNotifications(view.doc.id)}>
					{m.dashboard_notifications_menu()}
				</Button>
			{/if}
			<Button variant="outline" disabled={busy} onclick={makeCopy}>{m.shared_make_copy()}</Button>
		</div>
	</div>
	{#if viewerDoc}
		<DashboardGrid view={viewerDoc} />
	{/if}
{:else}
	<div class="flex flex-col items-start gap-2 p-4">
		<h1 class="text-primary text-lg font-semibold">{message}</h1>
		{#if view.kind === "offline"}
			<Button variant="outline" onclick={() => shared?.doc.retry()}>{m.shared_try_again()}</Button>
		{/if}
		<a href={p("/dashboards")} class="text-link underline underline-offset-4">
			{m.your_dashboards()}
		</a>
	</div>
{/if}
