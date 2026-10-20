<script lang="ts">
	import { onMount } from "svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";

	const app = useApp();

	onMount(() => {
		app.current = { session: null, isStarter: false };
		document.title = m.page_title_list();
	});
</script>

<!-- Task 17 renders the list of dashboards here. -->
