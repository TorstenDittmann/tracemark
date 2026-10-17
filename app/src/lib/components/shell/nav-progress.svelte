<script lang="ts">
import { navigating } from '$app/state';

// Only show the bar for navigations slow enough to notice, so fast ones don't flash.
let visible = $state(false);
$effect(() => {
	if (!navigating.to) {
		visible = false;
		return;
	}
	const timer = setTimeout(() => (visible = true), 120);
	return () => clearTimeout(timer);
});
</script>

{#if visible}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
		role="progressbar"
		aria-label="Loading page"
	>
		<div
			class="h-full w-full origin-left bg-gradient-to-r from-primary/0 via-primary to-primary/0 [animation:progress_1.1s_ease-in-out_infinite]"
		></div>
	</div>
{/if}
