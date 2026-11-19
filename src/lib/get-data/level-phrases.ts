import type { Level } from "$lib/data/dataset-rules";
import { m } from "$lib/paraglide/messages.js";

/** A level's name, as the Data resolution control shows it ("Monthly"). */
export const LEVEL_LABEL: Record<Level, () => string> = {
	raw: () => m.get_data_resolution_raw(),
	hour: () => m.get_data_resolution_hour(),
	day: () => m.get_data_resolution_day(),
	month: () => m.get_data_resolution_month(),
	year: () => m.get_data_resolution_year()
};

/** A level as it reads mid-sentence ("isn't reported hourly", "can't show monthly data"). */
export const LEVEL_LOWER: Record<Level, () => string> = {
	raw: () => m.get_data_resolution_level_raw(),
	hour: () => m.get_data_resolution_level_hour(),
	day: () => m.get_data_resolution_level_day(),
	month: () => m.get_data_resolution_level_month(),
	year: () => m.get_data_resolution_level_year()
};

/** How a dataset is reported at a level ("reported by month"). */
export const LEVEL_BY: Record<Level, () => string> = {
	raw: () => m.get_data_resolution_by_raw(),
	hour: () => m.get_data_resolution_by_hour(),
	day: () => m.get_data_resolution_by_day(),
	month: () => m.get_data_resolution_by_month(),
	year: () => m.get_data_resolution_by_year()
};
