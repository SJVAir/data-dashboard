import { describe, expect, it } from "vitest";
import { pickedData } from "$lib/places/apply";
import { noteType } from "$lib/widgets/notes";
import { dataTypes, registerWidgetType } from "$lib/widgets/registry";

describe("Notes and Get data", () => {
	it("the types Get data offers exclude Notes", () => {
		registerWidgetType(noteType);
		expect(dataTypes().map((t) => t.type)).not.toContain("note");
	});

	it("a Note (no layers) has no Where to change", async () => {
		// PlacePickerDialog's regionOf and pickedData both stop at data with no layers.
		const off = { liveLink: false, regionOf: async () => null };
		const county = { kind: "region", type: "county", code: "06019" } as const;
		expect(await pickedData({ layers: [] }, [county], off)).toBeNull();
	});
});
