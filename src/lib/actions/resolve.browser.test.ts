import { expect, test, vi } from "vitest";
import { groupItems, resolveMenu } from "./resolve";
import { menuScope, providerFor } from "./scope";
import type { MenuItem, MenuProvider } from "./types";

function item(id: string, group = "g", label = id): MenuItem {
	return { id, label, group, run: () => {} };
}

function scoped(provider: MenuProvider, parent: Element): HTMLElement {
	const el = document.createElement("div");
	menuScope(provider)(el);
	parent.append(el);
	return el;
}

test("inner items come first", () => {
	const root = document.createElement("div");
	const outer = scoped(() => [item("outer")], root);
	const inner = scoped(() => [item("inner")], outer);
	document.body.append(root);
	expect(resolveMenu(inner, { payload: {} }).map((i) => i.id)).toEqual(["inner", "outer"]);
	root.remove();
});

test("inner id overrides outer", () => {
	const root = document.createElement("div");
	const outer = scoped(() => [item("a", "g", "outer"), item("b")], root);
	const inner = scoped(() => [item("a", "g", "inner")], outer);
	const items = resolveMenu(inner, { payload: {} });
	expect(items.map((i) => i.id)).toEqual(["a", "b"]);
	expect(items[0].label).toBe("inner");
});

test("elements without providers are skipped", () => {
	const root = document.createElement("div");
	const outer = scoped(() => [item("outer")], root);
	const plain = document.createElement("span");
	outer.append(plain);
	const leaf = document.createElement("b");
	plain.append(leaf);
	expect(resolveMenu(leaf, { payload: {} }).map((i) => i.id)).toEqual(["outer"]);
});

test("providers receive the original target and shared payload", () => {
	const seen = vi.fn(() => []);
	const root = document.createElement("div");
	const outer = scoped(seen, root);
	const leaf = document.createElement("i");
	outer.append(leaf);
	resolveMenu(leaf, { payload: { x: 1 } });
	expect(seen).toHaveBeenCalledWith({ target: leaf, payload: { x: 1 } });
});

test("groups keep first-seen order", () => {
	const groups = groupItems([item("1", "b"), item("2", "a"), item("3", "b"), item("4", "a")]);
	expect(groups.map((g) => g.map((i) => i.id))).toEqual([
		["1", "3"],
		["2", "4"]
	]);
});

test("menuScope teardown removes the provider", () => {
	const el = document.createElement("div");
	const cleanup = menuScope(() => [])(el) as () => void;
	expect(providerFor(el)).toBeDefined();
	cleanup();
	expect(providerFor(el)).toBeUndefined();
});
