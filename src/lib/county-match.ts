export function normalizeCountyName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+county$/, "");
}

export function countyMatches(monitorCounty: string, regionName: string): boolean {
	return normalizeCountyName(monitorCounty) === normalizeCountyName(regionName);
}
