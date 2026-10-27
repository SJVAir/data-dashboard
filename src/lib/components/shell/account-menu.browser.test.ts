import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Identity } from "$lib/account/identity";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { returnPath } from "./AccountMenu.svelte";
import { navigate } from "../../../router";
import TopNav from "./TopNav.svelte";

const user = (full_name: string): Identity => ({
	state: "signed-in",
	user: { id: 1, full_name } as never
});

async function setup(initial: Identity) {
	const identity = createMemoryIdentity(initial);
	const platform = createMemoryPlatform({ identity });
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	await render(TopNav, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { identity };
}

test("signed out shows a Sign in link carrying the current path", async () => {
	await setup({ state: "signed-out" });
	const link = page.getByRole("link", { name: "Sign in" });
	await expect.element(link).toBeVisible();
	const expected = `/account/login/?next=${encodeURIComponent(returnPath(location))}`;
	await expect.element(link).toHaveAttribute("href", expected);
});

test("sign-in link never carries the fragment", () => {
	expect(returnPath({ pathname: "/workspace/import", search: "" })).toBe("/workspace/import");
	expect(returnPath({ pathname: "/workspace/a", search: "?x=1" })).toBe("/workspace/a?x=1");
});

test("home comes back as /workspace/, the form every server answers", () => {
	expect(returnPath({ pathname: "/workspace", search: "" })).toBe("/workspace/");
	expect(returnPath({ pathname: "/workspace", search: "?x=1" })).toBe("/workspace/?x=1");
	expect(returnPath({ pathname: "/workspace/", search: "" })).toBe("/workspace/");
	expect(returnPath({ pathname: "/workspaces", search: "" })).toBe("/workspaces");
});

test("unknown shows neither Sign in nor the account button", async () => {
	await setup({ state: "unknown" });
	await expect.element(page.getByRole("button", { name: "Help" })).toBeVisible();
	expect(page.getByRole("link", { name: "Sign in" }).elements()).toHaveLength(0);
	expect(page.getByRole("button", { name: /Account menu/ }).elements()).toHaveLength(0);
});

test("signed in shows initials and a menu that re-checks on open", async () => {
	const { identity } = await setup(user("Maria Lopez"));
	const button = page.getByRole("button", { name: "ML, account menu for Maria Lopez" });
	await expect.element(button).toHaveTextContent("ML");
	const before = identity.requests;
	await button.click();
	await expect.element(page.getByText("Hi, Maria")).toBeVisible();
	await expect.element(page.getByText("Signed in as Maria Lopez")).toBeVisible();
	const settings = page.getByRole("menuitem", { name: "Account settings" });
	await expect.element(settings).toHaveAttribute("href", "/account/");
	await expect.element(settings).toHaveAttribute("target", "_blank");
	expect(settings.element().getAttribute("rel")).toContain("noopener");
	await expect.element(page.getByRole("menuitem", { name: "Your data and privacy" })).toBeVisible();
	await expect.element(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
	expect(identity.requests).toBe(before + 1);
});

test("an empty name gives a generic button and greeting", async () => {
	await setup(user(""));
	const button = page.getByRole("button", { name: "Account menu", exact: true });
	await expect.element(button).toBeVisible();
	expect(button.element().querySelector("svg")).not.toBeNull();
	await button.click();
	await expect.element(page.getByText("Hi!")).toBeVisible();
	await expect.element(page.getByText("You're signed in")).toBeVisible();
});

test("keyboard: Enter opens, ArrowDown to Sign out, Enter signs out", async () => {
	const { identity } = await setup(user("Maria Lopez"));
	const button = page.getByRole("button", { name: "ML, account menu for Maria Lopez" });
	button.element().focus();
	await userEvent.keyboard("{Enter}");
	await expect.element(page.getByRole("menuitem", { name: "Account settings" })).toBeVisible();
	for (let i = 0; i < 5 && document.activeElement?.textContent !== "Sign out"; i++) {
		await userEvent.keyboard("{ArrowDown}");
		await new Promise((r) => setTimeout(r, 50));
	}
	expect(document.activeElement?.textContent).toBe("Sign out");
	await userEvent.keyboard("{Enter}");
	await expect.poll(() => identity.current().state).toBe("signed-out");
	// The trigger that had focus is gone; focus lands on Sign in, not <body> (WCAG 2.4.3).
	await expect.element(page.getByRole("link", { name: "Sign in" })).toHaveFocus();
});

test("a menu-open re-check that finds the session gone moves focus to Sign in", async () => {
	const { identity } = await setup(user("Maria Lopez"));
	identity.setServer({ state: "signed-out" });
	const button = page.getByRole("button", { name: "ML, account menu for Maria Lopez" });
	button.element().focus();
	await userEvent.keyboard("{Enter}");
	await expect.poll(() => identity.current().state).toBe("signed-out");
	await expect.element(page.getByRole("link", { name: "Sign in" })).toHaveFocus();
});

test("a sign-out while focus is elsewhere leaves focus alone", async () => {
	const { identity } = await setup(user("Maria Lopez"));
	const help = page.getByRole("button", { name: "Help" });
	help.element().focus();
	await identity.signOut();
	await expect.element(page.getByRole("link", { name: "Sign in" })).toBeVisible();
	await expect.element(help).toHaveFocus();
});

test("becomes the Sign in link when the identity changes to signed out", async () => {
	const { identity } = await setup(user("Maria Lopez"));
	await expect
		.element(page.getByRole("button", { name: "ML, account menu for Maria Lopez" }))
		.toBeVisible();
	await identity.signOut();
	await expect.element(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("the Sign in href follows client-side navigation", async () => {
	await setup({ state: "signed-out" });
	const link = page.getByRole("link", { name: "Sign in" });
	await navigate("/dashboards");
	await expect
		.element(link)
		.toHaveAttribute("href", `/account/login/?next=${encodeURIComponent("/workspace/dashboards")}`);
	await navigate("/import");
	await expect
		.element(link)
		.toHaveAttribute("href", `/account/login/?next=${encodeURIComponent("/workspace/import")}`);
});
