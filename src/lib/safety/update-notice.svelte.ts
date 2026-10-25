export type UpdateReason = "new-version" | "chunk-failed" | "storage-upgraded" | "newer-data";

/** Why the person should reload, if they should. Once set it stays until they do. */
export class UpdateNotice {
	reason = $state<UpdateReason | null>(null);

	show(reason: UpdateReason): void {
		this.reason ??= reason;
	}
}

export const updateNotice = new UpdateNotice();
