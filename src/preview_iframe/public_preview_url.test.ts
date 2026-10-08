import { describe, expect, it } from "vitest";
import {
  isPreviewAppsHost,
  previewPortFromHost,
  publicPreviewUrl,
} from "./public_preview_url";

const page = "https://pre.anakwannaphaschaiyong.com/chat";

describe("publicPreviewUrl", () => {
  it("rewrites a loopback proxy to the apps hostname", () => {
    expect(publicPreviewUrl(page, "http://localhost:42103/")).toBe(
      "https://42103.apps.pre.anakwannaphaschaiyong.com/",
    );
    expect(publicPreviewUrl(page, "http://127.0.0.1:42103/about?x=1#top")).toBe(
      "https://42103.apps.pre.anakwannaphaschaiyong.com/about?x=1#top",
    );
  });

  it("leaves desktop localhost pages on the proxy url", () => {
    expect(
      publicPreviewUrl("http://127.0.0.1:8373/", "http://localhost:42103/"),
    ).toBe("http://localhost:42103/");
    expect(
      publicPreviewUrl("http://localhost:5173/", "http://localhost:42103/"),
    ).toBe("http://localhost:42103/");
  });

  it("does not publish an app port or the apex", () => {
    expect(publicPreviewUrl(page, "http://localhost:32100/")).toBe(
      "http://localhost:32100/",
    );
    expect(publicPreviewUrl(page, "http://localhost:8373/")).toBe(
      "http://localhost:8373/",
    );
    expect(publicPreviewUrl(page, null)).toBeNull();
  });
});

describe("previewPortFromHost", () => {
  it("accepts a proxy port under apps and refuses the others", () => {
    expect(
      previewPortFromHost("42103.apps.pre.anakwannaphaschaiyong.com"),
    ).toBe(42103);
    expect(
      previewPortFromHost("52110.apps.pre.anakwannaphaschaiyong.com"),
    ).toBe(52110);
    expect(
      previewPortFromHost("32100.apps.pre.anakwannaphaschaiyong.com"),
    ).toBeNull();
    expect(
      previewPortFromHost("8373.apps.pre.anakwannaphaschaiyong.com"),
    ).toBeNull();
    expect(
      previewPortFromHost("42103.apps.anakwannaphaschaiyong.com"),
    ).toBeNull();
    expect(previewPortFromHost("pre.anakwannaphaschaiyong.com")).toBeNull();
    expect(isPreviewAppsHost("32100.apps.pre.anakwannaphaschaiyong.com")).toBe(
      true,
    );
    expect(isPreviewAppsHost("pre.anakwannaphaschaiyong.com")).toBe(false);
  });
});
