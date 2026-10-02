# PDF fonts

Unmodified Noto Sans SC Regular and Bold are distributed under the SIL Open Font License 1.1 in `LICENSE`.

Source: [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/SC), fixed commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c`.

`provenance.json` records exact file sizes and SHA-256 checksums. The build copies these files to the site's own `maintenance-assets/article-pdf-fonts/` directory. They are fetched only when exporting a PDF, and the PDF embeds a subset of the used glyphs. Reading articles and exporting PNG or Markdown do not request these fonts.

PDF layout uses these same font bytes through browser `FontFace` objects before measuring text and pagination. Glyphs are drawn at their natural width without stretching each character to a different system font's width.

For Latin code, the build also copies the unmodified 27,556-byte `KaTeX_Typewriter-Regular.ttf` from the locked KaTeX 0.18.9 package (SHA-256 `f01f3e87d9c6a61c0c081ceb577abd864eb00a612f7ac1620dd6915fad2ef5aa`). Chinese code falls back to Noto Sans SC. The original font name table identifies SIL OFL 1.1, with Reserved Font Name `KaTeX_Typewriter` and copyrights of Design Science (2009–2010) and Khan Academy (2014–2018). The build publishes that notice and full OFL in `KaTeX-Typewriter-LICENSE.txt`, records checksums in `code-font-provenance.json`, and separately includes the KaTeX package's MIT license. The code font is PDF-only and is not fetched for ordinary reading or PNG/Markdown exports.
