<script lang="ts" module>
	// The lite build leaves out tailwind-variants' own copy of tailwind-merge (it would double the
	// initial bundle's merge code); `buttonVariants` merges through `cn` instead, as before.
	import { type VariantProps, tv } from "tailwind-variants/lite";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

	const variants = tv({
		base: "aria-invalid:not-focus-visible:ring-destructive/20 dark:aria-invalid:not-focus-visible:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-(--radius-control) border border-transparent bg-clip-padding text-sm font-medium aria-invalid:not-focus-visible:ring-3 active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors duration-fast ease-standard select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
				outline: "border-border bg-card text-primary hover:bg-secondary aria-expanded:bg-secondary",
				secondary:
					"bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
				ghost:
					"hover:bg-secondary hover:text-foreground aria-expanded:bg-secondary aria-expanded:text-foreground",
				destructive: "bg-destructive/10 hover:bg-destructive/15 text-destructive",
				link: "text-link underline underline-offset-4"
			},
			size: {
				default:
					"h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
				xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-7 gap-1 px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
				icon: "size-8",
				"icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-7",
				"icon-lg": "size-9"
			}
		},
		defaultVariants: {
			variant: "default",
			size: "default"
		}
	});

	/** The button classes for a variant and size, conflicts merged (as tailwind-variants does). */
	export const buttonVariants = (props?: Parameters<typeof variants>[0]): string =>
		cn(variants(props));

	export type ButtonVariant = VariantProps<typeof variants>["variant"];
	export type ButtonSize = VariantProps<typeof variants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
