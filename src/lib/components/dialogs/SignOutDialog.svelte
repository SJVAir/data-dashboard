<script lang="ts">
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { RETENTION_MS } from "$lib/safety/purge";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";
	import { finishThenSignOut, signOutAnyway } from "$lib/sync/sign-out";

	let {
		open = $bindable(false),
		count,
		onclosed
	}: {
		open?: boolean;
		/** How many dashboards have changes not yet in the account. */
		count: number;
		/** After it closes, in place of focusing the button that opened it (which may be gone). */
		onclosed: () => void;
	} = $props();

	const app = useApp();
	const days = Math.round(RETENTION_MS / (24 * 60 * 60 * 1000));
	let busy = $state(false);
	let stillUnsynced = $state(false);

	$effect(() => {
		if (open) stillUnsynced = false;
	});

	async function run(action: "finish" | "anyway") {
		if (busy) return;
		busy = true;
		stillUnsynced = false;
		try {
			if (action === "finish" && !(await finishThenSignOut(app))) {
				stillUnsynced = true;
				return;
			}
			if (action === "anyway") await signOutAnyway(app);
			open = false;
		} catch (error) {
			report(error, { operation: "sign-out" });
			toast.error(m.sign_out_failed());
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		showCloseButton={false}
		onCloseAutoFocus={(event) => {
			event.preventDefault();
			onclosed();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>{m.sign_out_unsynced_title()}</Dialog.Title>
			<Dialog.Description>
				{m.sign_out_unsynced_body({ count: formatNumber(count), countValue: count })}
			</Dialog.Description>
			<p class="text-muted-foreground text-sm">
				{m.sign_out_unsynced_detail({ days: formatNumber(days), daysValue: days })}
			</p>
		</Dialog.Header>
		<p role="status" class="text-destructive text-sm empty:hidden">
			{#if stillUnsynced}{m.sign_out_still_unsynced()}{/if}
		</p>
		<Dialog.Footer>
			<Button
				variant="ghost"
				aria-disabled={busy}
				onclick={() => {
					if (!busy) open = false;
				}}
			>
				{m.confirm_cancel()}
			</Button>
			<Button variant="outline" aria-disabled={busy} onclick={() => run("anyway")}>
				{m.sign_out_anyway()}
			</Button>
			<Button aria-disabled={busy} onclick={() => run("finish")}>{m.sign_out_finish()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
