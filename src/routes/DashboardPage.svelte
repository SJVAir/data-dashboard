<script lang="ts">
	import { untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { leaveDeletedDashboard } from "$lib/actions/dashboard";
	import DashboardGrid from "$lib/components/dashboard/DashboardGrid.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { updateNotice } from "$lib/safety/update-notice.svelte";
	import { STARTER_ID } from "$lib/starter/starter";
	import { currentDashboardName, useApp } from "$lib/store/app.svelte";
	import { navigate, p, route } from "../router";

	const app = useApp();
	/** The id isn't stored in this space (or was deleted), nor on the server when signed in. */
	let missing = $state(false);
	const name = $derived(missing ? null : currentDashboardName(app));

	/** Bumped to open the page's dashboard again (it arrived after the page said it's missing). */
	let reopens = $state(0);

	$effect(() => {
		const id = route.params.id;
		void reopens;
		if (!id) return;
		// The starter lives at `/`, where its first edit is handled.
		if (id === STARTER_ID) {
			void navigate("/", { replace: true });
			return;
		}
		let active = true;
		missing = false;
		// Already current after the starter's hand-off to its copy: keep it, no flicker.
		if (untrack(() => app.current.session?.doc.id) !== id) {
			app.current = { session: null, isStarter: false };
		}
		void (async () => {
			let session = await app.sessions.get(id);
			// Signed in: it may be on the server, saved from another device.
			const sync = app.sync;
			if (!session && sync && active) {
				let found = false;
				try {
					found = await sync.fetchMissing(id);
				} catch {
					// Offline or refused: the "not here" message stands.
				}
				if (found && active) session = await app.sessions.get(id);
			}
			if (!active) return;
			// A soft-deleted dashboard is gone until its delete is undone.
			const deleted = typeof session?.doc.deletedAt === "string";
			missing = session === null || deleted;
			app.current = { session: deleted ? null : session, isStarter: false };
		})();
		return () => {
			active = false;
		};
	});

	// Stored after the page said it's missing ("Add to my account", a poll, a restore elsewhere):
	// open it now. Runs on each change to the list only, so a failed reopen doesn't repeat.
	$effect(() => {
		const items = app.index.items;
		untrack(() => {
			if (missing && items.some((d) => d.id === route.params.id)) reopens++;
		});
	});

	// Moved to a new id (its old one was taken on the server): this tab's edits are stored, and
	// carried over by the sync worker, then the page follows it.
	$effect(() =>
		app.channel.subscribe((msg) => {
			if (msg.type !== "moved" || msg.space !== app.space || msg.from !== route.params.id) return;
			void (async () => {
				const session = app.current.session;
				if (session?.doc.id === msg.from) await session.flush();
				await navigate("/dashboards/:id", { params: { id: msg.to }, replace: true });
			})();
		})
	);

	// Deleted while shown (Delete, or undoing the toast's restore): move on, as Delete does.
	$effect(() => {
		const session = app.current.session;
		if (!session || typeof session.doc.deletedAt !== "string") return;
		if (session.doc.id !== untrack(() => route.params.id)) return;
		void leaveDeletedDashboard(app, session);
	});

	// A newer build saved it to the account: read-only here until a reload brings that build.
	// Its edits waiting to upload stay queued; this tab's unsaved ones are journaled.
	$effect(() => {
		const session = app.current.session;
		if (!session || session.readOnly) return;
		if (app.sync?.states[session.doc.id]?.hold?.kind !== "newer") return;
		untrack(() => {
			session.suspend();
			session.readOnly = "newer";
			updateNotice.show("newer-data");
		});
	});

	// Unsaved edits from before an update that couldn't be carried over: say so once.
	$effect(() => {
		const session = app.current.session;
		if (!session || session.droppedEdits === 0) return;
		toast(m.edits_dropped());
		session.droppedEdits = 0;
	});

	$effect(() => {
		if (missing) document.title = m.page_title_not_here();
		else if (name) document.title = m.page_title({ name });
	});
</script>

{#if missing}
	<div class="flex flex-col items-start gap-2 p-4">
		<h1 class="text-primary text-lg font-semibold">{m.dashboard_not_here()}</h1>
		<a href={p("/dashboards")} class="text-link underline underline-offset-4">
			{m.your_dashboards()}
		</a>
	</div>
{:else}
	{#if name}
		<h1 class="sr-only">{name}</h1>
	{/if}
	<DashboardGrid />
{/if}
