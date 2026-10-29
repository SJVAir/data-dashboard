<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";

	let { widget, fullscreen = false }: { widget: WidgetInstance; fullscreen?: boolean } = $props();
</script>

<div
	class="text-muted-foreground flex h-full items-center justify-center p-4"
	data-widget={widget.id}
	data-fullscreen={fullscreen}
>
	{m.widget_placeholder_body()}
</div>
