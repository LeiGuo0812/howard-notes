import type { BrandIconSettings } from "./site-icon.mjs"
export interface BrandIconOptions {
  mode?: "light" | "dark"
}
export function brandIconSvg(settings: BrandIconSettings, options?: BrandIconOptions): string
export function brandIconDataLink(settings: BrandIconSettings, options?: BrandIconOptions): string
