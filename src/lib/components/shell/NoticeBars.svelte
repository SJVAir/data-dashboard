<script lang="ts">
	import { downloadBackupFile } from "$lib/actions/dashboard";
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";
	import {
		REMINDER_KEY,
		shouldShowReminder,
		updateReminderPrefs,
		type ReminderPrefs
	} from "$lib/safety/reminder";
	import { BUILD_ID } from "$lib/safety/build-id";
	import { refreshEntryFiles, reloadPage } from "$lib/safety/reload";
	import { updateNotice } from "$lib/safety/update-notice.svelte";
	import { useApp } from "$lib/store/app.svelte";
	import { isActive } from "../../../router";

	const app = useApp();
	const protection = app.protection;

	async function reload() {
		try {
			await app.current.session?.flush();
		} finally {
			// The entry files have fixed names, so a cached copy could survive the reload.
			if (BUILD_ID !== "dev") await refreshEntryFiles(app.staticBase);
			reloadPage();
		}
	}

	// The backup reminder is decided once per page load, once storage protection is known and
	// a dashboard is on screen; "Not now" only hides it for this page load.
	let reminder = $state(false);
	let evaluated = false;
	const onDashboard = $derived(isActive("/") || isActive("/dashboards/:id"));

	async function prefs(): Promise<ReminderPrefs> {
		const stored = await app.platform.preferences.get<ReminderPrefs>(app.space, REMINDER_KEY);
		return typeof stored === "object" && stored !== null ? stored : {};
	}

	async function remember(change: ReminderPrefs) {
		await updateReminderPrefs(app.platform, app.space, change);
	}

	$effect(() => {
		if (evaluated || !protection.ready || !onDashboard) return;
		evaluated = true;
		void (async () => {
			try {
				const now = new Date();
				const stored = await prefs();
				if (
					shouldShowReminder({
						protection: protection.state,
						dashboards: app.index.items,
						prefs: stored,
						now
					})
				) {
					reminder = true;
					await remember({ lastShownAt: now.toISOString() });
				}
			} catch {
				// A reminder is a convenience; storage trouble is reported elsewhere.
			}
		})();
	});

	async function backup() {
		// Its job is done once the file is on its way.
		if (await downloadBackupFile(app)) reminder = false;
	}

	async function turnOff() {
		reminder = false;
		try {
			await remember({ off: true });
		} catch {
			// Hidden for this page load anyway.
		}
	}
</script>

<!-- The live regions stay mounted, so a bar that appears in one is announced. -->
<div role="status">
	{#if updateNotice.reason}
		<div
			class="border-border bg-muted text-foreground flex flex-wrap items-center justify-center gap-3 border-b px-4 py-1 text-sm"
		>
			<span>{m.update_available()}</span>
			<Button size="sm" variant="outline" onclick={reload}>{m.update_reload()}</Button>
		</div>
	{/if}
</div>

<div role="status">
	{#if reminder && onDashboard && protection.state !== "protected"}
		<div
			class="border-border bg-muted text-foreground flex flex-wrap items-center justify-center gap-3 border-b px-4 py-1 text-sm"
		>
			<span>{m.reminder_text()}</span>
			<Button size="sm" onclick={backup}>{m.backup_download()}</Button>
			{#if protection.canOfferInBar}
				<Button size="sm" variant="outline" onclick={() => protection.requestByClick()}>
					{m.protect_button()}
				</Button>
			{/if}
			<Button size="sm" variant="ghost" onclick={() => (reminder = false)}>
				{m.reminder_not_now()}
			</Button>
			<Button size="sm" variant="ghost" onclick={turnOff}>{m.reminder_off()}</Button>
		</div>
	{/if}
</div>
