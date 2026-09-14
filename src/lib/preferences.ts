export interface ViewToggles {
	map: boolean;
	chart: boolean;
	spreadsheet: boolean;
}

export interface TabPreferences {
	dateRange?: { start: string; end: string };
	views?: ViewToggles;
}

interface PreferencesData {
	tabs: Record<string, TabPreferences>;
}

const STORAGE_KEY = "sjvair-dashboard-preferences";

function hasLocalStorage(): boolean {
	return typeof localStorage !== "undefined";
}

function readAll(): PreferencesData {
	if (!hasLocalStorage()) return { tabs: {} };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { tabs: {} };
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && "tabs" in parsed) {
			return parsed as PreferencesData;
		}
		return { tabs: {} };
	} catch {
		return { tabs: {} };
	}
}

function writeAll(data: PreferencesData): void {
	if (!hasLocalStorage()) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getTabPreferences(tabId: string): TabPreferences {
	return readAll().tabs[tabId] ?? {};
}

export function setTabPreferences(tabId: string, prefs: TabPreferences): void {
	const data = readAll();
	data.tabs[tabId] = { ...data.tabs[tabId], ...prefs };
	writeAll(data);
}

export function clearAllPreferences(): void {
	if (!hasLocalStorage()) return;
	localStorage.removeItem(STORAGE_KEY);
}
