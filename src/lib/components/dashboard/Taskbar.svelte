<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import { menuScope } from "$lib/actions/scope";
	import { restoreWidget, taskbarActions, widgetTitle } from "$lib/actions/widget";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { pendingFocusTarget, requestFocus, takeFocus } from "$lib/layout/focus-request.svelte";
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

	// After a minimize: focus that widget's restore button.
	$effect(() => {
		const request = pendingFocusTarget();
		if (!bar || request?.kind !== "taskbar") return;
		const index = widgets.findIndex((w) => w.id === request.id);
		if (index === -1) return;
		untrack(() => {
			if (!takeFocus({ kind: "taskbar", id: request.id })) return;
			stop = index * 2;
			all()[index * 2]?.focus();
		});
	});

	// Where focus was in the bar (null once it moves elsewhere).
	let held: { id: string; index: number } | null = null;

	function onfocusin(event: FocusEvent): void {
		const at = all().indexOf(event.target as HTMLButtonElement);
		if (at === -1) return;
		stop = at;
		held = { id: widgets[Math.floor(at / 2)]?.id ?? "", index: Math.floor(at / 2) };
	}

	function onfocusout(event: FocusEvent): void {
		const to = event.relatedTarget;
		if (to instanceof Node && !bar?.contains(to)) held = null;
		// Focus going nowhere: a removal takes the button off the page by the end of this task, a
		// plain blur leaves it there.
		else if (!to) {
			const button = event.target as Node;
			queueMicrotask(() => {
				if (button.isConnected && document.activeElement === document.body) held = null;
			});
		}
	}

	// Focus lost with its element (undo, another tab's restore, a page swap): hand it on.
	function settle(remaining: string[]): void {
		if (!held) return;
		const { id, index } = held;
		const active = document.activeElement;
		if (active && active !== document.body && !bar?.contains(active)) {
			held = null;
			return;
		}
		if (remaining.includes(id)) {
			// The page is being rebuilt (a starter's hand-off): the next bar takes it.
			requestFocus({ kind: "taskbar", id });
			return;
		}
		held = null;
		const all = app.current.session?.doc.body.widgets ?? [];
		const gone = all.find((w) => w.id === id);
		if (gone && !gone.minimized) requestFocus({ kind: "title", id });
		else if (remaining.length) {
			requestFocus({ kind: "taskbar", id: remaining[Math.min(index, remaining.length - 1)] });
		} else {
			const first = all.find((w) => !w.minimized);
			if (first) requestFocus({ kind: "title", id: first.id });
		}
	}

	$effect(() => {
		const ids = widgets.map((w) => w.id);
		untrack(() => {
			if (held && !ids.includes(held.id)) settle(ids);
		});
	});

	onDestroy(() => settle(widgets.map((w) => w.id)));

	// A press outside the bar means focus isn't ours to hand on.
	$effect(() => {
		const onDown = (event: PointerEvent) => {
			if (!(event.target instanceof Node && bar?.contains(event.target))) held = null;
		};
		window.addEventListener("pointerdown", onDown, true);
		return () => window.removeEventListener("pointerdown", onDown, true);
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
		{onfocusout}
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
