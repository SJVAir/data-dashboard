<script lang="ts">
	import { toast } from "svelte-sonner";
	import DashboardGrid from "$lib/components/dashboard/DashboardGrid.svelte";
	import { askExistingCopy } from "$lib/components/dialogs/ExistingCopyDialog.svelte";
	import MadeByBar from "$lib/components/shared/MadeByBar.svelte";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";
	import { loadLazy } from "$lib/safety/lazy";
	import { SharedDocumentView, type SharedView } from "$lib/shared/poll.svelte";
	import { sharedRemote } from "$lib/shared/remote";
	import { findCopyOf, saveCopy } from "$lib/sharing/copy";
	import { sharedDocumentOf } from "$lib/sharing/export";
	import { fingerprint } from "$lib/sharing/fingerprint";
	import { useApp } from "$lib/store/app.svelte";
	import { navigate, p, route } from "../router";

	const app = useApp();
	// Someone else's dashboard, with no session: undo, redo, and the top bar never reach the
	// viewer's own dashboard from here. Set before the grid mounts.
	app.current = { session: null, isStarter: false };

	let shared = $state.raw<{ token: string; doc: SharedDocumentView } | null>(null);
	/** The remote's file won't load: `loadLazy` has shown the reload bar, so the page adds nothing. */
	let chunkFailed = $state(false);
	let busy = $state(false);

	const view = $derived<SharedView>(shared?.doc.view ?? { kind: "loading" });

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
			const id = await saveCopy(app, {
				kind: "document",
				doc,
				sourceId,
				fingerprint: await fingerprint(sharedDocumentOf(doc))
			});
			await openDashboard(id);
			toast(m.import_saved());
		} catch {
			// Not reported: nothing from a shared document goes into an error report.
			toast(m.import_save_failed());
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
		<h1 class="text-lg font-medium">{view.doc.name ?? m.shared_untitled()}</h1>
		<Button variant="outline" disabled={busy} onclick={makeCopy}>{m.shared_make_copy()}</Button>
	</div>
	<DashboardGrid view={view.doc} />
{:else}
	<div class="flex flex-col items-start gap-2 p-4">
		<h1 class="text-lg font-medium">{message}</h1>
		{#if view.kind === "offline"}
			<Button variant="outline" onclick={() => shared?.doc.retry()}>{m.shared_try_again()}</Button>
		{/if}
		<a href={p("/dashboards")} class="text-primary underline underline-offset-4">
			{m.your_dashboards()}
		</a>
	</div>
{/if}
