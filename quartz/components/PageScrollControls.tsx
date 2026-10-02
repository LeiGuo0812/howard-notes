// Shared by every public page, including the reading layout.
export function PageScrollControls() {
  return (
    <nav class="reading-scroll-controls" aria-label="页面位置">
      <button type="button" data-scroll="top" aria-label="到顶" title="到顶" data-tooltip="到顶">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
        >
          <path d="M5 4h14M6 13l6-6 6 6M12 7v13" />
        </svg>
      </button>
      <button type="button" data-scroll="bottom" aria-label="到底" title="到底" data-tooltip="到底">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
        >
          <path d="M5 20h14M6 11l6 6 6-6M12 17V4" />
        </svg>
      </button>
    </nav>
  )
}
