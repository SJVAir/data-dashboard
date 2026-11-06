<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { blockNavigation } from "sv-router";
	import { addFromDraft, addTargets, landedIn } from "$lib/get-data/add";
	import DiscardDialog from "$lib/get-data/DiscardDialog.svelte";
	import { flushDraft, loadDraft, type Draft } from "$lib/get-data/draft.svelte";
	import { draftChanged, editDraft, saveEdit } from "$lib/get-data/edit";
	import GetDataView from "$lib/get-data/GetDataView.svelte";
	import { cancelPlan, parseGetDataMode } from "$lib/get-data/mode";
	import { requestFocus } from "$lib/layout/focus-request.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { report } from "$lib/safety/report";
	import { STARTER_ID } from "$lib/starter/starter";
	import { LAST_OPENED_KEY, useApp } from "$lib/store/app.svelte";
	import type { DocumentSession } from "$lib/store/document-session.svelte";
	import { dataTypes } from "$lib/widgets/registry";
	import { navigate, p, route } from "../router";

	const app = useApp();
	// No dashboard is open here: undo, redo and the preview's widget actions never reach one (as
	// on the dashboards list).
	app.current = { session: null, isStarter: false };

	const mode = $derived(parseGetDataMode(route.params));
	/** Another mode (`/data` from Edit data's nav link, say) starts the view afresh. */
	const modeKey = $derived(JSON.stringify(mode));
	let heading = $state<HTMLElement>();
	let initial = $state.raw<Draft | null>(null);
	let lastOpened = $state<string | undefined>();
	/** Edit data: the widget's dashboard. */
	let editing = $state.raw<DocumentSession | null>(null);
	/** The dashboard isn't here, or (Edit data) the widget's data can't be edited. */
	let notFound = $state<"dashboard" | "widget" | null>(null);
	/** The view's draft as it is now (Edit data compares it with `initial`). */
	let current = $state.raw<Draft | null>(null);
	/** Saved, or discarded: navigation goes ahead without asking. */
	let leaving = false;

	// Arriving on the page puts focus on its heading (as the dashboard list does), and on the
	// not-found heading once Edit data finds nothing to edit.
	onMount(() => heading?.focus());
	$effect(() => {
		if (notFound) heading?.focus();
	});

	$effect(() => {
		void modeKey;
		const at = untrack(() => mode);
		let active = true;
		initial = null;
		current = null;
		editing = null;
		notFound = null;
		leaving = false;
		if (at.kind === "edit") {
			// Edit data starts from the widget each time.
			void openDashboard(at.dashboardId)
				.catch((error) => {
					// Storage failed: the "not here" message stands, and the failure is reported.
					report(error, { operation: "get-data-open" });
					return null;
				})
				.then((session) => {
					if (!active) return;
					if (!session || typeof session.doc.deletedAt === "string") {
						notFound = "dashboard";
						return;
					}
					const widget = session.doc.body.widgets.find((w) => w.id === at.widgetId);
					const editable = widget && dataTypes().some((t) => t.type === widget.type);
					if (session.readOnly || !widget || !editable) {
						notFound = "widget";
						return;
					}
					editing = session;
					initial = editDraft(widget);
				});
		} else if (
			at.dashboardId !== undefined &&
			at.dashboardId !== STARTER_ID &&
			!app.index.items.some((d) => d.id === at.dashboardId)
		) {
			// A new widget for a dashboard that isn't here.
			notFound = "dashboard";
		} else {
			const search = route.search as Record<string, unknown>;
			const type = typeof search.type === "string" ? search.type : undefined;
			const last = Promise.resolve()
				.then(() => app.platform.preferences.get<string>(app.space, LAST_OPENED_KEY))
				// Storage blocked: the target falls back to the starter.
				.catch(() => undefined);
			void Promise.all([loadDraft(app.platform, app.space, type), last]).then(([d, opened]) => {
				if (!active) return;
				lastOpened = opened;
				initial = d;
			});
		}
		return () => {
			active = false;
		};
	});

	/** Edit data's dashboard; signed in, it may be on the server, saved from another device. */
	async function openDashboard(id: string): Promise<DocumentSession | null> {
		const open = () => app.sessions.get(id, { remember: false });
		const session = await open();
		if (session || !app.sync) return session;
		try {
			if (await app.sync.fetchMissing(id)) return await open();
		} catch {
			// Offline or refused: the "not here" message stands.
		}
		return null;
	}

	/** The dashboard the button names, and the others in its menu. */
	const targets = $derived(
		mode.kind === "new" ? addTargets(app, mode.dashboardId, lastOpened) : null
	);
	let adding = $state(false);

	/** Adds the draft, then shows it on that dashboard: its title focused, briefly highlighted. */
	async function add(targetId: string, draft: Draft): Promise<void> {
		if (adding) return;
		adding = true;
		let added: Awaited<ReturnType<typeof addFromDraft>>;
		try {
			added = await addFromDraft(app, targetId, draft);
		} catch (error) {
			report(error, { operation: "get-data-add" });
			toast.error(m.get_data_add_failed());
			adding = false;
			return;
		}
		// Kept for the next visit.
		flushDraft();
		requestFocus({ kind: "added", id: added.widgetId });
		// Still busy until the page has gone, so a second click can't add another.
		try {
			await navigate("/dashboards/:id", { params: { id: added.dashboardId } });
			if (added.copied) toast(m.starter_copied());
		} finally {
			adding = false;
		}
	}

	// Leaving Edit data with unsaved changes asks first --------------------------------------

	/** The draft differs from the widget's. */
	const dirty = $derived(
		mode.kind === "edit" && !!initial && !!current && draftChanged(initial, current)
	);
	let asking = $state(false);
	let answer: ((discard: boolean) => void) | null = null;

	/** Opens "Discard changes?"; resolves true for Discard. */
	function askDiscard(): Promise<boolean> {
		answer?.(false);
		asking = true;
		return new Promise((resolve) => (answer = resolve));
	}

	function decide(discard: boolean): void {
		asking = false;
		if (discard) leaving = true;
		const resolve = answer;
		answer = null;
		resolve?.(discard);
	}

	// Back, forward and in-app links (the router asks before it moves; Back is put back on Keep
	// editing). Closing the tab isn't asked about.
	$effect(() => blockNavigation(() => leaving || !dirty || askDiscard()));

	async function cancel(): Promise<void> {
		if (dirty && !(await askDiscard())) return;
		leaving = true;
		const plan = cancelPlan(history.state, mode);
		if (plan.kind === "back") history.back();
		else if (plan.path === "/") void navigate("/");
		else void navigate("/dashboards/:id", { params: { id: plan.id } });
	}

	let saving = $state(false);

	/** Save changes (nothing to apply when unchanged), then back to the widget on its dashboard. */
	async function save(draft: Draft): Promise<void> {
		const session = editing;
		if (saving || !session || mode.kind !== "edit") return;
		const { widgetId } = mode;
		saving = true;
		let landed: Awaited<ReturnType<typeof landedIn>>;
		try {
			saveEdit(session, widgetId, draft);
			landed = await landedIn(session);
		} catch (error) {
			report(error, { operation: "get-data-save" });
			toast.error(m.get_data_save_failed());
			saving = false;
			return;
		}
		leaving = true;
		requestFocus({ kind: "title", id: widgetId });
		try {
			await navigate("/dashboards/:id", { params: { id: landed.session.doc.id } });
			if (landed.copied) toast(m.starter_copied());
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex min-h-full flex-col">
	{#if notFound}
		<div class="flex flex-col items-start gap-2 p-4">
			<h1 bind:this={heading} tabindex="-1" class="text-primary text-lg font-semibold outline-none">
				{notFound === "dashboard" ? m.dashboard_not_here() : m.edit_data_unavailable()}
			</h1>
			<a href={p("/dashboards")} class="text-link underline underline-offset-4">
				{m.your_dashboards()}
			</a>
		</div>
	{:else}
		<h1
			bind:this={heading}
			id="get-data-heading"
			tabindex="-1"
			class="text-primary px-(--grid-gap) pt-(--grid-gap) text-lg font-semibold outline-none"
		>
			{mode.kind === "edit" ? m.edit_data_heading() : m.get_data_heading()}
		</h1>
		{#key modeKey}
			{#if initial}
				<GetDataView
					{mode}
					{initial}
					add={targets ? { ...targets, busy: adding, onAdd: add } : undefined}
					onSave={mode.kind === "edit" ? save : undefined}
					onCancel={cancel}
					onchange={(draft) => (current = draft)}
				/>
			{/if}
		{/key}
	{/if}
</div>

<DiscardDialog open={asking} ondecide={decide} />
