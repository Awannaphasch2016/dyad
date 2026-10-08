import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { assertTrustedRenderer } from "../utils/renderer_security";

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => Promise<any> | any;

type TrustFailureHandler = (
  error: unknown,
  event: IpcMainInvokeEvent,
  ...args: any[]
) => Promise<any> | any;

type TrustedIpcHandlerOptions = {
  onTrustFailure?: TrustFailureHandler;
};

const trustedHandlers = new Map<string, IpcHandler>();
const trustedSendHandlers = new Map<string, IpcHandler>();

/**
 * The handler passed to {@link registerTrustedIpcHandler}, without the
 * renderer trust check. The browser bridge calls this with its own sender.
 * Desktop IPC still goes through `ipcMain` and `assertTrustedRenderer`.
 */
export function getTrustedIpcHandler(channel: string): IpcHandler | undefined {
  return trustedHandlers.get(channel);
}

/**
 * The handler passed to {@link registerTrustedIpcSend}, without the renderer
 * trust check. The browser bridge calls this for one-way sends. Desktop IPC
 * still goes through `ipcMain.on` and `assertTrustedRenderer`.
 */
export function getTrustedIpcSendHandler(
  channel: string,
): IpcHandler | undefined {
  return trustedSendHandlers.get(channel);
}

export function clearTrustedIpcHandlersForTesting(): void {
  trustedHandlers.clear();
  trustedSendHandlers.clear();
}

/**
 * Registers an invoke handler that can only be called by the trusted Dyad
 * renderer. This is the sole production entry point for `ipcMain.handle` so
 * new and legacy handlers cannot accidentally omit the renderer trust guard.
 *
 * `onTrustFailure` lets envelope-based handlers preserve their wire format.
 * Raw handlers should omit it so Electron rejects the invoke as before.
 */
export function registerTrustedIpcHandler(
  channel: string,
  handler: IpcHandler,
  options: TrustedIpcHandlerOptions = {},
): void {
  trustedHandlers.set(channel, handler);
  // Optional chaining: ipcMain is undefined in some unit-test environments.
  ipcMain?.handle(channel, async (event, ...args) => {
    try {
      assertTrustedRenderer(event);
    } catch (error) {
      if (options.onTrustFailure) {
        return options.onTrustFailure(error, event, ...args);
      }
      throw error;
    }
    return handler(event, ...args);
  });
}

/**
 * Registers a one-way send the browser bridge can deliver. Desktop callers
 * still pass `assertTrustedRenderer`. The bridge calls
 * {@link getTrustedIpcSendHandler} because `BridgeSender` has no renderer
 * frame and would fail that check.
 *
 * A trust failure is dropped. `onTrustFailure` preserves a handler's existing
 * log line. The raw handler stays responsible for invalid payloads.
 */
export function registerTrustedIpcSend(
  channel: string,
  handler: IpcHandler,
  options: TrustedIpcHandlerOptions = {},
): void {
  trustedSendHandlers.set(channel, handler);
  // `on` is optional: browser-bridge unit tests mock ipcMain with only `handle`.
  ipcMain?.on?.(channel, (event, ...args) => {
    try {
      assertTrustedRenderer(event);
    } catch (error) {
      if (options.onTrustFailure) {
        return options.onTrustFailure(error, event, ...args);
      }
      return;
    }
    return handler(event, ...args);
  });
}
