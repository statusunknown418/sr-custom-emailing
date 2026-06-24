import {
	type InstantlyReplyNotifyPayload,
	triggerInstantlyReplyNotify,
} from "@sr-custom-emailing/background";

/**
 * Enqueue the `instantly-reply-notify` task for a reply that cleared the
 * `/instantly/replies` edge filters. Lives in packages/api so the server app
 * depends only on the api package (mirrors `forwardHarvestedCommenters`),
 * keeping the background dependency out of the HTTP edge. The Worker resolves
 * the campaign's Slack channel webhook URL and passes it in the payload; this
 * layer only forwards to the task.
 *
 * @param payload - The reply context plus the resolved Slack webhook URL.
 * @returns The enqueued Trigger run id.
 */
export async function notifyInstantlyReply(
	payload: InstantlyReplyNotifyPayload
): Promise<{ taskId: string }> {
	const handle = await triggerInstantlyReplyNotify(payload);
	return { taskId: handle.id };
}
