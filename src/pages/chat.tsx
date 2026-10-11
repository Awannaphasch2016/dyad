import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { ChatPanel } from "../components/ChatPanel";
import { PreviewPanel } from "../components/preview_panel/PreviewPanel";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isPreviewOpenAtom, isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { useChats } from "@/hooks/useChats";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  chatTabSessionStorageAtom,
  selectedChatIdAtom,
} from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { phaseFromTitle, previewOpenForPhase } from "@/lib/factoryPhase";
import { Button } from "@/components/ui/button";
import {
  chatRouteConfirmPlan,
  isMissingChatOrAppError,
  restoredChatCandidateIds,
} from "./chatMissingRoute";

type ChatRouteGate =
  | { kind: "checking"; key: string }
  | { kind: "ready"; key: string; chatId: number; appId: number }
  | { kind: "missing"; key: string }
  | { kind: "error"; key: string }
  | { kind: "passthrough"; key: string };

const DEFAULT_CHAT_PANEL_SIZE = 50;

export default function ChatPage() {
  const { t } = useTranslation("chat");
  const { id: chatId, appId: routeAppId } = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const storedSession = useAtomValue(chatTabSessionStorageAtom);
  const candidates = useMemo(
    () =>
      restoredChatCandidateIds({
        urlChatId: chatId,
        openChatIds: storedSession.openChatIds,
        selectedChatId: storedSession.selectedChatId,
      }),
    [chatId, storedSession.openChatIds, storedSession.selectedChatId],
  );
  const candidateKey = candidates.join(",");
  const [gate, setGate] = useState<ChatRouteGate>({
    kind: "checking",
    key: "",
  });
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const [isResizing, setIsResizing] = useState(false);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { chats, loading } = useChats(selectedAppId);
  const loadedChatKey = chats
    .map((chat) => `${chat.id}:${chat.appId}`)
    .join(",");
  const confirmPlan = useMemo(
    () =>
      chatRouteConfirmPlan({
        candidates,
        loadedChats: chats,
        listLoading: loading,
      }),
    [candidateKey, candidates, chats, loadedChatKey, loading],
  );
  const confirmKey =
    confirmPlan.action === "open"
      ? `open:${confirmPlan.chatId}:${confirmPlan.appId}`
      : confirmPlan.action;
  const confirmPlanRef = useRef(confirmPlan);
  confirmPlanRef.current = confirmPlan;
  const previousSizeRef = useRef<number>(DEFAULT_CHAT_PANEL_SIZE);
  const isInitialMountRef = useRef(true);
  const selectedAppIdRef = useRef(selectedAppId);

  useEffect(() => {
    selectedAppIdRef.current = selectedAppId;
  }, [selectedAppId]);

  useEffect(() => {
    const plan = confirmPlanRef.current;
    if (plan.action === "passthrough") {
      setGate({ kind: "passthrough", key: candidateKey });
      return;
    }
    if (plan.action === "open") {
      const opened = plan;
      setGate({
        kind: "ready",
        key: candidateKey,
        chatId: opened.chatId,
        appId: opened.appId,
      });
      if (chatId !== opened.chatId || routeAppId !== opened.appId) {
        void navigate({
          to: "/chat",
          search: { id: opened.chatId, appId: opened.appId },
          replace: true,
        });
      }
      return;
    }
    if (plan.action === "wait") {
      setGate({ kind: "checking", key: candidateKey });
      return;
    }
    let cancelled = false;
    setGate({ kind: "checking", key: candidateKey });
    void (async () => {
      let missing = false;
      for (const id of candidates) {
        try {
          const chat = await ipc.chat.getChat(id);
          if (cancelled) return;
          setSelectedChatId(chat.id);
          selectedAppIdRef.current = chat.appId;
          setSelectedAppId(chat.appId);
          setGate({
            kind: "ready",
            key: candidateKey,
            chatId: chat.id,
            appId: chat.appId,
          });
          if (chatId !== chat.id || routeAppId !== chat.appId) {
            void navigate({
              to: "/chat",
              search: { id: chat.id, appId: chat.appId },
              replace: true,
            });
          }
          return;
        } catch (error) {
          if (!isMissingChatOrAppError(error)) {
            if (!cancelled) setGate({ kind: "error", key: candidateKey });
            return;
          }
          missing = true;
        }
      }
      if (cancelled || !missing) return;
      setGate({ kind: "missing", key: candidateKey });
    })();
    return () => {
      cancelled = true;
    };
  }, [
    candidateKey,
    candidates,
    chatId,
    confirmKey,
    navigate,
    routeAppId,
    setSelectedAppId,
    setSelectedChatId,
  ]);

  useEffect(() => {
    if (gate.kind === "ready" && gate.key === candidateKey) {
      setSelectedChatId(gate.chatId);
      return;
    }
    if (
      (gate.kind === "error" || gate.kind === "passthrough") &&
      gate.key === candidateKey
    ) {
      setSelectedChatId(chatId ?? null);
    }
  }, [candidateKey, chatId, gate, setSelectedChatId]);

  useEffect(() => {
    if (chatId || loading) {
      return;
    }

    if (!selectedAppId) {
      navigate({ to: "/", replace: true });
      return;
    }

    if (chats.length) {
      // Not a real navigation, just a redirect, when the user navigates to /chat
      // without a chatId, we redirect to the first chat
      setSelectedAppId(chats[0].appId);
      navigate({
        to: "/chat",
        search: { id: chats[0].id, appId: chats[0].appId },
        replace: true,
      });
      return;
    }

    navigate({
      to: "/app-details",
      search: { appId: selectedAppId },
      replace: true,
    });
  }, [chatId, chats, loading, navigate, selectedAppId, setSelectedAppId]);

  useEffect(() => {
    if (gate.kind === "missing") {
      return;
    }
    if (gate.kind === "ready") {
      if (gate.appId !== selectedAppIdRef.current) {
        selectedAppIdRef.current = gate.appId;
        setSelectedAppId(gate.appId);
      }
      return;
    }
    if (!chatId) {
      return;
    }

    if (routeAppId) {
      if (routeAppId !== selectedAppIdRef.current) {
        selectedAppIdRef.current = routeAppId;
        setSelectedAppId(routeAppId);
      }
      return;
    }

    // If chatId is already in our loaded chats list, selectedAppId is correct
    // for this chat (useChats filters by selectedAppId), so skip the IPC fetch.
    if (chats.some((c) => c.id === chatId)) {
      return;
    }

    let isCancelled = false;
    ipc.chat
      .getChat(chatId)
      .then((chat) => {
        if (!isCancelled && chat.appId !== selectedAppIdRef.current) {
          selectedAppIdRef.current = chat.appId;
          setSelectedAppId(chat.appId);
        }
      })
      .catch(() => {
        // Let the chat panel surface any load error for the selected chat.
      });
    return () => {
      isCancelled = true;
    };
  }, [chatId, chats, gate, routeAppId, setSelectedAppId]);

  const visibleChatId =
    confirmPlan.action === "open"
      ? confirmPlan.chatId
      : gate.kind === "ready"
        ? gate.chatId
        : chatId;
  const factoryPhase = phaseFromTitle(
    chats.find((chat) => chat.id === visibleChatId)?.title,
  );
  const gateSettled = gate.key === candidateKey;

  useEffect(() => {
    if (!factoryPhase) return;
    setIsPreviewOpen(previewOpenForPhase(factoryPhase));
  }, [factoryPhase, setIsPreviewOpen]);

  useEffect(() => {
    if (isPreviewOpen) {
      ref.current?.expand();
    } else {
      ref.current?.collapse();
    }
  }, [isPreviewOpen]);
  const ref = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);

  // Keep chat panel size in sync with hidden state (from toolbar button / other views)
  useEffect(() => {
    if (!chatPanelRef.current) return;
    // Skip the initial mount to preserve persisted panel size from autoSaveId
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (isChatPanelHidden) {
      // Save current size before collapsing
      const currentSize = chatPanelRef.current.getSize();
      if (currentSize > 5) {
        previousSizeRef.current = currentSize;
      }
      // Visually collapsed but keep a sliver so the handle is usable
      chatPanelRef.current.resize(1);
    } else {
      // Restore to previous size when re-opened via button
      chatPanelRef.current.resize(previousSizeRef.current);
    }
  }, [isChatPanelHidden]);

  if (
    confirmPlan.action === "wait" ||
    (confirmPlan.action === "ask-server" &&
      (!gateSettled || gate.kind === "checking"))
  ) {
    return (
      <p
        className="px-6 py-6 text-sm text-muted-foreground"
        data-testid="chat-route-loading"
      >
        {t("loadingChats")}
      </p>
    );
  }
  if (gateSettled && gate.kind === "missing") {
    return (
      <div
        className="flex h-full items-center justify-center p-6"
        data-testid="chat-missing-from-preview"
        role="status"
        aria-live="polite"
      >
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-lg font-semibold">
            {t("chatMissingFromPreviewTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("chatMissingFromPreviewBody")}
          </p>
          <Button
            className="min-h-11 min-w-11"
            onClick={() => {
              setSelectedChatId(null);
              setSelectedAppId(null);
              void navigate({ to: "/", replace: true });
            }}
          >
            {t("appList")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <PanelGroup autoSaveId="persistence" direction="horizontal">
      <Panel
        id="chat-panel"
        ref={chatPanelRef}
        collapsible
        minSize={1}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <div className="h-full w-full">
          {!isChatPanelHidden && (
            <ChatPanel
              chatId={visibleChatId}
              isPreviewOpen={isPreviewOpen}
              onTogglePreview={() => {
                if (factoryPhase && factoryPhase !== "implementation") {
                  setIsPreviewOpen(false);
                  ref.current?.collapse();
                  return;
                }
                setIsPreviewOpen(!isPreviewOpen);
                if (isPreviewOpen) {
                  ref.current?.collapse();
                } else {
                  ref.current?.expand();
                }
              }}
            />
          )}
        </div>
      </Panel>
      <PanelResizeHandle
        onDragging={(isDragging) => {
          setIsResizing(isDragging);
          // When dragging ends, sync the hidden state based on final width
          if (!isDragging) {
            // Small delay to let the panel settle
            requestAnimationFrame(() => {
              const panel = document.getElementById("chat-panel");
              if (panel) {
                const panelWidth = panel.getBoundingClientRect().width;
                const containerWidth =
                  panel.parentElement?.getBoundingClientRect().width || 1;
                const percentage = (panelWidth / containerWidth) * 100;
                // Consider hidden if panel is less than 5% width
                setIsChatPanelHidden(percentage < 5);
              }
            });
          }
        }}
        className={cn(
          "relative bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors cursor-col-resize",
          isChatPanelHidden ? "w-2" : "w-1",
        )}
      />

      <Panel
        collapsible
        ref={ref}
        id="preview-panel"
        minSize={20}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <PreviewPanel />
      </Panel>
    </PanelGroup>
  );
}
