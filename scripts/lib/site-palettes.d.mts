export type PaletteID =
  | "current"
  | "modern-professional"
  | "lively-reliable"
  | "minimal-soft"
  | "clean-multicolor"
  | "friendly-comfort"
  | "fresh-minimal"

export interface PaletteColors {
  readonly label: string
  readonly page: string
  readonly surface: string
  readonly reader: string
  readonly text: string
  readonly muted: string
  readonly accent: string
  readonly signal: string
  readonly onSignal: string
  readonly code: string
  readonly mark?: string
  readonly line?: string
  readonly display?: string
}
export interface PaletteCategory {
  readonly bg: string
  readonly fg: string
}
export interface SitePalette {
  readonly id: Exclude<PaletteID, "current">
  readonly name: string
  readonly light: PaletteColors
  readonly dark: PaletteColors
  readonly categories?: {
    readonly light: readonly PaletteCategory[]
    readonly dark: readonly PaletteCategory[]
  }
}
export const SITE_PALETTES: readonly SitePalette[]
export function getSitePalette(selection: unknown): SitePalette | undefined
export function paletteVariables(selection: unknown): Record<string, string>
export function paletteCategory(category: string): string
