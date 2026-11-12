import { getHMSFire, getHMSSmoke } from "@sjvair/sdk";
import { cleanFires, groupFires, type FireDetection } from "@sjvair/map-sdk";
import {
	encodeRef,
	type DataSource,
	type FireFeatureProperties,
	type MapFeatureProperties,
	type ScaleRef
} from "@sjvair/map-sdk/data";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import { todayPacific } from "$lib/format";
import type { MapDataEntry } from "./types";

const SMOKE_SCALE: ScaleRef = { dataset: "hms-smoke", entryType: "smoke-density" };
const FIRE_SCALE: ScaleRef = { dataset: "hms-fire", entryType: "fire-frp" };

type Smoke = Awaited<ReturnType<typeof getHMSSmoke>>;
type Fires = Awaited<ReturnType<typeof getHMSFire>>;
export type HmsData = { smoke: Smoke; fires: Fires };

function ready<P extends MapFeatureProperties>(
	features: FeatureCollection<Geometry, P>,
	scale: ScaleRef
): DataSource<P> {
	return { status: { state: "ready" }, features, scale };
}

/** Today's smoke plumes and fire detections: drawn everywhere, never limited by the places. */
export const hmsEntry: MapDataEntry<HmsData> = {
	id: "hms",
	async source() {
		return {
			key: `map-hms:${todayPacific()}`,
			cadence: "hour",
			fetch: async (signal) => {
				const [smoke, fires] = await Promise.all([
					getHMSSmoke(undefined, { signal }),
					getHMSFire(undefined, { signal })
				]);
				return { smoke, fires };
			}
		};
	},
	toDataSources({ smoke, fires }, { messages }) {
		const smokeName = messages("mapsdk_hms_smoke_name");
		const plumes: Feature<Geometry, MapFeatureProperties>[] = smoke.map((plume) => ({
			type: "Feature",
			geometry: plume.geometry as Geometry,
			properties: {
				refKey: encodeRef({ kind: "feature", id: plume.id }),
				name: smokeName,
				value: plume.density
			}
		}));
		const detections: FireDetection[] = fires.map((fire) => ({
			id: fire.id,
			coordinates: fire.geometry.coordinates as [number, number],
			frp: fire.frp,
			timestamp: fire.timestamp
		}));
		const detection = messages("mapsdk_hms_fire_detection");
		const hotspots: Feature<Point, MapFeatureProperties>[] = cleanFires(detections).map((fire) => ({
			type: "Feature",
			geometry: { type: "Point", coordinates: fire.coordinates },
			properties: {
				refKey: encodeRef({ kind: "feature", id: fire.id }),
				name: detection,
				value: fire.frp
			}
		}));
		// Every group names its count, a group of 1 included.
		const groups: Feature<Point, FireFeatureProperties>[] = groupFires(detections).map((group) => ({
			type: "Feature",
			geometry: { type: "Point", coordinates: group.coordinates },
			properties: {
				refKey: encodeRef({ kind: "feature", id: group.id }),
				name: messages("mapsdk_hms_fire_detections", { count: group.count }),
				value: group.avgFrp,
				count: group.count
			}
		}));
		return {
			smoke: ready({ type: "FeatureCollection", features: plumes }, SMOKE_SCALE),
			fireGroups: ready({ type: "FeatureCollection", features: groups }, FIRE_SCALE),
			fireHotspots: ready({ type: "FeatureCollection", features: hotspots }, FIRE_SCALE)
		};
	}
};
