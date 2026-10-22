import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk/http", () => ({
	setOrigin: vi.fn(),
	setRequestDefaults: vi.fn()
}));

import { setOrigin, setRequestDefaults } from "@sjvair/sdk/http";
import { configureSdk } from "./sdk-setup";

describe("configureSdk", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("dev with VITE_DEV_URL uses it", () => {
		const origin = configureSdk(
			{ DEV: true, VITE_DEV_URL: "http://localhost:8000" },
			"http://localhost:5173"
		);
		expect(origin).toBe("http://localhost:8000");
		expect(setOrigin).toHaveBeenCalledWith("http://localhost:8000");
	});

	it("dev without VITE_DEV_URL falls back to the page origin", () => {
		const origin = configureSdk({ DEV: true }, "http://localhost:5173");
		expect(origin).toBe("http://localhost:5173");
		expect(setOrigin).toHaveBeenCalledWith("http://localhost:5173");
	});

	it("production uses the page origin, ignoring VITE_DEV_URL", () => {
		const origin = configureSdk({ DEV: false, VITE_DEV_URL: "x" }, "https://www.sjvair.com");
		expect(origin).toBe("https://www.sjvair.com");
		expect(setOrigin).toHaveBeenCalledWith("https://www.sjvair.com");
	});

	it("VITE_PROD_URL overrides in production", () => {
		const origin = configureSdk(
			{ DEV: false, VITE_PROD_URL: "https://staging.example" },
			"https://www.sjvair.com"
		);
		expect(origin).toBe("https://staging.example");
		expect(setOrigin).toHaveBeenCalledWith("https://staging.example");
	});

	it("sets same-origin credentials with CSRF left on", () => {
		configureSdk({ DEV: false }, "https://www.sjvair.com");
		expect(setRequestDefaults).toHaveBeenCalledTimes(1);
		expect(setRequestDefaults).toHaveBeenCalledWith({ credentials: "same-origin" });
	});
});
