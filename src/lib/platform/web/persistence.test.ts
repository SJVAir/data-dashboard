import { describe, expect, it } from "vitest";
import { createWebPersistence } from "./persistence";

const CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";

function nav(userAgent: string, storage?: Partial<StorageManager>) {
	return { userAgent, storage } as unknown as Navigator;
}

describe("createWebPersistence", () => {
	it("maps persisted() results", async () => {
		const make = (v: boolean) => createWebPersistence(nav(CHROME, { persisted: async () => v }));
		expect(await make(true).persisted()).toBe("protected");
		expect(await make(false).persisted()).toBe("unprotected");
		expect(await createWebPersistence(nav(CHROME)).persisted()).toBe("unknown");
	});

	it("maps request() results", async () => {
		const make = (v: boolean) => createWebPersistence(nav(CHROME, { persist: async () => v }));
		expect(await make(true).request()).toBe("protected");
		expect(await make(false).request()).toBe("unprotected");
		expect(await createWebPersistence(nav(CHROME)).request()).toBe("unknown");
	});

	it("reports unknown when the API throws", async () => {
		const p = createWebPersistence(
			nav(CHROME, {
				persisted: async () => {
					throw new Error("no");
				}
			})
		);
		expect(await p.persisted()).toBe("unknown");
	});

	it("prompts only in Firefox", () => {
		expect(createWebPersistence(nav(FIREFOX)).prompts()).toBe(true);
		expect(createWebPersistence(nav(CHROME)).prompts()).toBe(false);
		expect(createWebPersistence(nav(SAFARI)).prompts()).toBe(false);
	});
});
