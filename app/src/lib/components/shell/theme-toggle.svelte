<script lang="ts">
import Moon from '@lucide/svelte/icons/moon';
import Sun from '@lucide/svelte/icons/sun';
import { toggleMode } from 'mode-watcher';
import { Button } from '#lib/components/ui/button/index.js';
import * as Tooltip from '#lib/components/ui/tooltip/index.js';
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({
			props
		})}
			<Button
				{...props}
				variant="ghost"
				size="icon-sm"
				onclick={toggleMode}
				aria-label="Toggle theme"
			>
				<Sun
					class="size-4 scale-100 rotate-0 transition-transform duration-300 dark:scale-0 dark:-rotate-90"
				/>
				<Moon
					class="absolute size-4 scale-0 rotate-90 transition-transform duration-300 dark:scale-100 dark:rotate-0"
				/>
			</Button>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>Toggle theme</Tooltip.Content>
</Tooltip.Root>
