import { paginationNumbers } from "../../scripts/lib/pagination.mjs"

export function Pagination({
  prefix,
  label,
  totalPages = 1,
  page = 1,
  hidden = false,
}: {
  prefix: "listing" | "memory"
  label: string
  totalPages?: number
  page?: number
  hidden?: boolean
}) {
  return (
    <nav
      class="pagination site-pagination"
      id={`${prefix}-pagination`}
      aria-label={label}
      hidden={hidden}
    >
      <div class="pagination-main">
        <button
          type="button"
          id={`${prefix}-previous`}
          data-pagination-action="previous"
          data-memory-page={prefix === "memory" ? "previous" : undefined}
          disabled={page === 1}
        >
          上一页
        </button>
        <span id={`${prefix}-pages`} class="pagination-pages" data-pagination-pages>
          {paginationNumbers(page, totalPages).map((number, index) =>
            number === null ? (
              <span class="pagination-gap" aria-hidden="true" key={`gap-${index}`}>
                …
              </span>
            ) : (
              <button
                type="button"
                data-page={number}
                aria-label={`第 ${number} 页`}
                aria-current={number === page ? "page" : undefined}
                key={number}
              >
                {number}
              </button>
            ),
          )}
        </span>
        <button
          type="button"
          id={`${prefix}-next`}
          data-pagination-action="next"
          data-memory-page={prefix === "memory" ? "next" : undefined}
          disabled={page >= totalPages}
        >
          下一页
        </button>
      </div>
      <span
        id={`${prefix}-page-state`}
        class="pagination-state"
        data-pagination-state
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {page} / {totalPages}
      </span>
      <form class="pagination-jump" data-pagination-jump noValidate>
        <label for={`${prefix}-page-input`}>跳至</label>
        <input
          id={`${prefix}-page-input`}
          data-pagination-input
          type="number"
          inputMode="numeric"
          min="1"
          max={totalPages}
          step="1"
          value={page}
          aria-label="跳转页码"
          autoComplete="off"
        />
        <span>页</span>
        <button type="submit" title="跳转到输入的页码">
          跳转
        </button>
      </form>
    </nav>
  )
}
