import type { GeolocationAccess, GeoResult } from "../types";

const REASONS = { 1: "denied", 2: "unavailable", 3: "timeout" } as const;

/**
 * The browser's geolocation. Never logs or reports the coordinates; they only go to the caller.
 */
export function createWebGeolocation(nav: Navigator = navigator): GeolocationAccess {
	return {
		locate(signal) {
			return new Promise<GeoResult>((resolve, reject) => {
				if (signal?.aborted) return reject(signal.reason);
				const geo = nav.geolocation;
				if (!geo) return resolve({ ok: false, reason: "unsupported" });
				const onAbort = () => reject(signal?.reason);
				signal?.addEventListener("abort", onAbort, { once: true });
				const done = (result: GeoResult) => {
					signal?.removeEventListener("abort", onAbort);
					resolve(result);
				};
				geo.getCurrentPosition(
					(pos) => done({ ok: true, lat: pos.coords.latitude, lon: pos.coords.longitude }),
					(err) =>
						done({
							ok: false,
							reason: REASONS[err.code as 1 | 2 | 3] ?? "unavailable"
						}),
					{ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
				);
			});
		}
	};
}
