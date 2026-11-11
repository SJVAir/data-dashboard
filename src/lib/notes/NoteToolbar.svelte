<script module lang="ts">
	export type ToolbarAction = "bold" | "italic" | "heading" | "bullets" | "numbers";
</script>

<script lang="ts">
	import Bold from "@lucide/svelte/icons/bold";
	import Heading from "@lucide/svelte/icons/heading";
	import Italic from "@lucide/svelte/icons/italic";
	import Link from "@lucide/svelte/icons/link";
	import List from "@lucide/svelte/icons/list";
	import ListOrdered from "@lucide/svelte/icons/list-ordered";
	import { mergeProps } from "bits-ui";
	import type { Component } from "svelte";
	import { Button } from "$lib/components/ui/button";
	import { formatShortcut } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import type { ToolbarState } from "./editor";
	import LinkPopover from "./LinkPopover.svelte";

	let {
		formats,
		linkOpen = $bindable(false),
		onaction,
		onlink,
		onunlink,
		onlinkclosed
	}: {
		formats: ToolbarState;
		/** The link address popover is open (Ctrl/⌘+K opens it too). */
		linkOpen?: boolean;
		onaction: (action: ToolbarAction) => void;
		onlink: (url: string) => boolean;
		onunlink: () => void;
		onlinkclosed: () => void;
	} = $props();

	type Tool = {
		action: ToolbarAction;
		label: () => string;
		icon: Component;
		pressed: (s: ToolbarState) => boolean;
		/** The letter of its Ctrl/⌘ shortcut, if it has one. */
		key?: string;
	};

	const TOOLS: Tool[] = [
		{
			action: "bold",
			label: m.note_editor_bold,
			icon: Bold,
			pressed: (s) => s.bold,
			key: "B"
		},
		{
			action: "italic",
			label: m.note_editor_italic,
			icon: Italic,
			pressed: (s) => s.italic,
			key: "I"
		},
		{ action: "heading", label: m.note_editor_heading, icon: Heading, pressed: (s) => s.heading },
		{
			action: "bullets",
			label: m.note_editor_bulleted_list,
			icon: List,
			pressed: (s) => s.list === "bullet"
		},
		{
			action: "numbers",
			label: m.note_editor_numbered_list,
			icon: ListOrdered,
			pressed: (s) => s.list === "number"
		}
	];
	/** `aria-keyshortcuts` for a Ctrl/⌘ plus `key` shortcut. */
	const ariaKeys = (key: string) => `Control+${key} Meta+${key}`;

	/** A tooltip's text: the label, with the shortcut when there is one ("Bold (Ctrl+B)"). */
	const tipText = (label: string, key?: string) =>
		key ? m.note_editor_tooltip_shortcut({ label, keys: formatShortcut(key) }) : label;

	/** The Link button comes after the tools. */
	const LINK_INDEX = TOOLS.length;

	/** The toolbar's one tab stop (the WAI-ARIA toolbar pattern: arrow keys move along it). */
	let active = $state(0);
	let bar = $state<HTMLElement | null>(null);

	function onkeydown(event: KeyboardEvent): void {
		const buttons = [...(bar?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (at === -1) return;
		let next: number;
		if (event.key === "ArrowRight") next = (at + 1) % buttons.length;
		else if (event.key === "ArrowLeft") next = (at - 1 + buttons.length) % buttons.length;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = buttons.length - 1;
		else return;
		event.preventDefault();
		active = next;
		buttons[next].focus();
	}

	/** A pointer press keeps the caret in the note (the action then applies to its selection). */
	const keepSelection = (event: MouseEvent) => event.preventDefault();

	/** The button whose tooltip Escape hid (until the pointer or focus comes back). */
	let dismissed = $state<number | null>(null);

	function reset(i: number): void {
		if (dismissed === i) dismissed = null;
	}

	function focused(i: number): void {
		active = i;
		reset(i);
	}

	/** Escape hides a showing tooltip first (the next Escape is the dialog's). */
	function hideTip(event: KeyboardEvent, i: number): void {
		if (event.key !== "Escape" || dismissed === i) return;
		const button = event.currentTarget as HTMLElement;
		if (!button.matches(":focus-visible") && !button.parentElement?.matches(":hover")) return;
		event.preventDefault();
		event.stopPropagation();
		dismissed = i;
	}
</script>

<!-- A tooltip: shown on hover or keyboard focus, hoverable, and Escape hides it (WCAG 1.4.13).
The button's own label names it, so the tooltip is hidden from screen readers. -->
{#snippet tip(label: string, i: number)}
	{#if dismissed !== i}
		<span
			aria-hidden="true"
			class="bg-foreground text-background pointer-events-auto invisible absolute top-full left-1/2 z-50 mt-1 -translate-x-1/2 rounded-(--radius-control) px-2 py-1 text-xs whitespace-nowrap group-hover:visible group-has-focus-visible:visible"
		>
			{label}
		</span>
	{/if}
{/snippet}

<!-- The editor's own buttons: toggle buttons, one tab stop (arrow keys move along them). -->
<div
	bind:this={bar}
	role="toolbar"
	aria-label={m.note_editor_formatting()}
	tabindex={-1}
	class="border-border flex flex-wrap items-center gap-1 border-b pb-2"
	{onkeydown}
>
	{#each TOOLS as tool, i (tool.action)}
		<span class="group relative inline-flex" role="presentation" onmouseenter={() => reset(i)}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={tool.label()}
				aria-pressed={tool.pressed(formats)}
				aria-keyshortcuts={tool.key ? ariaKeys(tool.key) : undefined}
				tabindex={active === i ? 0 : -1}
				class="aria-pressed:bg-secondary aria-pressed:text-foreground"
				onmousedown={keepSelection}
				onfocus={() => focused(i)}
				onkeydown={(event: KeyboardEvent) => hideTip(event, i)}
				onclick={() => onaction(tool.action)}
			>
				<tool.icon aria-hidden="true" />
			</Button>
			{@render tip(tipText(tool.label(), tool.key), i)}
		</span>
	{/each}
	<span
		class="group relative inline-flex"
		role="presentation"
		onmouseenter={() => reset(LINK_INDEX)}
	>
		<LinkPopover
			bind:open={linkOpen}
			current={formats.link}
			onapply={onlink}
			onremove={onunlink}
			onclosed={onlinkclosed}
		>
			{#snippet trigger(popover)}
				<Button
					{...mergeProps(popover, {
						onmousedown: keepSelection,
						onfocus: () => focused(LINK_INDEX),
						onkeydown: (event: KeyboardEvent) => hideTip(event, LINK_INDEX)
					})}
					variant="ghost"
					size="icon-sm"
					aria-label={m.note_editor_link()}
					aria-pressed={formats.link !== null}
					aria-keyshortcuts={ariaKeys("K")}
					tabindex={active === LINK_INDEX ? 0 : -1}
					class="aria-pressed:bg-secondary aria-pressed:text-foreground"
				>
					<Link aria-hidden="true" />
				</Button>
			{/snippet}
		</LinkPopover>
		{#if !linkOpen}{@render tip(tipText(m.note_editor_link(), "K"), LINK_INDEX)}{/if}
	</span>
</div>
