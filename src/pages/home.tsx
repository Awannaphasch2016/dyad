import { useTranslation } from "react-i18next";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import {
  hasManuallySelectedChatModeAtom,
  homeChatInputValueAtom,
} from "../atoms/chatAtoms";
import { useSettings } from "@/hooks/useSettings";
import { useEffect, useCallback, useMemo } from "react";
import { HomeChatInput } from "@/components/chat/HomeChatInput";
import { PrivacyBanner } from "@/components/TelemetryBanner";

import type { FileAttachment } from "@/ipc/types";
import type { ListedApp } from "@/ipc/types/app";
import { type ChatMode } from "@/lib/schemas";
import {
  FREE_PRO_MODEL_FALLBACK_CHAT_MODE,
  isFreeProBuildModeCombination,
} from "@/lib/freeProModel";
import {
  useFirstPromptSaga,
  useFirstPromptSend,
} from "@/first_prompt/FirstPromptProvider";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";

// Adding an export for attachments
export interface HomeSubmitOptions {
  attachments?: FileAttachment[];
  selectedApp?: ListedApp;
}

export default function HomePage() {
  const { t } = useTranslation("home");
  const [inputValue] = useAtom(homeChatInputValueAtom);
  const firstPromptSaga = useFirstPromptSaga();
  const sendFirstPrompt = useFirstPromptSend();
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const { settings, envVars } = useSettings();
  const homeInitialChatMode = useMemo<ChatMode | undefined>(() => {
    if (!settings) {
      return undefined;
    }

    return getHomeDefaultChatMode(settings, envVars);
  }, [envVars, settings]);

  // Get the appId from search params
  const appId = search.appId ? Number(search.appId) : null;

  // Redirect to app details page if appId is present. Use `replace` so the
  // intermediate `/?appId=…` entry doesn't sit in history and trap the back
  // button on app-details in a redirect loop.
  useEffect(() => {
    if (appId) {
      navigate({ to: "/app-details", search: { appId }, replace: true });
    }
  }, [appId, navigate]);

  const hasManuallySelectedChatMode = useAtomValue(
    hasManuallySelectedChatModeAtom,
  );

  // Honor a manually picked mode (e.g. "plan") on submit; otherwise fall back
  // to the effective default so it still tracks provider/quota state. Apply the
  // Free Pro fallback for an invalid build-mode + free-pro-model combination.
  const homeSubmitChatMode = useMemo<ChatMode | undefined>(() => {
    const selected =
      hasManuallySelectedChatMode && settings?.selectedChatMode
        ? settings.selectedChatMode
        : homeInitialChatMode;
    if (
      settings &&
      isFreeProBuildModeCombination(settings.selectedModel, selected)
    ) {
      return FREE_PRO_MODEL_FALLBACK_CHAT_MODE;
    }
    return selected;
  }, [settings, homeInitialChatMode, hasManuallySelectedChatMode]);

  const handleSubmit = useCallback(
    (options?: HomeSubmitOptions) => {
      const submittedAttachments = options?.attachments ?? [];
      if (!inputValue.trim() && submittedAttachments.length === 0) return false;
      return sendFirstPrompt({
        type: "SUBMIT",
        payload: {
          prompt: inputValue,
          attachments: submittedAttachments,
          selectedApp: options?.selectedApp,
          chatMode: homeSubmitChatMode,
          isChatModeExplicit: hasManuallySelectedChatMode,
        },
      });
    },
    [
      hasManuallySelectedChatMode,
      homeSubmitChatMode,
      inputValue,
      sendFirstPrompt,
    ],
  );

  const isLoading = [
    "creating",
    "postCreate",
    "dispatching",
    "navigating",
  ].includes(firstPromptSaga.phase);
  const isCheckingProviders = firstPromptSaga.phase === "checkingProviders";

  // Loading overlay for app creation
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center max-w-3xl m-auto p-8">
        <div className="w-full flex flex-col items-center">
          {/* Loading Spinner */}
          <div className="relative w-24 h-24 mb-8">
            <div className="absolute top-0 left-0 w-full h-full border-8 border-gray-200 dark:border-gray-700 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-8 border-t-primary rounded-full animate-spin"></div>
          </div>
          <h2 className="text-2xl font-bold mb-2 text-gray-800 dark:text-gray-200">
            {firstPromptSaga.isExistingAppSubmission
              ? t("startingChat")
              : t("buildingApp")}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-center max-w-md mb-8">
            {firstPromptSaga.isExistingAppSubmission ? (
              t("creatingNewChat")
            ) : (
              <>
                {t("settingUp")} <br />
                {t("mightTakeMoment")}
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  // Main Home Page Content
  return (
    <div className="flex min-h-full w-full flex-col pb-28">
      <div className="flex flex-col items-center justify-center max-w-3xl w-full m-auto p-8 relative">
        <div className="w-full">
          <div className="mb-6 text-center">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              wewebplus
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Describe the one-page site. Discovery asks the questions, then you
              approve Implementation and Delivery.
            </p>
          </div>
          <HomeChatInput
            onSubmit={handleSubmit}
            disabled={isCheckingProviders}
            hideAccessoryControls
          />
        </div>
        <PrivacyBanner />
      </div>
    </div>
  );
}
