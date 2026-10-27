<script lang="ts" module>
	/** Where to come back to after signing in: the path and query, never the fragment. */
	export function returnPath(loc: { pathname: string; search: string }): string {
		return loc.pathname + loc.search;
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
	import { serializeSearch } from "sv-router";
	import { p, route } from "../../../router";

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
</script>

{#if identity.state === "signed-out"}
	<a href={signInHref} class={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
		{m.account_sign_in()}
	</a>
{:else if identity.state === "signed-in"}
	{@const name = displayName(identity.user.full_name)}
	{@const first = greetingName(identity.user.full_name)}
	{@const letters = initials(identity.user.full_name)}
	<DropdownMenu.Root {onOpenChange}>
		<DropdownMenu.Trigger
			aria-label={name ? m.account_menu_for({ name }) : m.account_menu()}
			class="border-border bg-muted text-foreground focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-full border text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none"
		>
			{#if letters}
				<span aria-hidden="true">{letters}</span>
			{:else}
				<UserRound class="size-4" aria-hidden="true" />
			{/if}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="min-w-56">
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
