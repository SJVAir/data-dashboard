import { describe, expect, it } from "vitest";
import { CONTACT_URL } from "$lib/links";
import { reportUrl } from "./report";

describe("reportUrl", () => {
	it("the report link carries the topic and the shared path", () => {
		const url = new URL(reportUrl("ab/c d"));
		expect(`${url.origin}${url.pathname}`).toBe(CONTACT_URL);
		expect(url.searchParams.get("topic")).toBe("Report");
		expect(url.searchParams.get("page")).toBe("/workspace/shared/ab/c d");
		expect(reportUrl("tok")).toBe(`${CONTACT_URL}?topic=Report&page=%2Fworkspace%2Fshared%2Ftok`);
	});
});
