import { describe, expect, test } from "vitest";
import type { DashboardSummary } from "$lib/documents/names";
import { REMINDER_INTERVAL_MS, shouldShowReminder, type ReminderPrefs } from "./reminder";

const day = (iso: string) => new Date(iso);
function dash(createdAt: string, updatedAt: string = createdAt): DashboardSummary {
	return { id: "a", name: null, copiedFrom: undefined, createdAt, updatedAt, deletedAt: undefined };
}

// Created 2026-10-01 10:00 Pacific; "now" is well after.
const created = "2026-10-01T17:00:00.000Z";
const now = day("2026-10-20T17:00:00.000Z");
const base = {
	protection: "unprotected" as const,
	dashboards: [dash(created)],
	prefs: {} as ReminderPrefs,
	now
};

describe("shouldShowReminder", () => {
	test("shows for unprotected storage with an unbacked-up dashboard on a later day", () => {
		expect(shouldShowReminder(base)).toBe(true);
	});
	test("not when protected", () => {
		expect(shouldShowReminder({ ...base, protection: "protected" })).toBe(false);
	});
	test("unknown counts as unprotected", () => {
		expect(shouldShowReminder({ ...base, protection: "unknown" })).toBe(true);
	});
	test("not without dashboards", () => {
		expect(shouldShowReminder({ ...base, dashboards: [] })).toBe(false);
	});
	test("not on the first dashboard's Pacific day, even when UTC has rolled over", () => {
		// 2026-10-02 06:00Z is 23:00 on 10-01 Pacific; created at 10-01 08:00 Pacific.
		const input = { ...base, dashboards: [dash("2026-10-01T15:00:00.000Z")] };
		expect(shouldShowReminder({ ...input, now: day("2026-10-02T06:00:00.000Z") })).toBe(false);
		// 07:30Z on 10-02 is 00:30 on 10-02 Pacific: the next Pacific day.
		expect(shouldShowReminder({ ...input, now: day("2026-10-02T07:30:00.000Z") })).toBe(true);
	});
	test("the earliest createdAt decides, not the latest", () => {
		const dashboards = [dash("2026-10-19T17:00:00.000Z"), dash(created)];
		expect(shouldShowReminder({ ...base, dashboards })).toBe(true);
	});
	test("not when turned off", () => {
		expect(shouldShowReminder({ ...base, prefs: { off: true } })).toBe(false);
	});
	test("not when nothing changed since the last backup", () => {
		const prefs = { lastBackupAt: "2026-10-10T00:00:00.000Z" };
		const dashboards = [dash(created, "2026-10-09T00:00:00.000Z")];
		expect(shouldShowReminder({ ...base, prefs, dashboards })).toBe(false);
	});
	test("shows when a dashboard changed after the last backup", () => {
		const prefs = { lastBackupAt: "2026-10-10T00:00:00.000Z" };
		const dashboards = [dash(created, "2026-10-11T00:00:00.000Z")];
		expect(shouldShowReminder({ ...base, prefs, dashboards })).toBe(true);
	});
	test("an unreadable lastShownAt counts as just shown", () => {
		expect(shouldShowReminder({ ...base, prefs: { lastShownAt: "garbage" } })).toBe(false);
		expect(shouldShowReminder({ ...base, prefs: { lastShownAt: "" } })).toBe(false);
	});
	test("an unreadable lastBackupAt counts as no backup", () => {
		expect(shouldShowReminder({ ...base, prefs: { lastBackupAt: "garbage" } })).toBe(true);
	});
	test("at most once every 14 days", () => {
		const shown = (ms: number) => ({ lastShownAt: new Date(now.getTime() - ms).toISOString() });
		const ago13 = REMINDER_INTERVAL_MS - 24 * 60 * 60 * 1000;
		expect(shouldShowReminder({ ...base, prefs: shown(ago13) })).toBe(false);
		expect(shouldShowReminder({ ...base, prefs: shown(REMINDER_INTERVAL_MS) })).toBe(true);
	});
});
