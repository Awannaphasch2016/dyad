import { describe, expect, it } from "vitest";
import { messageWithRecognizedResponseBody } from "./error_response_body";

describe("messageWithRecognizedResponseBody", () => {
  it("includes a Bedrock bearer expiry body", () => {
    const body = '{"Message":"Bearer Token has expired"}';
    expect(
      messageWithRecognizedResponseBody("AI_APICallError: Forbidden", body),
    ).toBe(`AI_APICallError: Forbidden\n\nDetails: ${body}`);
  });

  it("leaves an unrecognized body off the message", () => {
    expect(
      messageWithRecognizedResponseBody(
        "AI_APICallError: Forbidden",
        "upstream rejected the call",
      ),
    ).toBe("AI_APICallError: Forbidden");
  });
});
