<script lang="ts">
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import ExternalLink from "@lucide/svelte/icons/external-link";
	import Monitor from "@lucide/svelte/icons/monitor";
	import Moon from "@lucide/svelte/icons/moon";
	import Sun from "@lucide/svelte/icons/sun";
	import { onDestroy } from "svelte";
	import { openPrivacy } from "$lib/components/dialogs/PrivacyDialog.svelte";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { m } from "$lib/paraglide/messages.js";
	import { CONTACT_URL } from "$lib/links";
	import type { ThemeChoice } from "$lib/platform/types";
	import { useApp } from "$lib/store/app.svelte";
	import { createThemeState } from "$lib/store/theme.svelte";
	import { cn } from "$lib/utils";

	const theme = createThemeState(useApp().platform.display);
	onDestroy(() => theme.destroy());

	const themes = [
		{ value: "light", label: m.theme_light, icon: Sun },
		{ value: "dark", label: m.theme_dark, icon: Moon },
		{ value: "system", label: m.theme_system, icon: Monitor }
	] as const;
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		aria-label={m.help_menu()}
		class={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
	>
		<CircleQuestionMark aria-hidden="true" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="min-w-48">
		<DropdownMenu.Group>
			<DropdownMenu.Label>{m.theme_label()}</DropdownMenu.Label>
			<DropdownMenu.RadioGroup
				value={theme.choice}
				onValueChange={(value) => theme.set(value as ThemeChoice)}
			>
				{#each themes as { value, label, icon: Icon } (value)}
					<DropdownMenu.RadioItem {value}>
						<Icon aria-hidden="true" />
						{label()}
					</DropdownMenu.RadioItem>
				{/each}
			</DropdownMenu.RadioGroup>
		</DropdownMenu.Group>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={openPrivacy}>{m.privacy_open()}</DropdownMenu.Item>
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a {...props} href={CONTACT_URL} target="_blank" rel="noopener">
					{m.feedback_link()}
					<ExternalLink aria-hidden="true" />
					<span class="sr-only">{m.opens_in_new_tab()}</span>
				</a>
			{/snippet}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
