<script module lang="ts">
	export type ConfirmOptions = {
		title: string;
		body: string;
		confirm: string;
		destructive?: boolean;
		/**
		 * Where focus goes after the dialog closes on "confirm" (instead of back to the button
		 * that opened it, which may be gone). May wait for the confirmed work; it runs on close.
		 */
		restoreFocus?: () => void | Promise<void>;
	};

	const ask = $state<{ open: boolean; options: ConfirmOptions | null }>({
		open: false,
		options: null
	});
	let resolver: ((confirmed: boolean) => void) | null = null;
	/** Set when the dialog closes on "confirm"; read by the close-autofocus hook. */
	let restoreAfterClose: (() => void | Promise<void>) | undefined;

	function settle(confirmed: boolean): void {
		// Already answered (the dialog reports its own closing too).
		if (!resolver) {
			ask.open = false;
			return;
		}
		restoreAfterClose = confirmed ? ask.options?.restoreFocus : undefined;
		ask.open = false;
		const resolve = resolver;
		resolver = null;
		resolve?.(confirmed);
	}

	/** Asks the person to confirm (one dialog is mounted in the app root); closing it is "no". */
	export function confirmAction(options: ConfirmOptions): Promise<boolean> {
		settle(false);
		ask.options = options;
		ask.open = true;
		return new Promise((resolve) => (resolver = resolve));
	}
</script>

<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { m } from "$lib/paraglide/messages.js";
</script>

<Dialog.Root
	bind:open={ask.open}
	onOpenChange={(open) => {
		if (!open) settle(false);
	}}
>
	<Dialog.Content
		showCloseButton={false}
		onCloseAutoFocus={(event) => {
			const restore = restoreAfterClose;
			restoreAfterClose = undefined;
			if (!restore) return;
			event.preventDefault();
			void restore();
		}}
	>
		{#if ask.options}
			<Dialog.Header>
				<Dialog.Title>{ask.options.title}</Dialog.Title>
				<Dialog.Description>{ask.options.body}</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => settle(false)}>{m.confirm_cancel()}</Button>
				<Button
					variant={ask.options.destructive ? "destructive" : "default"}
					onclick={() => settle(true)}
				>
					{ask.options.confirm}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
