<script lang="ts">
	import { Router } from "sv-router";
	import { p, isActive } from "./router";
</script>

<div class="flex h-screen w-screen flex-col">
	<nav class="border-border flex gap-4 border-b px-4 py-2" aria-label="Data type">
		<a href={p("/")} class="font-medium" class:underline={isActive("/")}>Monitors</a>
		<a href={p("/hms")} class="font-medium" class:underline={isActive("/hms")}>HMS Smoke/Fire</a>
		<a
			href={p("/collocation-sites")}
			class="font-medium"
			class:underline={isActive("/collocation-sites")}>Collocation Sites</a
		>
	</nav>
	<main class="flex-1 overflow-auto">
		<Router />
	</main>
</div>
