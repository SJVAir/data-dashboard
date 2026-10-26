import { describe, expect, it } from "vitest";
import { resolveBuildId } from "./build-info.ts";

describe("resolveBuildId", () => {
	it("is dev when serving", () => {
		expect(resolveBuildId("serve", {}, () => "abc")).toBe("dev");
	});
	it("prefers BUILD_ID", () => {
		expect(resolveBuildId("build", { BUILD_ID: "x" }, () => "z")).toBe("x");
	});
	it("then GITHUB_SHA", () => {
		expect(resolveBuildId("build", { GITHUB_SHA: "y" }, () => "z")).toBe("y");
	});
	it("then the git head", () => {
		expect(resolveBuildId("build", {}, () => "z")).toBe("z");
	});
	it("throws when nothing is found", () => {
		expect(() => resolveBuildId("build", {}, () => undefined)).toThrow(/unknown/);
	});
});
