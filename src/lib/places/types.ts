import type { PlaceRef } from "$lib/data/schema";

export type RegionTypeInfo = {
	type: string;
	label: string;
	plural: string;
	count: number;
	parents: string[];
};
export type LocationTypeInfo = { type: string; label: string; source: string };

export type MonitorOption = {
	kind: "monitor";
	id: string;
	name: string;
	network: string;
	county: string;
	active: boolean;
};
export type RegionOption = {
	kind: "region";
	type: string;
	code: string;
	name: string;
	typeLabel: string;
	county: string | null;
};
export type LocationOption = {
	kind: "location";
	source: string;
	code: string;
	name: string;
	typeLabel: string;
	city: string;
	zip: string;
	address: string;
};
export type PlaceOption = MonitorOption | RegionOption | LocationOption;

export type PointPlace = Extract<PlaceRef, { kind: "point" }>;

export function refOf(option: PlaceOption): PlaceRef {
	switch (option.kind) {
		case "monitor":
			return { kind: "monitor", id: option.id };
		case "region":
			return { kind: "region", type: option.type, code: option.code };
		case "location":
			return { kind: "location", source: option.source, code: option.code };
	}
}

export function sameRef(a: PlaceRef, b: PlaceRef): boolean {
	if (a.kind === "monitor" && b.kind === "monitor") return a.id === b.id;
	if (a.kind === "region" && b.kind === "region") return a.type === b.type && a.code === b.code;
	if (a.kind === "location" && b.kind === "location") {
		return a.source === b.source && a.code === b.code;
	}
	if (a.kind === "point" && b.kind === "point") return a.lat === b.lat && a.lon === b.lon;
	return a.kind === "default-place" && b.kind === "default-place";
}
