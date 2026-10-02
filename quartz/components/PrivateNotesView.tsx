import { QuartzComponentProps } from "./types"
import { pathToRoot } from "../util/path"

// This is only a public, data-free shell. The verified owner's client reads
// private originals through authenticated, no-store APIs after sign-in.
export function PrivateNotesHub(props: QuartzComponentProps) {
  return (
    <section
      id="private-notes-app"
      class="private-notes-app"
      data-site-base={`${pathToRoot(props.fileData.slug!)}/`}
      aria-label="私密文章"
    >
      <p class="private-notes-message" role="status" aria-live="polite">
        登录后查看私密文章。
      </p>
    </section>
  )
}
