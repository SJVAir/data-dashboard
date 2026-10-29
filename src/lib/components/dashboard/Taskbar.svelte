<script lang="ts">
	import { untrack } from "svelte";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import { menuScope } from "$lib/actions/scope";
	import { restoreWidget, taskbarActions, widgetTitle } from "$lib/actions/widget";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { pendingFocusTarget, takeFocus } from "$lib/layout/focus-request.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { getWidgetType } from "$lib/widgets/registry";

	let {
		widgets,
		onfullscreen
	}: {
		/** The minimized widgets, already in taskbar order. */
		widgets: WidgetInstance[];
		onfullscreen: (id: string) => void;
	} = $props();

	const app = useApp();
	let bar = $state<HTMLElement | null>(null);
	// The one button in the tab order (roving tabindex); index into all buttons.
	let stop = $state(0);
	const count = $derived(widgets.length * 2);
	const current = $derived(Math.min(stop, Math.max(0, count - 1)));

	const all = () => Array.from(bar?.querySelectorAll<HTMLButtonElement>("button") ?? []);

	function onkeydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
		const buttons = all();
		const at = buttons.indexOf(event.target as HTMLButtonElement);
		if (at === -1) return;
		let next: number;
		if (event.key === "ArrowRight") next = (at + 1) % buttons.length;
		else if (event.key === "ArrowLeft") next = (at - 1 + buttons.length) % buttons.length;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = buttons.length - 1;
		else return;
		event.preventDefault();
		stop = next;
		buttons[next].focus();
	}

	function onfocusin(event: FocusEvent): void {
		const at = all().indexOf(event.target as HTMLButtonElement);
		if (at !== -1) stop = at;
	}

	// After a minimize: focus that widget's restore button.
	$effect(() => {
		const request = pendingFocusTarget();
		if (!bar || request?.kind !== "taskbar") return;
		const index = widgets.findIndex((w) => w.id === request.id);
		if (index === -1) return;
		untrack(() => {
			const button = all()[index * 2];
			if (!button) return;
			stop = index * 2;
			button.focus();
			// A starter's hand-off can rebuild the bar right after this. The request is only
			// spent once the button is still there a frame later; if it was replaced, the
			// effect runs again for the new one.
			requestAnimationFrame(() => {
				if (button.isConnected) takeFocus({ kind: "taskbar", id: request.id });
			});
		});
	});
</script>

{#if widgets.length > 0}
	<!-- Focus lives in its buttons (roving tabindex); the toolbar only handles their keys. -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		bind:this={bar}
		role="toolbar"
		aria-label={m.taskbar_label()}
		class="bg-card border-border sticky bottom-0 z-20 flex min-h-(--taskbar-height) items-center gap-2 overflow-x-auto rounded-lg border p-1"
		{onkeydown}
		{onfocusin}
	>
		{#each widgets as widget, i (widget.id)}
			{@const title = widgetTitle(widget)}
			{@const Icon = getWidgetType(widget.type)?.icon ?? CircleQuestionMark}
			<div
				class="border-border flex shrink-0 items-center rounded-md border"
				data-testid="taskbar-{widget.id}"
				{@attach menuScope(taskbarActions(app, widget.id, onfullscreen))}
			>
				<Button
					variant="ghost"
					size="sm"
					tabindex={current === i * 2 ? 0 : -1}
					aria-label={m.taskbar_restore_named({ title })}
					onclick={() => restoreWidget(app, widget.id)}
				>
					<Icon aria-hidden="true" />
					<span class="max-w-40 truncate">{title}</span>
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					tabindex={current === i * 2 + 1 ? 0 : -1}
					aria-label={m.widget_menu({ title })}
					onclick={(e) => openMenuFor(e.currentTarget, { widgetId: widget.id })}
				>
					<Ellipsis aria-hidden="true" />
				</Button>
			</div>
		{/each}
	</div>
{/if}
