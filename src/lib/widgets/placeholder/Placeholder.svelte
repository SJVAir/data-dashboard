<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";
	import { m } from "$lib/paraglide/messages.js";

	let { widget }: { widget: WidgetInstance } = $props();
</script>

<div
	class="text-muted-foreground flex h-full items-center justify-center p-4"
	data-widget={widget.id}
>
	{m.widget_placeholder_body()}
</div>
