/** Rewrite the product name in text the person can see. */
export function productLabel(text: string): string {
  return text.replace(/\bDyad\b/g, "wewebplus");
}
