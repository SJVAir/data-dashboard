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
	import { HandOffSchema, overCap, type HandOff } from "$lib/widgets/map/hand-off";
	import { dataTypes } from "$lib/widgets/registry";
	import { navigate, p, route } from "../router";

	/** History state's hand-off, validated (it's untrusted: anything structured clone allows). */
	function parseHandOff(state: unknown): HandOff | null {
		const parsed = HandOffSchema.safeParse(state);
		return parsed.success ? parsed.data : null;
	}

	const app = useApp();
	// No dashboard is open here: undo, redo and the preview's widget actions never reach one (as
	// on the dashboards list).
	app.current = { session: null, isStarter: false };

	const mode = $derived(parseGetDataMode(route.params));
	/**
	 * Another mode (`/data` from Edit data's nav link, say) starts the view afresh, as does another
	 * hand-off (`/data` from the nav link on a visit from a Map, or Back to one).
	 */
	const modeKey = $derived(
		JSON.stringify([mode, parseHandOff((route.state as { getData?: unknown } | null)?.getData)])
	);
	let heading = $state<HTMLElement>();
	let initial = $state.raw<Draft | null>(null);
	let lastOpened = $state<string | undefined>();
	/** Edit data: the widget's dashboard. */
	let editing = $state.raw<DocumentSession | null>(null);
	/** The dashboard isn't here, or (Edit data) the widget's data can't be edited. */
	let notFound = $state<"dashboard" | "widget" | null>(null);
	/** The view's draft as it is now (Edit data compares it with `initial`). */
	let current = $state.raw<Draft | null>(null);
	/**
	 * Opened from a Map ("Show in a chart"): what it handed over in history state (D16). Its
	 * draft is this visit's start, never written to the saved draft (D3).
	 */
	let handOff = $state.raw<HandOff | null>(null);
	/**
	 * What "Discard changes?" compares with: the start (the widget's draft, the Map's), then the
	 * places kept in the opening keep dialog (D24).
	 */
	let baseline = $state.raw<Draft | null>(null);
	/** Saved, or discarded: navigation goes ahead without asking. */
	let leaving = false;

	/**
	 * Navigates with the discard guard lifted. The router reports a refused move (another blocker,
	 * a `beforeLoad` that says no) by resolving with the page unmoved, and a failed one by
	 * throwing; either puts the guard back. Resolves true when the page moved.
	 */
	async function leaveTo(path: string, id: string): Promise<boolean> {
		const from = route.pathname;
		leaving = true;
		try {
			await navigate(path as "/dashboards/:id", { params: { id } });
		} catch (error) {
			leaving = false;
			throw error;
		}
		if (route.pathname === from) {
			leaving = false;
			return false;
		}
		return true;
	}

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
		handOff = null;
		baseline = null;
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
					baseline = initial;
				});
		} else if (
			at.dashboardId !== undefined &&
			at.dashboardId !== STARTER_ID &&
			!app.index.items.some((d) => d.id === at.dashboardId)
		) {
			// A new widget for a dashboard that isn't here.
			notFound = "dashboard";
		} else {
			// A hand-off that doesn't parse (an app update changed the draft, or a hand-edited entry)
			// is ignored: the visit starts from the saved draft, as a plain one does.
			const state = untrack(() => route.state) as { getData?: unknown } | null;
			const from = parseHandOff(state?.getData);
			const search = route.search as Record<string, unknown>;
			const type = typeof search.type === "string" ? search.type : undefined;
			const last = Promise.resolve()
				.then(() => app.platform.preferences.get<string>(app.space, LAST_OPENED_KEY))
				// Storage blocked: the target falls back to the starter.
				.catch(() => undefined);
			const start = from ? Promise.resolve(from.draft) : loadDraft(app.platform, app.space, type);
			void Promise.all([start, last]).then(([d, opened]) => {
				if (!active) return;
				lastOpened = opened;
				handOff = from;
				initial = d;
				if (from) baseline = d;
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
		mode.kind === "new"
			? addTargets(
					app,
					mode.dashboardId,
					lastOpened,
					handOff?.skip ? new Set([handOff.skip]) : undefined
				)
			: null
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
		// Kept for the next visit (a visit from a Map keeps none).
		if (!handOff) flushDraft();
		// Added: the page goes without asking.
		requestFocus({ kind: "added", id: added.widgetId });
		// Still busy until the page has gone, so a second click can't add another.
		try {
			if ((await leaveTo("/dashboards/:id", added.dashboardId)) && added.copied) {
				toast(m.starter_copied());
			}
		} finally {
			adding = false;
		}
	}

	// Leaving Edit data, or a visit from a Map, with unsaved changes asks first --------------

	/** The draft differs from the widget's (or the Map's, D3). */
	const dirty = $derived(
		(mode.kind === "edit" || !!handOff) &&
			!!baseline &&
			!!current &&
			draftChanged(baseline, current)
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
		goBack();
	}

	/** Back, or (opened on a link) the dashboard the view is for, else home; without asking. */
	function goBack(): void {
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
		requestFocus({ kind: "title", id: widgetId });
		try {
			if ((await leaveTo("/dashboards/:id", landed.session.doc.id)) && landed.copied) {
				toast(m.starter_copied());
			}
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
		{#if mode.kind === "edit"}
			<p class="text-muted-foreground px-(--grid-gap) text-sm">{m.edit_data_subheading()}</p>
		{/if}
		{#key modeKey}
			{#if initial}
				<GetDataView
					{mode}
					{initial}
					add={targets ? { ...targets, busy: adding, onAdd: add } : undefined}
					onSave={mode.kind === "edit" ? save : undefined}
					onCancel={cancel}
					onchange={(draft) => (current = draft)}
					saves={!handOff}
					leftOut={handOff?.leftOut ?? 0}
					startNotes={handOff?.notes}
					keepOnOpen={handOff && overCap(handOff.draft)
						? { oncancel: goBack, onkeep: (draft) => (baseline = draft) }
						: undefined}
				/>
			{/if}
		{/key}
	{/if}
</div>

<DiscardDialog open={asking} ondecide={decide} />
