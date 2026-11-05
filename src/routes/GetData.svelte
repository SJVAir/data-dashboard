<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { addFromDraft, addTargets } from "$lib/get-data/add";
	import { flushDraft, loadDraft, type Draft } from "$lib/get-data/draft.svelte";
	import GetDataView from "$lib/get-data/GetDataView.svelte";
	import { parseGetDataMode } from "$lib/get-data/mode";
	import { requestFocus } from "$lib/layout/focus-request.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { report } from "$lib/safety/report";
	import { LAST_OPENED_KEY, useApp } from "$lib/store/app.svelte";
	import { navigate, route } from "../router";

	const app = useApp();
	// No dashboard is open here: undo, redo and the preview's widget actions never reach one (as
	// on the dashboards list).
	app.current = { session: null, isStarter: false };

	const mode = $derived(parseGetDataMode(route.params));
	let heading = $state<HTMLElement>();
	let initial = $state.raw<Draft | null>(null);
	let lastOpened = $state<string | undefined>();

	// Arriving on the page puts focus on its heading (as the dashboard list does).
	onMount(() => heading?.focus());

	$effect(() => {
		// Edit data starts from the widget (wired with Save changes).
		if (mode.kind !== "new") return;
		const search = route.search as Record<string, unknown>;
		const type = typeof search.type === "string" ? search.type : undefined;
		let active = true;
		const last = Promise.resolve()
			.then(() => app.platform.preferences.get<string>(app.space, LAST_OPENED_KEY))
			// Storage blocked: the target falls back to the starter.
			.catch(() => undefined);
		void Promise.all([loadDraft(app.platform, app.space, type), last]).then(([d, opened]) => {
			if (!active) return;
			lastOpened = opened;
			initial = d;
		});
		return () => {
			active = false;
		};
	});

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
			return;
		} finally {
			adding = false;
		}
		// Kept for the next visit.
		flushDraft();
		requestFocus({ kind: "added", id: added.widgetId });
		await navigate("/dashboards/:id", { params: { id: added.dashboardId } });
	}

	function cancel(): void {
		if (history.length > 1) history.back();
		else void navigate("/");
	}
</script>

<div class="flex min-h-full flex-col">
	<h1
		bind:this={heading}
		id="get-data-heading"
		tabindex="-1"
		class="text-primary px-(--grid-gap) pt-(--grid-gap) text-lg font-semibold outline-none"
	>
		{mode.kind === "edit" ? m.edit_data_heading() : m.get_data_heading()}
	</h1>
	{#if initial}
		<GetDataView
			{mode}
			{initial}
			add={targets ? { ...targets, busy: adding, onAdd: add } : undefined}
			onCancel={cancel}
		/>
	{/if}
</div>
