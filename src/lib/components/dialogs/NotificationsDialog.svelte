<script lang="ts">
	import { notifications } from "./lazy.svelte";
	import * as Dialog from "$lib/components/ui/dialog";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { notifyEnabled, setNotifyEnabled } from "$lib/thresholds/notify-pref";

	const app = useApp();
	const { notifications: access } = app.platform;

	let on = $state(false);
	let denied = $state(false);
	let unsupported = $state(false);

	// Each opening reads the stored value and the browser's permission afresh.
	$effect(() => {
		if (!notifications.open || notifications.docId === null) return;
		const docId = notifications.docId;
		const permission = access.permission();
		unsupported = permission === "unsupported";
		denied = permission === "denied";
		on = false;
		let current = true;
		void notifyEnabled(app.platform, app.space, docId).then((stored) => {
			if (current) on = stored && permission !== "denied" && permission !== "unsupported";
		});
		return () => (current = false);
	});

	async function change(event: Event & { currentTarget: HTMLInputElement }) {
		const box = event.currentTarget;
		const docId = notifications.docId;
		if (docId === null) return;
		if (!box.checked) {
			on = false;
			await setNotifyEnabled(app.platform, app.space, docId, false);
			return;
		}
		// Asked now, from the click, never on load.
		const answer = await access.request();
		denied = answer === "denied";
		on = answer === "granted";
		box.checked = on;
		if (on) await setNotifyEnabled(app.platform, app.space, docId, true);
	}
</script>

<Dialog.Root bind:open={notifications.open}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{m.notifications_title()}</Dialog.Title>
		</Dialog.Header>
		<div class="grid gap-3 text-sm">
			<label class="flex items-center gap-3 font-medium">
				<input
					type="checkbox"
					role="switch"
					class="accent-primary size-5"
					checked={on}
					disabled={unsupported}
					aria-describedby={unsupported ? "notifications-unsupported" : undefined}
					onchange={change}
				/>
				{m.notifications_switch_desktop()}
			</label>
			<p class="text-muted-foreground">{m.notifications_this_browser_alert_widgets()}</p>
			{#if unsupported}
				<p id="notifications-unsupported">{m.notifications_unsupported()}</p>
			{:else if denied}
				<p role="status">{m.notifications_denied()}</p>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
