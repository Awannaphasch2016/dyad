// Response bodies are hidden unless the renderer needs the text to explain a
// known failure. Free-model quota markers let ChatErrorBox recognize that
// case. The Bedrock expiry sentence is safe to show: it does not contain the
// bearer.
const RECOGNIZED_RESPONSE_BODY_MARKERS = [
  "dyad_free_model_quota_exceeded",
  "FREE_MODEL_QUOTA_EXCEEDED",
  "Dyad Free has reached its daily limit.",
  "Dyad Free limit",
  "Bearer Token has expired",
];

export function messageWithRecognizedResponseBody(
  message: string,
  responseBody: string | undefined,
): string {
  if (!responseBody || message.includes(responseBody)) {
    return message;
  }
  const recognized = RECOGNIZED_RESPONSE_BODY_MARKERS.some((marker) =>
    responseBody.includes(marker),
  );
  if (!recognized) {
    return message;
  }
  return `${message}\n\nDetails: ${responseBody}`;
}
