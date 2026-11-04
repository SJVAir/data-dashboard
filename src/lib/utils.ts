import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The project's own theme-token utilities (src/app.css), which tailwind-merge would otherwise
// misread (text-field as a text color) or never treat as conflicting.
const twMerge = extendTailwindMerge({
	extend: {
		classGroups: {
			"font-size": [{ text: ["field"] }],
			shadow: [{ shadow: ["card"] }],
			duration: [{ duration: ["fast", "base"] }],
			ease: [{ ease: ["standard"] }]
		}
	}
});

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

export type WithElementRef<T, E extends HTMLElement = HTMLElement> = T & { ref?: E | null };

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;

export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;

export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
