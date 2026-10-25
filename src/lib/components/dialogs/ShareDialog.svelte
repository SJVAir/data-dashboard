<script module lang="ts">
	export type ShareOptions = {
		/** The link, or `null` when the dashboard is too big for one. */
		url: string | null;
		onDownload(): void;
	};

	const share = $state<{ open: boolean; opts: ShareOptions | null }>({ open: false, opts: null });

	/** Opens the Share dialog (one is mounted in the app root). */
	export function openShare(opts: ShareOptions): void {
		share.opts = opts;
		share.open = true;
	}
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { m } from "$lib/paraglide/messages.js";
	import { platform } from "$lib/platform";

	const inputId = "share-link";
	let input = $state<HTMLInputElement | null>(null);
	let copied = $state(false);

	$effect(() => {
		if (!share.open) copied = false;
	});

	async function copy() {
		const url = share.opts?.url;
		if (!url) return;
		copied = await platform().clipboard.writeText(url);
		// Refused: leave the whole link selected so Ctrl+C works.
		if (!copied) selectLink();
	}

	function selectLink() {
		input?.focus();
		input?.select();
	}
</script>

<Dialog.Root bind:open={share.open}>
	<Dialog.Content
		onOpenAutoFocus={(event) => {
			if (!share.opts?.url) return;
			event.preventDefault();
			selectLink();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>{m.share_title()}</Dialog.Title>
			<Dialog.Description>
				{share.opts?.url ? m.share_note() : m.share_too_big()}
			</Dialog.Description>
		</Dialog.Header>
		{#if share.opts?.url}
			<div class="grid gap-2">
				<Label for={inputId}>{m.share_link_label()}</Label>
				<Input id={inputId} bind:ref={input} readonly value={share.opts.url} />
			</div>
		{/if}
		<p role="status" class="text-muted-foreground text-sm">{copied ? m.share_copied() : ""}</p>
		<Dialog.Footer>
			{#if share.opts?.url}
				<Button onclick={copy}>{m.share_copy()}</Button>
			{/if}
			<Button variant="outline" onclick={() => share.opts?.onDownload()}>
				{m.share_download_instead()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
