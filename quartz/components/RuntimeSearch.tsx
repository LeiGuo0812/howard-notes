import { Search } from "@quartz-community/search"
import type { QuartzComponent } from "./types"
// @ts-ignore Quartz compiles inline modules into an isolated browser script.
import script from "./scripts/runtime-search.inline"

export default function RuntimeSearch() {
  // Retain the upstream accessible widget and CSS; the live index also needs
  // updates and removals, rather than an append-only search index.
  const component = Search() as QuartzComponent
  component.afterDOMLoaded = script
  return component
}
