<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import { m } from "$lib/paraglide/messages.js";
	import { updateNotice } from "$lib/safety/update-notice.svelte";
	import { useApp } from "$lib/store/app.svelte";

	const app = useApp();

	async function reload() {
		try {
			await app.current.session?.flush();
		} finally {
			location.reload();
		}
	}
</script>

{#if updateNotice.reason}
	<div
		role="status"
		class="border-border bg-muted text-foreground flex flex-wrap items-center justify-center gap-3 border-b px-4 py-1 text-sm"
	>
		<span>{m.update_available()}</span>
		<Button size="sm" variant="outline" onclick={reload}>{m.update_reload()}</Button>
	</div>
{/if}
