import type { Platform } from "./types";

let current: Platform | undefined;

export function setPlatform(p: Platform): void {
	current = p;
}

export function platform(): Platform {
	if (!current) throw new Error("Platform adapter has not been set");
	return current;
}
