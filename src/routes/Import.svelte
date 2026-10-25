<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button";
	import type { DashboardSummary } from "$lib/documents/names";
	import { m } from "$lib/paraglide/messages.js";
	import { loadLazy } from "$lib/safety/lazy";
	import type { Incoming } from "$lib/sharing/incoming";
	import { useApp } from "$lib/store/app.svelte";
	import { navigate, p } from "../router";

	type Document = Extract<Incoming, { kind: "document" }>;
	type View =
		| { kind: "opening" }
		| { kind: "error"; reason: "newer" | "invalid" }
		| { kind: "choose"; incoming: Document; existing: DashboardSummary };

	const app = useApp();
	// Raw: the incoming document goes to storage, which can't clone a state proxy.
	let view = $state.raw<View>({ kind: "opening" });
	let busy = $state(false);

	async function open(id: string) {
		await navigate("/dashboards/:id", { params: { id }, replace: true });
	}

	async function saveNew(incoming: Document) {
		const { saveCopy } = await loadLazy(() => import("$lib/sharing/copy"));
		const id = await saveCopy(app, incoming);
		await open(id);
		toast(m.import_saved());
	}

	async function choose(action: "open" | "new") {
		if (view.kind !== "choose" || busy) return;
		busy = true;
		try {
			if (action === "open") await open(view.existing.id);
			else await saveNew(view.incoming);
		} catch {
			view = { kind: "error", reason: "invalid" };
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		const fragment = location.hash.slice(1);
		if (!fragment) {
			void navigate("/", { replace: true });
			return;
		}
		void (async () => {
			try {
				await importFragment(fragment);
			} catch {
				view = { kind: "error", reason: "invalid" };
			}
		})();
	});

	async function importFragment(fragment: string) {
		const [{ parseLinkFragment }, { settleDocument }] = await loadLazy(() =>
			Promise.all([import("$lib/sharing/incoming"), import("$lib/sharing/settle")])
		);
		const incoming = await parseLinkFragment(fragment, new Date());
		if (incoming.kind === "error") {
			view = { kind: "error", reason: incoming.reason === "newer" ? "newer" : "invalid" };
			return;
		}
		if (incoming.kind !== "document") {
			view = { kind: "error", reason: "invalid" };
			return;
		}
		// With no answer, the page keeps offering both choices.
		const settled = await settleDocument(app, incoming, (existing) => {
			view = { kind: "choose", incoming, existing };
		});
		if (!settled) return;
		await open(settled.id);
		if (settled.saved) toast(m.import_saved());
	}

	$effect(() => {
		document.title = m.app_name();
	});
</script>

<section class="mx-auto grid max-w-xl gap-4 p-6">
	{#if view.kind === "opening"}
		<p role="status">{m.import_opening()}</p>
	{:else if view.kind === "error"}
		<h1 class="text-xl font-semibold">
			{view.reason === "newer" ? m.import_newer() : m.import_link_invalid()}
		</h1>
		<a class="underline" href={p("/dashboards")}>{m.nav_dashboards()}</a>
	{:else}
		<h1 class="text-xl font-semibold">{m.existing_copy_title()}</h1>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" disabled={busy} onclick={() => choose("open")}>
				{m.existing_copy_open()}
			</Button>
			<Button variant="outline" disabled={busy} onclick={() => choose("new")}>
				{m.existing_copy_new()}
			</Button>
		</div>
	{/if}
</section>
