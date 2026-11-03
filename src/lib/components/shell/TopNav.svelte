<script lang="ts">
	import logoCompact from "$lib/assets/logos/sjvair-parts/sjvair-icon.webp?no-inline";
	import logoWhite from "$lib/assets/logos/sjvair-white.svg?no-inline";
	import logo from "$lib/assets/logos/sjvair.svg?no-inline";
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
	class={["border-border bg-card border-b", fullscreenOpen() && "sticky top-0 z-(--z-fullscreen)"]}
	data-top-bar
>
	<nav aria-label={m.nav_label()} class="flex flex-wrap items-center gap-2 px-4 py-2">
		<a href={HOME_HREF} class="mr-2 flex items-center gap-2">
			<img data-logo="compact" src={logoCompact} alt="" class="size-8 sm:hidden" />
			<img data-logo="full" src={logo} alt="" class="hidden h-7 w-auto sm:block dark:sm:hidden" />
			<img data-logo="white" src={logoWhite} alt="" class="hidden h-7 w-auto dark:sm:block" />
			<span class="sr-only">{m.app_name()}</span>
			<span aria-hidden="true" class="text-primary hidden font-medium sm:inline">
				{m.app_name_product()}
			</span>
		</a>
		<a
			href={p("/dashboards")}
			aria-current={isActive("/dashboards") ? "page" : undefined}
			class="text-foreground hover:text-primary aria-[current=page]:text-primary py-1 text-sm aria-[current=page]:shadow-[inset_0_-2px_var(--color-highlight)]"
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
