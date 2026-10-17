<script lang="ts">
import { page } from '$app/state';

let {
	links,
	label,
	exact = true
}: {
	links: { href: string; label: string; active?: boolean }[];
	label: string;
	/** Match the whole path, or also any path below a link. */
	exact?: boolean;
} = $props();

function isActive(link: { href: string; active?: boolean }): boolean {
	if (link.active !== undefined) return link.active;
	const path = page.url.pathname;
	return exact ? path === link.href : path === link.href || path.startsWith(`${link.href}/`);
}
</script>

<nav
	class="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 text-sm no-scrollbar"
	aria-label={label}
>
	{#each links as link (link.href)}
		{@const active = isActive(link)}
		<a
			href={link.href}
			aria-current={active ? 'page' : undefined}
			class={[
				'rounded-md px-3 py-1 font-medium whitespace-nowrap transition-all duration-200',
				active
					? 'bg-background text-foreground shadow-sm dark:bg-input/40'
					: 'text-muted-foreground hover:text-foreground'
			]}
		>
			{link.label}
		</a>
	{/each}
</nav>
