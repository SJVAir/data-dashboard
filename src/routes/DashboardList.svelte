<script lang="ts">
	import Download from "@lucide/svelte/icons/download";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import FilePlus from "@lucide/svelte/icons/file-plus";
	import HardDrive from "@lucide/svelte/icons/hard-drive";
	import Trash2 from "@lucide/svelte/icons/trash-2";
	import Upload from "@lucide/svelte/icons/upload";
	import LayoutTemplate from "@lucide/svelte/icons/layout-template";
	import { onMount } from "svelte";
	import {
		dashboardActions,
		downloadBackupFile,
		importDashboardFile
	} from "$lib/actions/dashboard";
	import type { MenuProvider } from "$lib/actions/types";
	import { menuScope } from "$lib/actions/scope";
	import RecentlyDeleted from "$lib/components/dashboard/RecentlyDeleted.svelte";
	import StorageStatus from "$lib/components/shell/StorageStatus.svelte";
	import { refusedMessage } from "$lib/components/shell/sync-messages";
	import ContextMenuHost from "$lib/components/menu/ContextMenuHost.svelte";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import { confirmAction } from "$lib/components/dialogs/ConfirmDialog.svelte";
	import { formatDate, todayPacific } from "$lib/format";
	import { platform } from "$lib/platform";
	import { dashboardFileName } from "$lib/sharing/file-names";
	import { rawDocumentFileJson } from "$lib/sharing/export";
	import { toast } from "svelte-sonner";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { navigate, p } from "../router";

	const app = useApp();

	onMount(() => {
		app.current = { session: null, isStarter: false };
		document.title = m.page_title_list();
	});

	// The same registered actions as the picker, less "Add widget" (it belongs on a dashboard).
	const rowActions =
		(id: string): MenuProvider =>
		(ctx) =>
			dashboardActions(
				app,
				id
			)(ctx).filter(
				(item) => item.group === "create" || item.group === "manage" || item.group === "share"
			);

	async function downloadUnreadable(id: string) {
		try {
			const raw = await app.platform.documents.get(app.space, id);
			if (raw === undefined) return;
			const now = new Date();
			platform().files.save(
				dashboardFileName(id, todayPacific(now)),
				rawDocumentFileJson(raw, now),
				"application/json"
			);
		} catch {
			toast.error(m.dashboard_unreadable_download_failed());
		}
	}

	/**
	 * What tells unreadable rows apart (when it was last saved, else a short reference), and the
	 * matching delete question. Two whole messages per kind, so nothing is slotted into a sentence.
	 */
	function detailOf(item: { id: string; updatedAt?: string }): { detail: string; ask: string } {
		const when = item.updatedAt ? new Date(item.updatedAt) : null;
		if (when && !Number.isNaN(when.getTime())) {
			const date = formatDate(when);
			return {
				detail: m.dashboard_unreadable_saved({ date }),
				ask: m.dashboard_unreadable_confirm_body_saved({ date })
			};
		}
		const id = item.id.slice(0, 8);
		return {
			detail: m.dashboard_unreadable_ref({ id }),
			ask: m.dashboard_unreadable_confirm_body_ref({ id })
		};
	}

	async function deleteUnreadable(id: string, ask: string) {
		const confirmed = await confirmAction({
			title: m.dashboard_unreadable_confirm_title(),
			body: ask,
			confirm: m.dashboard_unreadable_delete(),
			destructive: true,
			restoreFocus: () => document.getElementById("dashboards-heading")?.focus()
		});
		if (!confirmed) return;
		try {
			await app.index.removeUnreadable(id);
		} catch {
			toast.error(m.dashboard_unreadable_delete_failed());
		}
	}

	async function createBlank() {
		await navigate("/dashboards/:id", { params: { id: await app.index.createBlank() } });
	}

	async function createFromStarter() {
		await navigate("/dashboards/:id", {
			params: { id: await app.index.createFromStarter(app.starterPlace) }
		});
	}
</script>

