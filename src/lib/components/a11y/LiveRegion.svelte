<script lang="ts">
	import { announcer } from "$lib/a11y/announcer.svelte";
</script>

<!-- The page's one polite live region; text goes through `announce`. -->
<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">{announcer.text}</div>
