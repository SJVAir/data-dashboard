import { describe, expect, test } from "vitest";
import { createMemoryPlatform } from "$lib/platform/memory";
import { StorageProtection } from "./protection.svelte";
import { REMINDER_KEY } from "./reminder";

function setup(state: "protected" | "unprotected" | "unknown", prompts: boolean) {
	const platform = createMemoryPlatform();
	platform.persistence.set(state, prompts);
	let requests = 0;
	const request = platform.persistence.request;
	platform.persistence.request = async () => {
		requests++;
		return request();
	};
	return {
		platform,
		requests: () => requests,
		protection: new StorageProtection(platform, "anonymous")
	};
}

describe("StorageProtection", () => {
	test("refresh reads the state and marks ready", async () => {
		const { protection } = setup("unprotected", false);
		await protection.refresh();
		expect(protection.state).toBe("unprotected");
		expect(protection.ready).toBe(true);
	});
	test("requestAuto requests when the browser decides silently", async () => {
		const { protection, requests } = setup("protected", false);
		await protection.requestAuto();
		expect(requests()).toBe(1);
		expect(protection.state).toBe("protected");
	});
	test("requestAuto never requests where the browser would prompt", async () => {
		const { protection, requests } = setup("unprotected", true);
		await protection.requestAuto();
		expect(requests()).toBe(0);
	});
	test("requestByClick stores a refusal", async () => {
		const { protection, platform } = setup("unprotected", true);
		await protection.requestByClick();
		expect(protection.refused).toBe(true);
		const stored = await platform.preferences.get<{ persistRefused?: boolean }>(
			"anonymous",
			REMINDER_KEY
		);
		expect(stored?.persistRefused).toBe(true);
		const later = new StorageProtection(platform, "anonymous");
		await later.refresh();
		expect(later.refused).toBe(true);
	});
	test("requestByClick does not mark a grant as refused", async () => {
		const { protection } = setup("protected", true);
		await protection.requestByClick();
		expect(protection.refused).toBe(false);
	});
});
