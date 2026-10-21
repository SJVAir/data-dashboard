import type { Attachment } from "svelte/attachments";
import type { MenuProvider } from "./types";

const scopes = new WeakMap<Element, MenuProvider>();

/** Registers a menu provider on the element for as long as it is mounted. */
export function menuScope(provider: MenuProvider): Attachment {
	return (el) => {
		scopes.set(el, provider);
		return () => {
			if (scopes.get(el) === provider) scopes.delete(el);
		};
	};
}

export function providerFor(el: Element): MenuProvider | undefined {
	return scopes.get(el);
}
