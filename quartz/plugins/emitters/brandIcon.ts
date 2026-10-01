import { QuartzEmitterPlugin } from "../types"
import { FullSlug } from "../../util/path"
import { write } from "./helpers"
import { renderBrandIconFiles } from "../../../scripts/lib/site-icon.mjs"
import settings from "../../../library/site.json"

export const BrandIcon: QuartzEmitterPlugin = () => ({
  name: "BrandIcon",
  async *emit(ctx) {
    const { files } = await renderBrandIconFiles(settings)
    for (const [filename, content] of files)
      yield await write({ ctx, slug: filename as FullSlug, ext: "", content })
  },
  async *partialEmit() {},
})
