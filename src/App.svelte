<script lang="ts">
	import { Router } from "sv-router";
	import { globalActions } from "$lib/actions/global";
	import { menuScope } from "$lib/actions/scope";
	import TopNav from "$lib/components/shell/TopNav.svelte";
	import { Toaster } from "$lib/components/ui/sonner";
	import { useApp } from "$lib/store/app.svelte";
	// Imported for its side effect too: it sets up the route table.
	import "./router";

	const app = useApp();
</script>

<div class="flex min-h-dvh flex-col" {@attach menuScope(globalActions(app))}>
	<TopNav />
	<main class="flex-1">
		<Router />
	</main>
</div>
<Toaster />
