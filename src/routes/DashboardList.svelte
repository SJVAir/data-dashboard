<script lang="ts">
	import Download from "@lucide/svelte/icons/download";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import FilePlus from "@lucide/svelte/icons/file-plus";
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
	import ContextMenuHost from "$lib/components/menu/ContextMenuHost.svelte";
	import { openMenuFor } from "$lib/components/menu/menu-state.svelte";
	import { Button } from "$lib/components/ui/button";
	import { formatDate } from "$lib/format";
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

	async function createBlank() {
		await navigate("/dashboards/:id", { params: { id: await app.index.createBlank() } });
	}

	async function createFromStarter() {
		await navigate("/dashboards/:id", { params: { id: await app.index.createFromStarter() } });
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
		<h1 class="text-xl font-medium">{m.dashboards_heading()}</h1>
		{#if app.index.items.length === 0}
			<p class="text-muted-foreground">{m.no_dashboards()}</p>
			{@render createButtons()}
		{:else}
			{@render createButtons()}
			<ul class="border-border divide-border divide-y rounded-lg border">
				{#each app.index.items as item (item.id)}
					{@const name = app.index.names.get(item.id) ?? ""}
					<li
						class="flex items-center gap-2 py-1 pr-1 pl-3"
						data-testid="dashboard-row-{item.id}"
						{@attach menuScope(rowActions(item.id))}
					>
						<a
							href={p("/dashboards/:id", { params: { id: item.id } })}
							class="focus-visible:ring-ring/50 flex min-w-0 flex-1 flex-col rounded-md py-1 outline-none focus-visible:ring-3"
						>
							<span class="truncate font-medium">{name}</span>
							<span class="text-muted-foreground text-sm">
								{m.dashboard_updated({ date: formatDate(new Date(item.updatedAt)) })}
							</span>
						</a>
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
			</ul>
		{/if}
		{#if app.index.deleted.length > 0}
			<RecentlyDeleted />
		{/if}
	</div>
</ContextMenuHost>
