<script lang="ts">
	import { m } from "$lib/paraglide/messages.js";
	import { isActive, p } from "../../../router";
	import DashboardPicker from "./DashboardPicker.svelte";
	import SavedIndicator from "./SavedIndicator.svelte";
	import UndoRedo from "./UndoRedo.svelte";
</script>

<header class="border-border bg-background border-b">
	<nav aria-label={m.nav_label()} class="flex flex-wrap items-center gap-2 px-4 py-2">
		<a href={p("/")} class="mr-2 font-semibold">{m.app_name()}</a>
		<a
			href={p("/dashboards")}
			aria-current={isActive("/dashboards") ? "page" : undefined}
			class="text-muted-foreground hover:text-foreground aria-[current=page]:text-foreground text-sm"
		>
			{m.nav_dashboards()}
		</a>
		<div class="min-w-0 flex-1 sm:flex-none"><DashboardPicker /></div>
		<div class="ml-auto flex items-center gap-2">
			<SavedIndicator />
			<UndoRedo />
		</div>
	</nav>
</header>
