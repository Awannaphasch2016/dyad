const SHOW_OPEN_BROWSER_MIN_WIDTH_PX = 720;

const FACTORY_PREVIEW_TABS = new Set(["preview", "code"]);

/** Factory apps keep Preview and Code. The other preview tools stay off the bar. */
export function previewTabsForFactory<T extends string>(
  tabs: readonly T[],
  factory: boolean,
): T[] {
  if (!factory) return [...tabs];
  return tabs.filter((tab) => FACTORY_PREVIEW_TABS.has(tab));
}

export function isFactoryPreviewTab(tab: string): boolean {
  return FACTORY_PREVIEW_TABS.has(tab);
}

/** Puts Design beside Code when this person can use the Design panel. */
export function withDesignTab<T extends string>(
  tabs: readonly T[],
  canDesign: boolean,
  designTab: T,
): T[] {
  if (!canDesign || tabs.includes(designTab)) return [...tabs];
  const codeIndex = tabs.indexOf("code" as T);
  if (codeIndex < 0) return [...tabs, designTab];
  return [
    ...tabs.slice(0, codeIndex + 1),
    designTab,
    ...tabs.slice(codeIndex + 1),
  ];
}

export function getPreviewToolbarActionVisibility(width: number | null): {
  showOpenBrowser: boolean;
} {
  return {
    showOpenBrowser: width === null || width >= SHOW_OPEN_BROWSER_MIN_WIDTH_PX,
  };
}
