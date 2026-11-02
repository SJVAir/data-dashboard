<script lang="ts">
	import { toast } from "svelte-sonner";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { RETENTION_MS } from "$lib/safety/purge";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";
	import { SIGN_IN_FOCUS, requestFocus } from "$lib/layout/focus-request.svelte";
	import {
		finishThenSignOut,
		keepFocusOnlyIfSignedOut,
		signOutAnyway,
		unsyncedReason
	} from "$lib/sync/sign-out";

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
	/** Why "Finish saving" left some unsynced (`null`: it hasn't). */
	let stillUnsynced = $state<ReturnType<typeof unsyncedReason> | null>(null);
	const reasons = {
		offline: m.sign_out_still_unsynced,
		held: m.sign_out_still_held,
		blocked: m.sign_out_still_blocked
	};

	$effect(() => {
		if (open) stillUnsynced = null;
	});

	/** While it signs out, Escape and an outside click leave it open (as Cancel does). */
	const whileBusy = (event: Event) => {
		if (busy) event.preventDefault();
	};

	async function run(action: "finish" | "anyway") {
		if (busy) return;
		busy = true;
		stillUnsynced = null;
		// The app remounts once signed out; its Sign in link takes focus then.
		requestFocus(SIGN_IN_FOCUS);
		try {
			if (action === "finish" && !(await finishThenSignOut(app))) {
				stillUnsynced = unsyncedReason(app);
				return;
			}
			if (action === "anyway") await signOutAnyway(app);
			open = false;
		} catch (error) {
			report(error, { operation: "sign-out" });
			toast.error(m.sign_out_failed());
		} finally {
			busy = false;
			keepFocusOnlyIfSignedOut(app);
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		showCloseButton={false}
		onEscapeKeydown={whileBusy}
		onInteractOutside={whileBusy}
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
			{#if stillUnsynced}{reasons[stillUnsynced]()}{/if}
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
