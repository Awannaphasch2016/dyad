const SHOW_OPEN_BROWSER_MIN_WIDTH_PX = 720;

const FACTORY_HIDDEN_PREVIEW_TABS = new Set(["publish", "configure"]);

/** Factory apps keep Preview and Code. Publish and Configure stay off the bar. */
export function previewTabsForFactory<T extends string>(
  tabs: readonly T[],
  factory: boolean,
): T[] {
  if (!factory) return [...tabs];
  return tabs.filter((tab) => !FACTORY_HIDDEN_PREVIEW_TABS.has(tab));
}

export function getPreviewToolbarActionVisibility(width: number | null): {
  showOpenBrowser: boolean;
} {
  return {
    showOpenBrowser: width === null || width >= SHOW_OPEN_BROWSER_MIN_WIDTH_PX,
  };
}
