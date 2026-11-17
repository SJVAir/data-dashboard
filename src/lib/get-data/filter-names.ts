import type { PesticideFilters } from "$lib/data/schema";
import { m } from "$lib/paraglide/messages.js";

/** Each pesticide filter's name, as Get data's filters show it (and the Map's notes name it). */
export const PESTICIDE_FILTER_NAMES: Record<keyof PesticideFilters, () => string> = {
	chemical: m.get_data_filter_chemical,
	commodity: m.get_data_filter_crop,
	product: m.get_data_filter_product,
	category: m.get_data_filter_category,
	iarcGroup: m.get_data_filter_iarc,
	method: m.get_data_filter_method,
	narrow: m.get_data_filter_narrow
};
