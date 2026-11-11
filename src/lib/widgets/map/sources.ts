import type { ThemeColors } from "@sjvair/map-sdk";
import {
	decodeRef,
	encodeRef,
	type DataSource,
	type MapFeatureProperties
} from "@sjvair/map-sdk/data";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Frame } from "./framing";

type Collection = FeatureCollection<Geometry, MapFeatureProperties>;

/** The pin's one ref: shown, never selectable. */
export const PIN_REF = "feature:pin";

/** A `DataSource` over features that change: always ready, with no scale (neutral). */
export function featureSource(features: () => Collection): DataSource {
	return {
		status: { state: "ready" },
		get features() {
			return features();
		},
		scale: null
	};
}

/** The region shapes, by `type:code`, as features whose refs match map-sdk's `region:` refs. */
export function shapeFeatures(shapes: Map<string, Feature>): Collection {
	const features = [...shapes].flatMap(([key, shape]) => {
		const at = key.indexOf(":");
		if (at < 0 || !shape.geometry) return [];
		const ref = encodeRef({ kind: "region", type: key.slice(0, at), code: key.slice(at + 1) });
		const name = shape.properties?.name;
		return [
			{
				type: "Feature" as const,
				geometry: shape.geometry,
				properties: { refKey: ref, name: typeof name === "string" ? name : key, value: null }
			}
		];
	});
	return { type: "FeatureCollection", features };
}

/** The pin, if the frame has one, named `label`. */
export function pinFeatures(pin: Frame["pin"], label: string): Collection {
	if (!pin) return { type: "FeatureCollection", features: [] };
	return {
		type: "FeatureCollection",
		features: [
			{
				type: "Feature",
				geometry: { type: "Point", coordinates: [pin.lon, pin.lat] },
				properties: { refKey: PIN_REF, name: label, value: null }
			}
		]
	};
}

/** The positions (`[lon, lat]`) of the monitors `ids` names that `features` has. */
export function monitorPositions(
	features: FeatureCollection<Geometry, MapFeatureProperties> | null,
	ids: readonly string[]
): Map<string, [number, number]> {
	const positions = new Map<string, [number, number]>();
	if (!features || ids.length === 0) return positions;
	const wanted = new Set(ids);
	for (const f of features.features) {
		if (f.geometry?.type !== "Point") continue;
		const ref = decodeRef(f.properties.refKey);
		if (ref?.kind !== "monitor" || !wanted.has(ref.id)) continue;
		const [lon, lat] = f.geometry.coordinates;
		positions.set(ref.id, [lon, lat]);
	}
	return positions;
}

/** The pin marker's size, in px. */
const PIN_SIZE = 28;

/**
 * The pin marker: a map pin in the theme's highlight color, outlined in its foreground color,
 * with a dot in the highlight's foreground (shape and outline, not color alone, mark it).
 */
export const pinIcon = {
	size: PIN_SIZE,
	category: () => "pin",
	draw: (_category: string, _color: string, theme: ThemeColors) =>
		`<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_SIZE}" height="${PIN_SIZE}" viewBox="0 0 24 24">` +
		`<path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" fill="${theme.highlight}" ` +
		`stroke="${theme.foreground}" stroke-width="1.5" stroke-linejoin="round"/>` +
		`<circle cx="12" cy="10" r="2.5" fill="${theme.highlightForeground}"/></svg>`
};
