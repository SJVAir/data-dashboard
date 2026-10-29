<script lang="ts">
	import { fullscreenOpen } from "$lib/layout/fullscreen-view.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { HOME_HREF } from "$lib/routing";
	import { isActive, p } from "../../../router";
	import AccountMenu from "./AccountMenu.svelte";
	import DashboardPicker from "./DashboardPicker.svelte";
	import HelpMenu from "./HelpMenu.svelte";
	import SavedIndicator from "./SavedIndicator.svelte";
	import UndoRedo from "./UndoRedo.svelte";
</script>

<!-- While a widget is fullscreen it stays on screen (sticky keeps it in the flow, so the page
     doesn't move); the widget starts at its bottom. -->
<header
	class={[
		"border-border bg-background border-b",
		fullscreenOpen() && "sticky top-0 z-(--z-fullscreen)"
	]}
	data-top-bar
>
	<nav aria-label={m.nav_label()} class="flex flex-wrap items-center gap-2 px-4 py-2">
		<a href={HOME_HREF} class="mr-2 font-semibold">{m.app_name()}</a>
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
			<HelpMenu />
			<AccountMenu />
		</div>
	</nav>
</header>
