<script lang="ts">
	import CircleQuestionMarkIcon from "@lucide/svelte/icons/circle-question-mark";
	import * as Popover from "$lib/components/ui/popover";

	let {
		label,
		text
	}: {
		/** The button's accessible name (e.g. "About Show values"). */
		label: string;
		/** The help text, announced when it opens. */
		text: string;
	} = $props();

	let open = $state(false);
	// Focus stays on the button: the text is announced by its live region, not by moving focus.
	const keepFocus = (e: Event) => e.preventDefault();
</script>

<!-- A toggletip: a real button; click, tap, Enter or Space toggles; hover also opens it (the
text stays while the pointer is over it); Escape or an outside click closes it. -->
<!-- The live region is always rendered (empty until opened), so a screen reader announces the
text when it is set; the visible copy is aria-hidden so it isn't read twice. -->
<span class="inline-flex">
	<span role="status" class="sr-only">{open ? text : ""}</span>
	<Popover.Root bind:open>
		<Popover.Trigger
			openOnHover
			openDelay={300}
			closeDelay={300}
			aria-label={label}
			class="text-muted-foreground hover:text-foreground hover:bg-secondary focus-visible:ring-ring inline-flex size-6 shrink-0 items-center justify-center rounded-full outline-hidden focus-visible:ring-2"
		>
			<CircleQuestionMarkIcon class="size-4" aria-hidden="true" />
		</Popover.Trigger>
		<Popover.Content
			class="w-64 p-2 text-xs motion-reduce:animate-none"
			trapFocus={false}
			onOpenAutoFocus={keepFocus}
			onCloseAutoFocus={keepFocus}
		>
			<p aria-hidden="true">{text}</p>
		</Popover.Content>
	</Popover.Root>
</span>
