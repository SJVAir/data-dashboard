<script module lang="ts">
	const clear = $state({ open: false });

	/** Opens the "Clear my data" dialog (one is mounted in the app root). */
	export function openClearData(): void {
		clear.open = true;
	}
</script>

<script lang="ts">
	import { tick } from "svelte";
	import { toast } from "svelte-sonner";
	import { downloadBackupFile, prefetchSharing } from "$lib/actions/dashboard";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { m } from "$lib/paraglide/messages.js";
	import { clearMyData } from "$lib/safety/clear";
	import { useApp } from "$lib/store/app.svelte";
	import { navigate } from "../../../router";

	const app = useApp();
	let clearing = $state(false);
	// Clearing waits until the backup file has been handed over.
	let backingUp = $state(false);
	let cleared = false;
	// Dashboards the dialog says it removes: the live ones and those in Recently deleted.
	const deleted = $derived(app.index.deleted.length);
	const count = $derived(app.index.items.length + deleted);

	// Loaded ahead, so "Download a backup first" starts at once.
	$effect(() => {
		if (clear.open) prefetchSharing();
	});

	async function backupFirst() {
		backingUp = true;
		try {
			await downloadBackupFile(app);
		} finally {
			backingUp = false;
		}
	}

	async function confirm() {
		clearing = true;
		try {
			await clearMyData(app);
			// The root component goes to "/" too; focus lands once the starter's page is there.
			await navigate("/", { replace: true });
			await tick();
			cleared = true;
			clear.open = false;
		} catch {
			toast.error(m.clear_failed());
		} finally {
			clearing = false;
		}
	}

	/** The page it came from may be gone: land on the page's main heading (or the page). */
	function focusPage() {
		const target = document.querySelector<HTMLElement>("main h1") ?? document.querySelector("main");
		if (!target) return;
		if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
		target.focus();
	}
</script>

<Dialog.Root bind:open={clear.open}>
	<Dialog.Content
		showCloseButton={false}
		onCloseAutoFocus={(event) => {
			// Cleared: the button that opened the dialog is on a page that was reset.
			if (!cleared) return;
			cleared = false;
			event.preventDefault();
			focusPage();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>{m.clear_title()}</Dialog.Title>
			<Dialog.Description>
				{count === 0
					? m.clear_body_empty()
					: deleted === 0
						? m.clear_body_no_deleted({ count })
						: m.clear_body({ count, deleted })}
			</Dialog.Description>
		</Dialog.Header>
		<div>
			<Button
				variant="link"
				class="h-auto p-0"
				disabled={backingUp || clearing}
				onclick={backupFirst}
			>
				{m.clear_backup_first()}
			</Button>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (clear.open = false)}>{m.confirm_cancel()}</Button>
			<Button variant="destructive" disabled={clearing || backingUp} onclick={confirm}>
				{m.clear_confirm()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
