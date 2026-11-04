<script lang="ts">
	import ExternalLinkCue from "$lib/components/shared/ExternalLinkCue.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { reportUrl } from "$lib/shared/report";

	// Always shown on a shared page, never dismissable (the owner can't remove it). It says nothing
	// about the owner but their optional display name.
	let { displayName, token }: { displayName: string | null; token: string } = $props();
</script>

<aside
	aria-label={m.shared_bar_label()}
	class="border-border bg-muted text-foreground flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 text-sm"
>
	<p>{displayName ? m.shared_by({ name: displayName }) : m.shared_by_someone()}</p>
	<p>{m.shared_not_official()}</p>
	<a
		class="text-link underline underline-offset-4"
		href={reportUrl(token)}
		target="_blank"
		rel="noopener"
		>{m.shared_report()}<ExternalLinkCue class="ms-1 inline size-3.5 align-baseline" /></a
	>
</aside>
