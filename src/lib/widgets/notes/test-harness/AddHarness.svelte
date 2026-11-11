<script lang="ts">
	import AddWidgetButton from "$lib/components/dashboard/AddWidgetButton.svelte";
	import LazyDialogs from "$lib/components/dialogs/LazyDialogs.svelte";

	// As in the app: Add widget, and the lazily loaded dialogs (the Note editor among them).
</script>

<AddWidgetButton />
<LazyDialogs />
