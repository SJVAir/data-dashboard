<script lang="ts">
	import { dashboardActions } from "$lib/actions/dashboard";
	import { historyActions } from "$lib/actions/global";
	import { menuScope } from "$lib/actions/scope";
	import type { MenuProvider } from "$lib/actions/types";
	import ContextMenuHost from "$lib/components/menu/ContextMenuHost.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { readingOrder } from "$lib/layout/engine";
	import AddWidgetButton from "./AddWidgetButton.svelte";
	import EmptyState from "./EmptyState.svelte";
	import StarterHint from "./StarterHint.svelte";
	import WidgetFrame from "./WidgetFrame.svelte";

	const app = useApp();
	const dashboard = dashboardActions(app);
	const history = historyActions(app);
	// Not bubbled: a widget's menu lists only its own actions.
	const actions: MenuProvider = (ctx) => [...dashboard(ctx), ...history(ctx)];

	const session = $derived(app.current.session);
	// In reading order, so the single-column layout and the tab order follow it.
	const widgets = $derived(
		session && !session.readOnly ? readingOrder(session.doc.body.widgets) : []
	);
</script>

{#if session}
	<ContextMenuHost>
		<div class="flex min-h-full flex-col gap-4 p-4" {@attach menuScope(actions)}>
			{#if session.readOnly}
				<!-- A read-only document may not be valid, so its widgets aren't rendered. -->
				<p role="status" class="bg-muted rounded-lg px-4 py-2 text-sm">
					{session.readOnly === "newer" ? m.doc_readonly_newer() : m.doc_readonly_invalid()}
				</p>
			{:else}
				{#if app.current.isStarter}
					<StarterHint />
				{/if}
				{#if widgets.length === 0}
					<EmptyState />
				{:else}
					<div
						class="grid auto-rows-[var(--grid-row-height)] grid-cols-1 gap-(--grid-gap) md:grid-cols-[repeat(12,minmax(0,1fr))]"
					>
						{#each widgets as widget (widget.id)}
							<WidgetFrame {widget} />
						{/each}
					</div>
					<div>
						<AddWidgetButton />
					</div>
				{/if}
			{/if}
		</div>
	</ContextMenuHost>
{/if}
