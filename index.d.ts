declare module "*.scss" {
  const content: string
  export = content
}

// dom custom event
interface CustomEventMap {
  prenav: CustomEvent<{}>
  nav: CustomEvent<{ url: FullSlug }>
  themechange: CustomEvent<{ theme: "light" | "dark" }>
  readermodechange: CustomEvent<{ mode: "on" | "off" }>
  render: CustomEvent<{}>
  "howard:content-updated": CustomEvent<{
    revision: string | number
    commit?: string
    kind?: string
    articleId?: string
    removedIds?: string[]
  }>
  "howard:index-invalidated": CustomEvent<{ revision: string }>
}

type ContentIndex = Record<FullSlug, ContentDetails>
declare const fetchData: Promise<ContentIndex>
