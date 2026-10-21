<script lang="ts">
	import { onMount } from "svelte";
	import { trimmedDashboardId } from "$lib/routing";
	import { navigate, route } from "../router";

	// Unknown and trimmed paths redirect to their section's home (no history entry).
	onMount(() => {
		const id = trimmedDashboardId(route.pathname);
		if (id) void navigate("/dashboards/:id", { params: { id }, replace: true });
		else void navigate("/", { replace: true });
	});
</script>
