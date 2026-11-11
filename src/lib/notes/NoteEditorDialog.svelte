<script module lang="ts">
	/** The counter shows from here (the limit is `NOTE_TEXT_MAX`). */
	const COUNTER_FROM = 4500;
</script>

<script lang="ts">
	import { untrack } from "svelte";
	import { announce } from "$lib/a11y/announcer.svelte";
	import { noteEditor } from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import DiscardDialog from "$lib/get-data/DiscardDialog.svelte";
	import { requestFocus } from "$lib/layout/focus-request.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import type { DocumentSession } from "$lib/store/document-session.svelte";
	import { createNoteEditor, type NoteEditor, type ToolbarState } from "./editor";
	import { noteMarkdown } from "./messages";
	import NoteToolbar, { type ToolbarAction } from "./NoteToolbar.svelte";
	import { NOTE_TEXT_MAX, noteOptions } from "./options";

	const app = useApp();
	const id = $props.id();

	/** The note's Markdown when the dialog opened. */
	let initial = $state("");
	/**
	 * The editor's own Markdown for it (normalized; usually the same), what an edit is measured
	 * against: Save with nothing changed changes nothing, and Cancel asks only after a change.
	 */
	let baseline = "";
	let editable = $state<HTMLElement | null>(null);
	let editor: NoteEditor | null = null;
	let toolbar = $state<ToolbarState>({
		bold: false,
		italic: false,
		heading: false,
		list: null,
		link: null
	});
	let length = $state(0);
	let dirty = $state(false);
	let asking = $state(false);
	/** "Discard" was chosen: the editor closes once the question has. */
	let discarding = false;
	let linkOpen = $state(false);
	/** Where the length stands, so crossing into "near" or "over" is announced once. */
	let zone: "ok" | "near" | "over" = "ok";

	const over = $derived(length > NOTE_TEXT_MAX);
	const max = formatNumber(NOTE_TEXT_MAX);

	/** The editable session and the Note in it, read when needed. */
	function find(): { session: DocumentSession; widget: WidgetInstance } | null {
		const session = app.current.session;
		const widgetId = noteEditor.widgetId;
		if (!session || session.readOnly || !widgetId) return null;
		const widget = session.doc.body.widgets.find((w) => w.id === widgetId);
		return widget ? { session, widget } : null;
	}

	// Each opening starts from the Note as it is then.
	$effect(() => {
		const open = noteEditor.open;
		void noteEditor.opening;
		untrack(() => {
			if (!open) return;
			const target = find();
			if (!target) {
				noteEditor.open = false;
				return;
			}
			initial = noteMarkdown(noteOptions(target.widget));
			asking = false;
			linkOpen = false;
		});
	});

	// The editor lives as long as its element (the dialog's content, mounted while it's open).
	$effect(() => {
		const root = editable;
		const markdown = initial;
		void noteEditor.opening;
		if (!root) return;
		let made: NoteEditor | null = null;
		untrack(() => {
			zone = "ok";
			made = createNoteEditor(root, markdown, { onUpdate: () => made && refresh(made) });
			baseline = made.markdown();
			editor = made;
			refresh(made, false);
		});
		return () => {
			made?.destroy();
			if (editor === made) editor = null;
		};
	});

	function refresh(from: NoteEditor, speak = true): void {
		toolbar = from.state();
		const markdown = from.markdown();
		length = markdown.length;
		dirty = markdown !== baseline;
		const next = length > NOTE_TEXT_MAX ? "over" : length >= COUNTER_FROM ? "near" : "ok";
		if (speak && next !== zone && next !== "ok") {
			announce(next === "over" ? m.note_editor_too_long({ max }) : countText());
		}
		zone = next;
	}

	function countText(): string {
		return m.note_editor_count({ count: formatNumber(length), max });
	}

	function close(): void {
		noteEditor.open = false;
	}

	/** Cancel, Escape or a click outside: asks first when there are changes. */
	function requestClose(event?: Event): void {
		event?.preventDefault();
		if (dirty) asking = true;
		else close();
	}

	function save(): void {
		if (!editor || over) return;
		const text = editor.markdown();
		// Re-read: the starter may have handed off to its copy, or the Note may be gone.
		const target = find();
		if (target && text !== baseline) {
			target.session.apply({
				op: "setWidgetData",
				target: { widgetId: target.widget.id },
				from: target.widget.data,
				to: target.widget.data,
				options: { from: target.widget.options, to: { text } }
			});
		}
		close();
	}

	function focusText(): void {
		editable?.focus();
	}

	function act(action: ToolbarAction): void {
		if (!editor) return;
		if (action === "bold" || action === "italic") editor.toggle(action);
		else if (action === "heading") editor.heading();
		else editor.list(action === "numbers");
		focusText();
	}

	function onkeydown(event: KeyboardEvent): void {
		// Ctrl/⌘+K asks for a link address (Ctrl/⌘+B and I are the editor's own).
		if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
			event.preventDefault();
			linkOpen = true;
		}
	}

	function onCloseAutoFocus(event: Event): void {
		event.preventDefault();
		const opener = noteEditor.opener;
		if (opener?.isConnected) opener.focus();
		else if (noteEditor.widgetId) requestFocus({ kind: "title", id: noteEditor.widgetId });
	}
</script>

<Dialog.Root bind:open={noteEditor.open}>
	<Dialog.Content
		data-note-editor
		showCloseButton={false}
		class="flex max-h-[85dvh] flex-col max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-xl"
		onEscapeKeydown={requestClose}
		onInteractOutside={requestClose}
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			focusText();
		}}
		{onCloseAutoFocus}
	>
		<Dialog.Header>
			<Dialog.Title>{m.note_editor_title()}</Dialog.Title>
		</Dialog.Header>
		<NoteToolbar
			formats={toolbar}
			bind:linkOpen
			onaction={act}
			onlink={(url) => editor?.link(url) ?? false}
			onunlink={() => editor?.link(null)}
			onlinkclosed={focusText}
		/>
		<!-- The note's text, formatted as you type (Lexical owns what's inside). -->
		<div
			bind:this={editable}
			contenteditable="true"
			role="textbox"
			aria-multiline="true"
			aria-label={m.note_editor_text()}
			aria-describedby={length >= COUNTER_FROM ? `${id}-count` : undefined}
			tabindex="0"
			spellcheck="true"
			class="border-input bg-card focus-visible:ring-ring [&_a]:text-link min-h-48 flex-1 overflow-y-auto rounded-(--radius-control) border p-3 text-sm outline-none focus-visible:ring-2 [&_a]:underline [&_h2]:text-base [&_h2]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
			{onkeydown}
		></div>
		<div class="flex flex-col gap-1 text-xs">
			{#if length >= COUNTER_FROM}
				<p id="{id}-count" class={over ? "text-destructive" : "text-muted-foreground"}>
					{countText()}
				</p>
			{/if}
			{#if over}
				<p class="text-destructive">{m.note_editor_too_long({ max })}</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => requestClose()}>{m.note_editor_cancel()}</Button>
			<Button onclick={save} disabled={over}>{m.note_editor_save()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
<!-- The editor closes once this has (so its own focus return doesn't land on a removed element). -->
<DiscardDialog
	open={asking}
	ondecide={(discard) => {
		discarding = discard;
		asking = false;
	}}
	onCloseAutoFocus={(event) => {
		event.preventDefault();
		if (discarding) close();
		else focusText();
		discarding = false;
	}}
/>
