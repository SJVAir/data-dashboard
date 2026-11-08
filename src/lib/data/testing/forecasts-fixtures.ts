/** `forecasts/meta/` and `forecasts/place/` responses, trimmed from the server's real shape. */

type FixtureLevel = {
	key: string;
	label: string;
	color: string;
	tier: number | null;
	min: number | null;
	max: number | null;
	value: string | null;
	opacity: number | null;
	description: string;
	guidance: string;
};

function aqiLevel(
	key: string,
	label: string,
	color: string,
	tier: number,
	min: number,
	max: number | null
): FixtureLevel {
	return {
		key,
		label,
		color,
		tier,
		min,
		max,
		value: null,
		opacity: null,
		description: "",
		guidance: ""
	};
}

function burnLevel(key: string, label: string, color: string, value: string): FixtureLevel {
	return {
		key,
		label,
		color,
		tier: null,
		min: null,
		max: null,
		value,
		opacity: null,
		description: "",
		guidance: ""
	};
}

export const FORECASTS_META = {
	scales: {
		"aqi-forecast": {
			id: "aqi-forecast",
			label: "AQI Forecast",
			units: "AQI",
			kind: "range",
			source: { name: "US EPA AirNow, AQI Basics", url: "" },
			levels: [
				aqiLevel("good", "Good", "#00e400", 0, 0, 51),
				aqiLevel("moderate", "Moderate", "#ffff00", 1, 51, 101),
				aqiLevel("unhealthy_sensitive", "Unhealthy for Sensitive Groups", "#ff7e00", 2, 101, 151),
				aqiLevel("unhealthy", "Unhealthy", "#ff0000", 3, 151, 201),
				aqiLevel("very_unhealthy", "Very Unhealthy", "#8f3f97", 4, 201, 301),
				aqiLevel("hazardous", "Hazardous", "#7e0023", 4, 301, null)
			]
		},
		"burn-status": {
			id: "burn-status",
			label: "Burn Status",
			units: "",
			kind: "category",
			source: {
				name: "San Joaquin Valley APCD, Check Before You Burn",
				url: ""
			},
			levels: [
				burnLevel("discouraged", "Burning Discouraged", "#ffff00", "Discouraged"),
				burnLevel("registered", "No Burning Unless Registered", "#ff7e00", "Registered")
			]
		}
	},
	zones: []
};

const FRESNO = { id: "r6phe", type: "county", external_id: "06019", name: "Fresno County" };

/** One forecast row as `forecasts/place/` returns it. */
export function forecastRow(
	date: string,
	issued: string,
	aqi: number,
	burn: string,
	id = `f-${date}-${issued}`
) {
	return {
		id,
		region: FRESNO,
		zone_name: "Fresno",
		forecast_date: date,
		issued_date: issued,
		published_at: `${issued}T21:45:28Z`,
		aqi_value: aqi,
		aqi_category: "Moderate",
		pollutant: "PM2.5",
		color: "#ffff00",
		burn_status: burn,
		burn_status_text: `${burn}: text`,
		air_alert: false,
		air_alert_start: null as string | null,
		air_alert_end: null as string | null
	};
}

/** A `forecasts/place/` response for Fresno County. */
export function placeResponse(forecasts: ReturnType<typeof forecastRow>[]) {
	return {
		place: { region: { type: "county", external_id: "06019", name: "Fresno County" } },
		zone: FRESNO,
		rule: "county",
		forecasts
	};
}

/** Real rows from 2–5 Nov 2026 (the 5th was issued the day before). */
export const FRESNO_FORECASTS = [
	forecastRow("2026-11-02", "2026-11-02", 53, "Discouraged"),
	forecastRow("2026-11-03", "2026-11-03", 56, "Registered"),
	forecastRow("2026-11-04", "2026-11-04", 71, "Registered"),
	forecastRow("2026-11-05", "2026-11-04", 58, "Registered")
];
