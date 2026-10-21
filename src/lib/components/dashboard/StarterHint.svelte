<script lang="ts">
	import Info from "@lucide/svelte/icons/info";
	import { m } from "$lib/paraglide/messages.js";
</script>

<p class="bg-muted text-foreground flex items-center gap-2 rounded-lg px-4 py-2 text-sm">
	<Info aria-hidden="true" class="size-4 shrink-0" />
	{m.starter_hint()}
</p>
