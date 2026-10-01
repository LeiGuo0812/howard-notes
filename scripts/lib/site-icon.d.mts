export interface BrandIconSettings {
  brand?: { mark?: string; name?: string }
  accent?: string
  design?: { accentColor?: string; darkAccentColor?: string }
}
export function brandIcon(settings: BrandIconSettings): {
  svg: string
  version: string
  basename: string
}
export function renderBrandIconFiles(settings: BrandIconSettings): Promise<{
  svg: string
  version: string
  basename: string
  files: Map<string, Buffer>
}>
export function brandIconLinks(settings: BrandIconSettings, base?: string): string
