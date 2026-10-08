import log from "electron-log";
import { firstPromptSendContracts } from "../types/first_prompt";
import { registerTrustedIpcSend } from "./trusted_handle";
import {
  firstPromptCreationRegistry,
  logFirstPromptCreationCleanupFailure,
} from "../services/first_prompt_creation_service";

const logger = log.scope("first_prompt_handlers");

export function registerFirstPromptHandlers(): void {
  registerTrustedIpcSend(
    firstPromptSendContracts.commitCreation.channel,
    (_event, input: unknown) => {
      try {
        const parsed =
          firstPromptSendContracts.commitCreation.input.parse(input);
        firstPromptCreationRegistry.commit(parsed.operationId);
      } catch (error) {
        logger.error("Ignoring invalid first-prompt commit", error);
      }
    },
    {
      onTrustFailure: (error) => {
        logger.error("Ignoring invalid first-prompt commit", error);
      },
    },
  );

  registerTrustedIpcSend(
    firstPromptSendContracts.cancelCreation.channel,
    (_event, input: unknown) => {
      try {
        const parsed =
          firstPromptSendContracts.cancelCreation.input.parse(input);
        return firstPromptCreationRegistry
          .cancel(parsed.operationId)
          .catch((error) =>
            logFirstPromptCreationCleanupFailure(parsed.operationId, error),
          );
      } catch (error) {
        logger.error("Ignoring invalid first-prompt cancellation", error);
      }
    },
    {
      onTrustFailure: (error) => {
        logger.error("Ignoring invalid first-prompt cancellation", error);
      },
    },
  );
}
