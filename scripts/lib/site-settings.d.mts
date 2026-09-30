export const SITE_PATH: string
export const SECTION_IDS: string[]
export const COLLECTION_IDS: string[]
export const NAV_IDS: string[]
export function validateSite<T>(settings: T): T
export function categoryId(category: string): string
export function topicList(settings: any, articles: any[]): any[]
export function collectionArticles(id: string, articles: any[]): any[]
