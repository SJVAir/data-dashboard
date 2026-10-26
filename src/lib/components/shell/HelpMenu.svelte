<script lang="ts">
	import CircleQuestionMark from "@lucide/svelte/icons/circle-question-mark";
	import { openPrivacy } from "$lib/components/dialogs/PrivacyDialog.svelte";
	import { buttonVariants } from "$lib/components/ui/button";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
	import { m } from "$lib/paraglide/messages.js";
	import { cn } from "$lib/utils";

	const FEEDBACK_URL = "https://www.sjvair.com/contact/";
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		aria-label={m.help_menu()}
		class={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
	>
		<CircleQuestionMark aria-hidden="true" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="min-w-48">
		<DropdownMenu.Item onSelect={openPrivacy}>{m.privacy_open()}</DropdownMenu.Item>
		<DropdownMenu.Item>
			{#snippet child({ props })}
				<a {...props} href={FEEDBACK_URL} target="_blank" rel="noopener">{m.feedback_link()}</a>
			{/snippet}
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
