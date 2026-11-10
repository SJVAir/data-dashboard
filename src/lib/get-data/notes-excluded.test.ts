import { describe, expect, it } from "vitest";
import { placesLayer } from "$lib/widgets/shared/input";
import { noteType } from "$lib/widgets/notes";
import { dataTypes, registerWidgetType } from "$lib/widgets/registry";

describe("Notes and Get data", () => {
	it("the types Get data offers exclude Notes", () => {
		registerWidgetType(noteType);
		expect(dataTypes().map((t) => t.type)).not.toContain("note");
	});

	it("the picker's region lookup finds no places layer for a Note", () => {
		// PlacePickerDialog's regionOf starts with placesLayer(data, catalog) and returns null on none.
		expect(placesLayer({ layers: [] }, undefined)).toBeUndefined();
	});
});
