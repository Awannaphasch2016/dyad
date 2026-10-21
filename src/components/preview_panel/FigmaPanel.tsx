import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { canUseDesignPanel } from "@/auth/permissions";
import { useClerkSession } from "@/auth/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useChats } from "@/hooks/useChats";
import { useSelectChat } from "@/hooks/useSelectChat";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useMcp } from "@/hooks/useMcp";
import { ipc } from "@/ipc/types";
import {
  FIGMA_DESKTOP_MCP_URL,
  designTurn,
  figmaAccess,
  parseFigmaLink,
} from "@/lib/figma/design";
import { phaseFromTitle } from "@/lib/factoryPhase";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";

export function FigmaPanel() {
  const session = useClerkSession();
  const allowed = canUseDesignPanel({
    status: session.status,
    roleId: session.status === "signed-in" ? session.roleId : null,
    accountType:
      session.status === "signed-in" ? session.account?.type : undefined,
  });
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const setIsChatPanelHidden = useSetAtom(isChatPanelHiddenAtom);
  const { chats } = useChats(selectedAppId);
  const factoryPhase = phaseFromTitle(
    chats.find((chat) => chat.id === selectedChatId)?.title,
  );
  const { selectChat } = useSelectChat();
  const queryClient = useQueryClient();
  const { streamMessage } = useStreamChat({ hasChatId: false });
  const { servers, statusByServer, createServer, toggleEnabled } = useMcp();
  const [prompt, setPrompt] = useState("");
  const [linkText, setLinkText] = useState("");
  const [busy, setBusy] = useState<"generate" | "import" | "connect" | null>(
    null,
  );
  const access = figmaAccess(servers, statusByServer);
  const designQuery = useQuery({
    queryKey: queryKeys.factory.discoveryDesign(selectedAppId),
    enabled: selectedAppId != null && factoryPhase === "discovery",
    queryFn: async () => {
      if (selectedAppId == null) return { complete: false };
      return ipc.factory.getDiscoveryDesign({ appId: selectedAppId });
    },
  });
  const completeDesignMutation = useMutation({
    mutationFn: async () => {
      if (selectedAppId == null) throw new Error("No app selected");
      return ipc.factory.completeDiscoveryDesign({ appId: selectedAppId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.factory.discoveryDesign(selectedAppId),
      });
    },
    onError: (error) => {
      showError(error instanceof Error ? error.message : String(error));
    },
  });
  const designComplete = designQuery.data?.complete === true;

  const link = parseFigmaLink(linkText);
  const linkError =
    linkText.trim().length > 0 && link == null
      ? "Paste a https://www.figma.com/design/… link."
      : null;

  const send = async (intent: "generate" | "import") => {
    if (!selectedAppId) {
      showError("No app selected");
      return;
    }
    if (intent === "import" && !link) {
      showError("Paste a Figma link first.");
      return;
    }
    if (intent === "generate" && prompt.trim().length === 0) {
      showError("Describe the screen first.");
      return;
    }
    if (intent === "generate" && !access.canGenerate) {
      showError(
        "Figma only lets approved apps create files. This app is not on that list.",
      );
      return;
    }
    if (intent === "import" && !access.canImport) {
      showError(
        "Connect the Figma desktop server before building from a link.",
      );
      return;
    }
    try {
      setBusy(intent);
      let chatId = selectedChatId;
      if (chatId == null) {
        chatId = await ipc.chat.createChat(selectedAppId);
        setIsChatPanelHidden(false);
        selectChat({ chatId, appId: selectedAppId });
        void queryClient.invalidateQueries({ queryKey: queryKeys.chats.all });
      }
      const source =
        access.desktop.state === "connected" &&
        statusByServer[access.desktop.serverId] === "ok"
          ? "desktop"
          : "remote";
      await streamMessage({
        prompt: designTurn({ intent, prompt, link, source }),
        chatId,
        appId: selectedAppId,
        requestedChatMode: "local-agent",
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const connectDesktop = async () => {
    try {
      setBusy("connect");
      if (access.desktop.state === "disabled") {
        await toggleEnabled(access.desktop.serverId, false);
        return;
      }
      if (access.desktop.state === "connected") {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.mcp.toolsByServer.all,
        });
        return;
      }
      await createServer({
        name: "Figma desktop",
        transport: "http",
        url: FIGMA_DESKTOP_MCP_URL,
        enabled: true,
        oauthEnabled: false,
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const remoteLabel = access.canGenerate
    ? "Figma is connected. Generate in Figma can create a file."
    : "Figma only lets approved apps sign in to its remote server. This app is not on that list, so Generate in Figma cannot create a file.";
  const desktopLabel =
    access.desktop.state === "connected" &&
    statusByServer[access.desktop.serverId] === "ok"
      ? "Figma desktop is connected. Build from link can read the design."
      : access.desktop.state === "connected"
        ? "The Figma desktop server is not answering. In the Figma app, switch to Dev Mode and enable the desktop MCP server, then check again."
        : "To build from a link, open the Figma desktop app, switch to Dev Mode, enable the desktop MCP server, then connect it here.";

  if (!allowed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        The Design panel is for the Designer role.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <div>
        <h2 className="text-sm font-medium">Design</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Use this in Discovery to set the design, in Implementation while the
          app is built, or in Delivery to review. Describe a screen to create it
          in Figma, or paste a Figma link to build that screen here. Both go
          through the agent.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{remoteLabel}</p>
        <p className="mt-2 text-xs text-muted-foreground">{desktopLabel}</p>
        {factoryPhase === "discovery" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {designComplete
              ? "Design is complete. Discovery can be approved."
              : "When the design requirement is done, mark it complete so Discovery can close."}
          </p>
        ) : null}
      </div>
      <label className="flex flex-col gap-1 text-xs">
        What should this screen be?
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="A settings screen with a name field and a save button"
          rows={5}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Figma link
        <Input
          value={linkText}
          onChange={(event) => setLinkText(event.target.value)}
          placeholder="https://www.figma.com/design/…"
        />
      </label>
      {link ? (
        <p className="text-xs text-muted-foreground">
          File {link.fileKey}
          {link.nodeId ? `, node ${link.nodeId}` : ""}
        </p>
      ) : null}
      {linkError ? <p className="text-xs text-red-600">{linkError}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={
            busy != null || prompt.trim().length === 0 || !access.canGenerate
          }
          onClick={() => void send("generate")}
        >
          {busy === "generate" ? "Sending…" : "Generate in Figma"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy != null || link == null || !access.canImport}
          onClick={() => void send("import")}
        >
          {busy === "import" ? "Sending…" : "Build from link"}
        </Button>
        {access.canImport ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy != null}
            onClick={() => void connectDesktop()}
          >
            {busy === "connect"
              ? "Connecting…"
              : access.desktop.state === "connected"
                ? "Check Figma desktop"
                : "Connect Figma desktop"}
          </Button>
        )}
        {factoryPhase === "discovery" && !designComplete ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              busy != null ||
              completeDesignMutation.isPending ||
              designQuery.isLoading
            }
            data-testid="figma-design-complete"
            onClick={() => void completeDesignMutation.mutateAsync()}
          >
            {completeDesignMutation.isPending
              ? "Saving…"
              : "Mark design complete"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
