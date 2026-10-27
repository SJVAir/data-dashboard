<script lang="ts" module>
	import { p } from "../../../router";

	/**
	 * Where to come back to after signing in: the path and query, never the fragment. The router
	 * shows home as the bare base (`/workspace`); that comes back as `/workspace/`, the form every
	 * server answers (Vite's dev server shows a hint page for the bare base).
	 */
	export function returnPath(loc: { pathname: string; search: string }): string {
		const base = p("/").replace(/\/$/, "");
		const pathname = loc.pathname === base ? `${base}/` : loc.pathname;
		return pathname + loc.search;
	}
</script>

<script lang="ts">
	import UserRound from "@lucide/svelte/icons/user-round";
	import { displayName, greetingName, initials } from "$lib/account/names";
	import { openPrivacy } from "$lib/components/dialogs/PrivacyDialog.svelte";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { cn } from "$lib/utils";
	import { untrack } from "svelte";
	import { serializeSearch } from "sv-router";
	import { route } from "../../../router";

	const app = useApp();
	const identity = $derived(app.account.identity);
	// The router's path and query are reactive and the router adds the base path back, so this
	// follows client-side navigation and is the path the browser shows (never the fragment).
	const signInHref = $derived(
		app.platform.identity.signInUrl(
			returnPath({ pathname: p(route.pathname), search: serializeSearch(route.search) ?? "" })
		)
	);

	function onOpenChange(open: boolean) {
		if (open) app.account.recheck();
	}

	let trigger = $state<HTMLElement | null>(null);
	let content = $state<HTMLElement | null>(null);
	let signInLink = $state<HTMLAnchorElement | null>(null);
	let focusSignIn = false;

	const hasFocus = (el: HTMLElement | null) => !!el && el.contains(el.ownerDocument.activeElement);

	// Signing out (from the menu, or a menu-open re-check answering 401) removes the trigger or
	// menu that has focus, which would drop focus to <body> (WCAG 2.4.3). Before that render,
	// note whether focus is in the account control; if it is, focus Sign in once it renders. A
	// change from elsewhere (another tab) while focus is elsewhere leaves focus alone.
	$effect.pre(() => {
		if (identity.state !== "signed-out") return;
		focusSignIn = untrack(() => hasFocus(trigger) || hasFocus(content));
	});
	$effect(() => {
		if (!signInLink || !focusSignIn) return;
		focusSignIn = false;
		signInLink.focus();
	});
</script>

{#if identity.state === "signed-out"}
	<a
		bind:this={signInLink}
		href={signInHref}
		class={cn(buttonVariants({ variant: "outline", size: "sm" }))}
	>
		{m.account_sign_in()}
	</a>
{:else if identity.state === "signed-in"}
	{@const name = displayName(identity.user.full_name)}
	{@const first = greetingName(identity.user.full_name)}
	{@const letters = initials(identity.user.full_name)}
	<DropdownMenu.Root {onOpenChange}>
		<DropdownMenu.Trigger
			bind:ref={trigger}
			aria-label={name && letters
				? m.account_menu_for({ initials: letters, name })
				: m.account_menu()}
			class="border-border bg-muted text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-full border text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none"
		>
			{#if letters}
				<span aria-hidden="true">{letters}</span>
			{:else}
				<UserRound class="size-4" aria-hidden="true" />
			{/if}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content bind:ref={content} align="end" class="min-w-56">
			<DropdownMenu.Label class="text-foreground text-sm font-semibold">
				{first ? m.account_greeting({ name: first }) : m.account_greeting_unnamed()}
			</DropdownMenu.Label>
			<DropdownMenu.Label>
				{name ? m.account_signed_in_as({ name }) : m.account_signed_in_unnamed()}
			</DropdownMenu.Label>
			<DropdownMenu.Separator />
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a {...props} href={app.platform.identity.accountUrl()} target="_blank" rel="noopener">
						{m.account_settings()}
					</a>
				{/snippet}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={openPrivacy}>{m.privacy_open()}</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => void app.account.signOut()}>
				{m.account_sign_out()}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
