<script module lang="ts">
	export type RenameOptions = {
		title: string;
		/** The stored text; `""` when the name or title is generated. */
		initial: string;
		/** Shown while the field is empty: the generated name or title. */
		placeholder?: string;
		/** Called with the normalized value (`null` means generated). */
		onSave(value: string | null): void;
	};

	const rename = $state<{ open: boolean; value: string; opts: RenameOptions | null }>({
		open: false,
		value: "",
		opts: null
	});

	/** Opens the rename dialog (one is mounted in the app root). */
	export function openRename(opts: RenameOptions): void {
		rename.opts = opts;
		rename.value = opts.initial;
		rename.open = true;
	}
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { NAME_MAX, normalizeName } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";

	const inputId = "rename-input";
	let input = $state<HTMLInputElement | null>(null);

	function save(event: SubmitEvent) {
		event.preventDefault();
		const opts = rename.opts;
		rename.open = false;
		opts?.onSave(normalizeName(rename.value));
	}
</script>

<Dialog.Root bind:open={rename.open}>
	<Dialog.Content
		showCloseButton={false}
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			input?.focus();
			input?.select();
		}}
	>
		<form class="grid gap-4" onsubmit={save}>
			<Dialog.Header>
				<Dialog.Title>{rename.opts?.title}</Dialog.Title>
			</Dialog.Header>
			<div class="grid gap-2">
				<Label for={inputId}>{m.rename_label()}</Label>
				<Input
					id={inputId}
					bind:ref={input}
					bind:value={rename.value}
					maxlength={NAME_MAX}
					placeholder={rename.opts?.placeholder}
					autocomplete="off"
				/>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (rename.open = false)}>
					{m.rename_cancel()}
				</Button>
				<Button type="submit">{m.rename_save()}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
