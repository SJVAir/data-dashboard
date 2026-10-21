import { expect, test } from "vitest";
import { trimmedDashboardId } from "./routing";

test("paths under a dashboard go to that dashboard", () => {
	expect(trimmedDashboardId("/dashboards/abc/widgets")).toBe("abc");
	expect(trimmedDashboardId("/dashboards/abc/widgets/w1/edit")).toBe("abc");
	expect(trimmedDashboardId("/dashboards/a%20b/x")).toBe("a b");
});

test("other unknown paths go home", () => {
	expect(trimmedDashboardId("/analysis")).toBeNull();
	expect(trimmedDashboardId("/nope/abc/widgets")).toBeNull();
	expect(trimmedDashboardId("/dashboards/%E0%A4%A/x")).toBeNull();
});
