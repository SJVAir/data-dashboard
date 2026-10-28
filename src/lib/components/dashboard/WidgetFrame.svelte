<script lang="ts">
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import { menuScope } from "$lib/actions/scope";
	import type { MenuProvider } from "$lib/actions/types";
	import { widgetActions, widgetTitle } from "$lib/actions/widget";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import type { Rect, WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { getWidgetType } from "$lib/widgets/registry";

	let {
		widget,
		rect,
		phoneRow
	}: {
		widget: WidgetInstance;
		/** Where it's shown (the tidied layout or the arrangement's preview), in desktop cells. */
		rect: Rect;
		/** Its first row (0-based) in the phone's one-column layout. */
		phoneRow: number;
	} = $props();

	const app = useApp();
	const type = $derived(getWidgetType(widget.type));
	const title = $derived(widgetTitle(widget));
	const titleId = $derived(`widget-title-${widget.id}`);

	// The type's own items first, then the common widget actions.
	const provider: MenuProvider = (ctx) => [
		...(type?.menu(ctx) ?? []),
		...widgetActions(app, widget.id)(ctx)
	];

	let more = $state<HTMLButtonElement | null>(null);
</script>

<!-- Not a named region: one landmark per widget would crowd the landmark list. -->
<section
	class="bg-card text-card-foreground border-border [grid-column:1/-1] [grid-row:var(--prow)] flex min-h-0 flex-col overflow-hidden rounded-lg border md:[grid-column:var(--col)] md:[grid-row:var(--row)]"
	style:--col="{rect.x + 1} / span {rect.w}"
	style:--row="{rect.y + 1} / span {rect.h}"
	style:--prow="{phoneRow + 1} / span {rect.h}"
	data-testid="widget-{widget.id}"
	data-flip-id={widget.id}
	{@attach menuScope(provider)}
>
	<!-- Focusable so Shift+F10 / the Menu key opens the widget's menu (step 2 adds keyboard move). -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="border-border focus-visible:ring-ring/50 flex items-center gap-2 border-b py-1 pr-1 pl-3 outline-none focus-visible:ring-3"
		tabindex="0"
		role="group"
		aria-labelledby={titleId}
		aria-keyshortcuts="Shift+F10"
	>
		<h2 id={titleId} class="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
		<Button
			bind:ref={more}
			variant="ghost"
			size="icon-sm"
			aria-label={m.widget_menu({ title })}
			onclick={() => more && openMenuFor(more, { widgetId: widget.id })}
		>
			<Ellipsis aria-hidden="true" />
		</Button>
	</div>
	<div class="min-h-0 flex-1">
		{#if type}
			<type.component {widget} />
		{/if}
	</div>
</section>
