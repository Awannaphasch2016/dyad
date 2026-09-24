export type AppSidebarHoverState =
  | "start-hover:app"
  | "start-hover:settings"
  | "start-hover:library"
  | "clear-hover"
  | "no-hover";

export type AppSidebarPanel = "Apps" | "Settings" | "Library";

export type AppSidebarItemTitle = AppSidebarPanel | "Templates" | "Plugins";

export function getRouteSidebarPanel(pathname: string): AppSidebarPanel | null {
  if (
    pathname === "/" ||
    pathname.startsWith("/apps") ||
    pathname.startsWith("/app-details") ||
    pathname === "/chat"
  ) {
    return "Apps";
  }

  if (pathname.startsWith("/settings")) {
    return "Settings";
  }

  if (pathname.startsWith("/library")) {
    return "Library";
  }

  return null;
}

export function getHoverSidebarPanel(
  hoverState: AppSidebarHoverState,
): AppSidebarPanel | null {
  if (hoverState === "start-hover:app") {
    return "Apps";
  }
  if (hoverState === "start-hover:settings") {
    return "Settings";
  }
  if (hoverState === "start-hover:library") {
    return "Library";
  }
  return null;
}

export function shouldExpandSidebarForHover({
  hoverState,
  sidebarState,
  isPointerOverSidebar,
}: {
  hoverState: AppSidebarHoverState;
  sidebarState: "expanded" | "collapsed";
  isPointerOverSidebar: boolean;
}) {
  return (
    isPointerOverSidebar &&
    sidebarState === "collapsed" &&
    hoverState.startsWith("start-hover")
  );
}

export function getSelectedSidebarPanel({
  hoverState,
  sidebarState,
  pathname,
}: {
  hoverState: AppSidebarHoverState;
  sidebarState: "expanded" | "collapsed";
  pathname: string;
}): AppSidebarPanel | null {
  const hoverPanel = getHoverSidebarPanel(hoverState);
  if (hoverPanel) {
    return hoverPanel;
  }

  if (sidebarState === "expanded") {
    return getRouteSidebarPanel(pathname);
  }

  return null;
}

export function isSidebarItemActive({
  title,
  pathname,
}: {
  title: AppSidebarItemTitle;
  pathname: string;
}) {
  if (title === "Apps") {
    return getRouteSidebarPanel(pathname) === "Apps";
  }
  if (title === "Settings") {
    return pathname.startsWith("/settings");
  }
  if (title === "Library") {
    return pathname.startsWith("/library");
  }
  if (title === "Templates") {
    return pathname.startsWith("/templates");
  }
  return pathname.startsWith("/plugins");
}

/**
 * The rail icon for the page you're on stays highlighted, and so does the icon
 * for the panel the sidebar is currently showing. On a touch screen the panel
 * can open before the route changes, and that icon still needs to read as open.
 */
export function isSidebarRailHighlighted({
  title,
  pathname,
  selectedPanel,
}: {
  title: AppSidebarItemTitle;
  pathname: string;
  selectedPanel: AppSidebarPanel | null;
}): boolean {
  return isSidebarItemActive({ title, pathname }) || selectedPanel === title;
}

export function shouldShowSelectedAppChatList({
  selectedPanel,
  selectedAppId,
  pathname,
}: {
  selectedPanel: AppSidebarPanel | null;
  selectedAppId: number | null;
  pathname: string;
}) {
  if (selectedPanel !== "Apps" || selectedAppId === null) {
    return false;
  }
  return pathname.startsWith("/app-details") || pathname === "/chat";
}
