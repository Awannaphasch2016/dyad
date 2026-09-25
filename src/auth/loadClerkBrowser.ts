import { clerkFrontendHost } from "@/lib/adminAccess";

type AmdDefine = ((...args: unknown[]) => unknown) & { amd?: unknown };

function browserWindow(): Window & { define?: AmdDefine } {
  return window as Window & { define?: AmdDefine };
}

/** Monaco publishes an AMD `define`. Clerk's UMD build binds to that and never starts. */
export function hideAmdDefine(): () => void {
  const win = browserWindow();
  const define = win.define;
  if (typeof define !== "function" || !define.amd) return () => {};
  win.define = undefined;
  return () => {
    win.define = define;
  };
}

export function loadClerkBrowser(publishableKey: string): Promise<void> {
  const existing = (window as Window & { Clerk?: { load?: unknown } }).Clerk;
  if (existing && typeof existing.load === "function") return Promise.resolve();

  const host = clerkFrontendHost(publishableKey);
  if (!host)
    return Promise.reject(new Error("Clerk publishable key is invalid."));

  const restoreAmd = hideAmdDefine();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.setAttribute("data-clerk-publishable-key", publishableKey);
    script.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
    const finish = (error?: Error) => {
      restoreAmd();
      if (error) reject(error);
      else resolve();
    };
    script.addEventListener("load", () => {
      const clerk = (window as Window & { Clerk?: { load?: unknown } }).Clerk;
      if (clerk && typeof clerk.load === "function") finish();
      else finish(new Error("Clerk did not start."));
    });
    script.addEventListener("error", () => {
      finish(new Error("Clerk's sign-in script failed to load."));
    });
    document.body.appendChild(script);
  });
}
