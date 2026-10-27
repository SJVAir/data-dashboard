<script lang="ts">
	import { m } from "$lib/paraglide/messages.js";
	import AddWidgetButton from "./AddWidgetButton.svelte";
</script>

<div
	class="border-border text-muted-foreground flex flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center"
>
	<p>{m.dashboard_empty()}</p>
	<AddWidgetButton variant="default" />
</div>
