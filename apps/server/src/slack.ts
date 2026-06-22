/**
 * Post a plain-text message to a Slack channel via its Incoming Webhook URL.
 * Each webhook URL is bound to one channel, so routing to a channel = picking
 * the URL. Slack answers `200 ok` on success and a 4xx with an error body
 * (`invalid_payload`, `no_service`, ...) on failure.
 */
export async function postSlackMessage(
	webhookUrl: string,
	text: string
): Promise<void> {
	const response = await fetch(webhookUrl, {
		body: JSON.stringify({ text }),
		headers: { "content-type": "application/json" },
		method: "POST",
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(
			`Slack webhook failed (${response.status} ${response.statusText}): ${detail}`.trim()
		);
	}
}
