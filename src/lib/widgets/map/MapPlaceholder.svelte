<script lang="ts">
	import type { WidgetInstance } from "$lib/documents/schema";

	let { widget }: { widget: WidgetInstance } = $props();
</script>

<div class="h-full w-full" data-widget={widget.id}></div>
