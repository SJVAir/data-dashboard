<script lang="ts">
	import { tick } from "svelte";
	import { toast } from "svelte-sonner";
	import { restoreDeleted } from "$lib/actions/dashboard";
	import { confirmAction } from "$lib/components/dialogs/ConfirmDialog.svelte";
	import { Button } from "$lib/components/ui/button";
	import { formatDate } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { route } from "../../../router";

	const app = useApp();
	let heading = $state<HTMLElement | null>(null);

	// Arriving from the picker's "Recently deleted" entry: go to the section's heading.
	$effect(() => {
		if (route.hash !== "#recently-deleted" || !heading) return;
		heading.focus();
		heading.scrollIntoView({ block: "start" });
	});

	async function deleteNow(id: string) {
		const confirmed = await confirmAction({
			title: m.deleted_confirm_title(),
			body: m.deleted_confirm_body(),
			confirm: m.deleted_delete_now(),
			destructive: true
		});
		if (!confirmed) return;
		const position = app.index.deleted.findIndex((d) => d.id === id);
		await app.index.remove(id);
		// The row is gone: focus the next row's Restore, else the heading, else the page's.
		await tick();
		// After the dialog has closed and handed focus back (to the button that's now gone).
		await new Promise((resolve) => setTimeout(resolve, 50));
		const next = app.index.deleted[position];
		const target = next
			? document.querySelector<HTMLElement>(`[data-restore="${CSS.escape(next.id)}"]`)
			: app.index.deleted.length > 0
				? heading
				: document.getElementById("dashboards-heading");
		target?.focus();
	}

	function restore(id: string) {
		restoreDeleted(app, id).catch(() => toast.error(m.deleted_restore_failed()));
	}
</script>

<section id="recently-deleted" class="flex flex-col gap-2">
	<h2 bind:this={heading} tabindex="-1" class="text-lg font-medium outline-none">
		{m.deleted_heading()}
	</h2>
	<ul class="border-border divide-border divide-y rounded-lg border">
		{#each app.index.deleted as item (item.id)}
			{@const name = app.index.deletedNames.get(item.id) ?? ""}
			<li
				class="flex flex-wrap items-center gap-2 py-1 pr-1 pl-3"
				data-testid="deleted-row-{item.id}"
			>
				<div class="flex min-w-0 flex-1 flex-col py-1">
					<span class="truncate font-medium">{name}</span>
					<span class="text-muted-foreground text-sm">
						{m.deleted_on({ date: formatDate(new Date(item.deletedAt!)) })}
					</span>
				</div>
				<Button
					variant="outline"
					size="sm"
					aria-label={m.deleted_restore_named({ name })}
					data-restore={item.id}
					onclick={() => restore(item.id)}
				>
					{m.deleted_restore()}
				</Button>
				<Button
					variant="outline"
					size="sm"
					aria-label={m.deleted_delete_now_named({ name })}
					onclick={() => void deleteNow(item.id)}
				>
					{m.deleted_delete_now()}
				</Button>
			</li>
		{/each}
	</ul>
</section>
