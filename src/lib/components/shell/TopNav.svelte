<script lang="ts">
	import logoCompact from "$lib/assets/logos/sjvair-parts/sjvair-icon.webp?no-inline";
	import logoWhite from "$lib/assets/logos/sjvair-white.svg?no-inline";
	import logo from "$lib/assets/logos/sjvair.svg?no-inline";
	import { buttonVariants } from "$lib/components/ui/button";
	import { fullscreenOpen } from "$lib/layout/fullscreen-view.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { HOME_HREF } from "$lib/routing";
	import { isActive, p } from "../../../router";
	import AccountMenu from "./AccountMenu.svelte";
	import DashboardMenuButton from "./DashboardMenuButton.svelte";
	import DashboardPicker from "./DashboardPicker.svelte";
	import HelpMenu from "./HelpMenu.svelte";
	import SavedIndicator from "./SavedIndicator.svelte";
	import UndoRedo from "./UndoRedo.svelte";

	/** A dashboard is showing: home, a saved dashboard, or a shared one. */
	const onDashboard = $derived(
		isActive("/") || isActive("/dashboards/:id") || isActive("/shared/:token")
	);
	/** The Data Portal is showing: on its own, or adding or editing a dashboard's widget. */
	const inDataPortal = $derived(
		isActive("/data") ||
			isActive("/dashboards/:id/widgets/new") ||
			isActive("/dashboards/:id/widgets/:widgetId/edit")
	);
	const views = $derived([
		{ href: HOME_HREF, label: m.nav_dashboard(), current: onDashboard },
		{ href: p("/data"), label: m.nav_data(), current: inDataPortal }
	]);
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
		</a>
		<!-- The two views, alike: the current one is underlined (a shape, not colour alone) and
		     marked for screen readers. -->
		{#each views as view (view.href)}
			<a
				href={view.href}
				aria-current={view.current ? "page" : undefined}
				class={[
					buttonVariants({ variant: "ghost" }),
					"aria-[current=page]:shadow-[inset_0_-2px_var(--color-primary)] dark:aria-[current=page]:shadow-[inset_0_-2px_var(--color-highlight)]"
				]}
			>
				{view.label}
			</a>
		{/each}
		<!-- min-w-40: on a phone the buttons on the right wrap to their own row rather than squeeze the
		     picker (its basis is 0). -->
		<div class="flex min-w-40 flex-1 items-center gap-1 sm:min-w-0 sm:flex-none">
			<DashboardPicker />
			<DashboardMenuButton />
		</div>
		<div class="ml-auto flex items-center gap-2">
			<SavedIndicator />
			<UndoRedo />
			<HelpMenu />
			<AccountMenu />
		</div>
	</nav>
</header>
