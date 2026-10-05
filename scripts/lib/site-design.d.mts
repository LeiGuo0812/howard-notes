export interface DesignSettings {
  palette: string
  font: "sans" | "serif" | "system"
  chineseFont: string
  englishFont: string
  fontSize: number
  lineHeight: number
  contentWidth: number
  cardGap: number
  radius: number
  accentColor: string
  darkAccentColor: string
}
export interface FontOption {
  readonly id: string
  readonly label: string
  readonly group: string
  readonly families: readonly string[]
  readonly generic: "sans-serif" | "serif" | "monospace"
}
export const CHINESE_FONTS: readonly FontOption[]
export const ENGLISH_FONTS: readonly FontOption[]
export interface PageSettings {
  homeTemplate: "classic" | "articles" | "knowledge"
  topicLayout: "list" | "cards"
  articleLayout: "wide" | "centered"
  topicPreviewCount: number
}
export const DEFAULT_DESIGN: Readonly<Omit<DesignSettings, "accentColor" | "darkAccentColor">>
export const DEFAULT_PAGES: Readonly<PageSettings>
export const ACCENT_COLORS: Readonly<Record<string, [string, string]>>
export function siteDesign(settings: unknown): DesignSettings
export function sitePages(settings: unknown): PageSettings
export function normalizeSite<T extends { home: { sections: unknown[] } }>(
  settings: T,
): T & { design: DesignSettings; pages: PageSettings }
export function sectionLimit(section: unknown): number
export function moveHomeSection(
  settings: { home: { sections: unknown[]; activityPinned?: boolean } },
  id: string,
  targetIndex: number,
): boolean
export function orderedSections<T extends { home: { sections: unknown[] } }>(
  settings: T,
): T["home"]["sections"]
export function applyHomeTemplate<T extends { home: { sections: unknown[] } }>(
  settings: T,
  template: string,
): T & { design: DesignSettings; pages: PageSettings }
export function designVariables(settings: unknown): Record<string, string>
export function designStyle(settings: unknown): string
export function applySitePalette<T extends { home: { sections: unknown[] } }>(
  settings: T,
  paletteId: string,
): T & { design: DesignSettings; pages: PageSettings }
export function applyDesignVariables(target: HTMLElement, settings: unknown): void
export function validateDesign(settings: unknown): void
