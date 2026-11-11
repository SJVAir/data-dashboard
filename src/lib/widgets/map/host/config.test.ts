import { afterEach, describe, expect, it, vi } from "vitest";
import { mapConfig } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("map config", () => {
	it("null without a key", () => {
		vi.stubEnv("VITE_MAPTILER_KEY", "");
		expect(mapConfig()).toBeNull();
	});

	it("mercator and cooperative gestures with a key", () => {
		vi.stubEnv("VITE_MAPTILER_KEY", "test-key");
		expect(mapConfig()).toEqual({
			maptilerKey: "test-key",
			projection: "mercator",
			cooperativeGestures: true,
			telemetry: false
		});
	});

	it("turns MapTiler telemetry off", () => {
		vi.stubEnv("VITE_MAPTILER_KEY", "test-key");
		expect(mapConfig()?.telemetry).toBe(false);
	});
});
