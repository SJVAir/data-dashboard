<script lang="ts">
	import { Router } from "sv-router";
	import MenuIcon from "@lucide/svelte/icons/menu";
	import AppNav from "$lib/components/AppNav.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Sheet from "$lib/components/ui/sheet/index.js";

	let mobileNavOpen = $state(false);
</script>

<div class="flex h-screen w-screen flex-col sm:flex-row">
	<header
		class="border-border bg-background flex shrink-0 items-center gap-2 border-b px-4 py-2 sm:hidden"
	>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Open navigation"
			onclick={() => (mobileNavOpen = true)}
		>
			<MenuIcon />
		</Button>
		<span class="font-semibold">SJVAir Dashboard</span>
	</header>

	<nav
		class="border-border hidden w-56 shrink-0 overflow-y-auto border-r px-3 py-4 sm:block"
		aria-label="Data type"
	>
		<AppNav />
	</nav>

	<Sheet.Root bind:open={mobileNavOpen}>
		<Sheet.Content side="left" class="w-64 gap-0">
			<Sheet.Header>
				<Sheet.Title>SJVAir Dashboard</Sheet.Title>
			</Sheet.Header>
			<nav class="px-4" aria-label="Data type">
				<AppNav onNavigate={() => (mobileNavOpen = false)} />
			</nav>
		</Sheet.Content>
	</Sheet.Root>

	<main class="flex-1 overflow-auto">
		<Router />
	</main>
</div>