{#snippet createButtons()}
	<div class="flex flex-wrap gap-2">
		<Button onclick={createBlank}>
			<FilePlus aria-hidden="true" />
			{m.dashboard_new_blank()}
		</Button>
		<Button variant="outline" onclick={createFromStarter}>
			<LayoutTemplate aria-hidden="true" />
			{m.dashboard_new_from_starter()}
		</Button>
		<Button variant="outline" onclick={() => importDashboardFile(app)}>
			<Upload aria-hidden="true" />
			{m.import_action()}
		</Button>
		{#if app.index.items.length > 0}
			<Button variant="outline" onclick={() => downloadBackupFile(app)}>
				<Download aria-hidden="true" />
				{m.backup_download()}
			</Button>
		{/if}
	</div>
{/snippet}

<ContextMenuHost>
	<div class="mx-auto flex max-w-3xl flex-col gap-4 p-4">
		<h1
			id="dashboards-heading"
			tabindex="-1"
			class="text-primary text-lg font-semibold outline-none"
		>
			{m.dashboards_heading()}
		</h1>
		{#if app.index.items.length === 0 && app.index.unreadable.length === 0}
			<p class="text-muted-foreground">{m.no_dashboards()}</p>
			{@render createButtons()}
		{:else}
			{@render createButtons()}
			<ul class="bg-card border-card-border shadow-card divide-border divide-y rounded-lg border">
				{#each app.index.items as item (item.id)}
					{@const name = app.index.names.get(item.id) ?? ""}
					{@const sync = app.sync?.states[item.id]}
					<!-- A refused save leaves it here alone, whatever older copy the account has. -->
					{@const onlyHere = !!sync && (!sync.onServer || sync.hold?.kind === "refused")}
					{@const statusId = `dashboard-status-${item.id}`}
					<li
						class="flex items-center gap-2 py-1 pr-1 pl-3"
						data-testid="dashboard-row-{item.id}"
						{@attach menuScope(rowActions(item.id))}
					>
						<div class="flex min-w-0 flex-1 flex-col">
							<a
								href={p("/dashboards/:id", { params: { id: item.id } })}
								aria-describedby={onlyHere ? statusId : undefined}
								class="flex min-w-0 flex-col rounded-(--radius-control) py-1"
							>
								<span class="truncate font-medium">{name}</span>
								<span class="text-muted-foreground text-sm">
									{m.dashboard_updated({ date: formatDate(new Date(item.updatedAt)) })}
								</span>
							</a>
							{#if onlyHere}
								<div id={statusId} class="flex flex-col pb-1">
									<span class="text-muted-foreground flex items-center gap-1 text-sm">
										<HardDrive aria-hidden="true" class="size-3.5" />
										{m.only_on_device()}
									</span>
									{#if sync?.hold?.kind === "refused"}
										<span class="text-destructive text-sm">{refusedMessage(sync.hold.code)}</span>
									{/if}
								</div>
							{/if}
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={m.dashboard_row_menu({ name })}
							onclick={(event) => openMenuFor(event.currentTarget)}
						>
							<Ellipsis aria-hidden="true" />
						</Button>
					</li>
				{/each}
				{#each app.index.unreadable as item (item.id)}
					{@const { detail, ask } = detailOf(item)}
					{@const titleId = `dashboard-unreadable-${item.id}`}
					<li class="flex items-center gap-2 py-1 pr-1 pl-3" data-testid="dashboard-row-{item.id}">
						<div class="flex min-w-0 flex-1 flex-col py-1">
							<span id={titleId} class="truncate font-medium">{m.dashboard_unreadable()}</span>
							<span id="{titleId}-detail" class="text-muted-foreground text-sm">{detail}</span>
							<span class="text-muted-foreground text-sm">{m.dashboard_unreadable_hint()}</span>
						</div>
						<Button
							variant="ghost"
							size="sm"
							aria-describedby="{titleId} {titleId}-detail"
							onclick={() => downloadUnreadable(item.id)}
						>
							<Download aria-hidden="true" />
							{m.dashboard_unreadable_download()}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							aria-describedby="{titleId} {titleId}-detail"
							onclick={() => deleteUnreadable(item.id, ask)}
						>
							<Trash2 aria-hidden="true" />
							{m.dashboard_unreadable_delete()}
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="text-sm"><StorageStatus clearable /></div>
		{#if app.index.deleted.length > 0}
			<RecentlyDeleted />
		{/if}
	</div>
</ContextMenuHost>
