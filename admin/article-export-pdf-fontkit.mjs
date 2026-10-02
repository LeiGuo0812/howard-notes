import fontkit from "@pdf-lib/fontkit"

/**
 * Adapt the pinned @pdf-lib/fontkit 1.1.1 CFF subset encoder for CID fonts.
 * Its CFF header uses a decoded INDEX length for offSize, and its FDSelect
 * encoder assigns repeated dictionaries to the most recently added one.
 * Noto Sans SC exercises both cases. Correct them per subset without changing
 * the dependency, the input font, or fontkit's public parsing/layout behavior.
 * Upstream: https://github.com/Hopding/fontkit (MIT; license shipped in npm).
 */
export function repairCffSubset(subset) {
  if (!subset.cff) return subset
  const originalCff = subset.cff
  subset.cff = Object.create(originalCff)
  subset.cff.length = originalCff.offSize
  if (!originalCff.isCIDFont) return subset
  subset.subsetFontdict = function (dictionary) {
    const dictionaries = []
    const indices = new Map()
    const selectors = []
    const usedSubroutines = []
    for (const glyphId of this.glyphs) {
      const originalIndex = this.cff.fdForGlyph(glyphId)
      if (originalIndex == null) throw new Error("CFF 字形缺少字体字典")
      if (!indices.has(originalIndex)) {
        indices.set(originalIndex, dictionaries.length)
        dictionaries.push({ ...this.cff.topDict.FDArray[originalIndex] })
        usedSubroutines.push({})
      }
      const subsetIndex = indices.get(originalIndex)
      selectors.push(subsetIndex)
      const glyph = this.font.getGlyph(glyphId)
      // Parsing the outline populates its local subroutine dependencies.
      void glyph.path
      for (const subroutine of Object.keys(glyph._usedSubrs || {}))
        usedSubroutines[subsetIndex][subroutine] = true
    }
    for (let index = 0; index < dictionaries.length; index++) {
      const entry = dictionaries[index]
      delete entry.FontName
      if (entry.Private?.Subrs) {
        entry.Private = {
          ...entry.Private,
          Subrs: this.subsetSubrs(entry.Private.Subrs, usedSubroutines[index]),
        }
      }
    }
    dictionary.FDArray = dictionaries
    dictionary.FDSelect = { version: 0, fds: selectors }
  }
  return subset
}

export const pdfFontkit = {
  create(bytes) {
    const font = fontkit.create(bytes)
    const createSubset = font.createSubset
    font.createSubset = function () {
      return repairCffSubset(createSubset.call(this))
    }
    return font
  },
}
