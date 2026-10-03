export function paginationNumbers(page: number, pages: number): Array<number | null>
export function paginationTarget(value: unknown, pages: number): number | null
export function createPagination(options: {
  prefix: string
  label: string
  document?: Document
}): HTMLElement
export function mountPagination(
  nav: HTMLElement,
  options: { onPageChange: (page: number) => void },
): {
  update(state: { page: number; pages: number; hidden?: boolean; busy?: boolean }): void
  destroy(): void
}
