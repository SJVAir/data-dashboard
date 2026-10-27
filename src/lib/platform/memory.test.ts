import { describe, expect, it } from "vitest";
import type { Identity } from "$lib/account/identity";
import { createMemoryIdentity, createMemoryPlatform } from "./memory";
import { runCapabilityContract } from "./capability-contract";
import { runStorageContract } from "./storage-contract";
import type { IdentityCause } from "./types";

runStorageContract("memory", async () => createMemoryPlatform());
runCapabilityContract("memory", async () => createMemoryPlatform());

const user = {
	id: "u1",
	full_name: "Maria Lopez",
	email: null,
	phone: null,
	phone_verified: false,
	language: "en"
};
const signedIn: Identity = { state: "signed-in", user };

function listen(source: ReturnType<typeof createMemoryIdentity>) {
	const heard: Array<[Identity, IdentityCause]> = [];
	source.onChange((identity, cause) => heard.push([identity, cause]));
	return heard;
}

describe("createMemoryIdentity", () => {
	it("is unknown until start, which applies the initial identity once as the load", () => {
		const source = createMemoryIdentity(signedIn);
		const heard = listen(source);
		expect(source.current()).toEqual({ state: "unknown" });
		source.start();
		source.start();
		expect(heard).toEqual([[signedIn, "load"]]);
	});

	it("defaults to signed out, and an unknown initial fires nothing", () => {
		const out = createMemoryIdentity();
		out.start();
		expect(out.current()).toEqual({ state: "signed-out" });
		const unknown = createMemoryIdentity({ state: "unknown" });
		const heard = listen(unknown);
		unknown.start();
		expect(heard).toEqual([]);
	});

	it("re-checks apply the server's answer, or nothing on an error, and count requests", async () => {
		const source = createMemoryIdentity(signedIn);
		const heard = listen(source);
		source.start();
		source.setServer("error");
		await source.recheck();
		expect(source.current()).toEqual(signedIn);
		source.setServer({ state: "signed-out" });
		await source.recheck();
		expect(heard.at(-1)).toEqual([{ state: "signed-out" }, "recheck"]);
		expect(source.requests).toBe(2);
	});

	it("accept fires cause tab only on a change", () => {
		const source = createMemoryIdentity(signedIn);
		const heard = listen(source);
		source.start();
		source.accept({ state: "signed-in", user: { ...user } });
		source.accept({ state: "signed-out" });
		expect(heard).toEqual([
			[signedIn, "load"],
			[{ state: "signed-out" }, "tab"]
		]);
	});

	it("signOut succeeds by default; a failure stays signed in and re-checks", async () => {
		const failing = createMemoryIdentity(signedIn);
		failing.start();
		failing.setSignOutResult(false);
		expect(await failing.signOut()).toBe(false);
		expect(failing.current()).toEqual(signedIn);
		expect(failing.requests).toBe(1);

		const source = createMemoryIdentity(signedIn);
		const heard = listen(source);
		source.start();
		expect(await source.signOut()).toBe(true);
		expect(heard.at(-1)).toEqual([{ state: "signed-out" }, "sign-out"]);
	});
});
