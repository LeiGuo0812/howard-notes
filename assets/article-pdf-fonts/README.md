# PDF fonts

Unmodified Noto Sans SC Regular and Bold are distributed under the SIL Open Font License 1.1 in `LICENSE`.

Source: [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/SC), fixed commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c`.

`provenance.json` records exact file sizes and SHA-256 checksums. The build copies these files to the site's own `maintenance-assets/article-pdf-fonts/` directory. They are fetched only when exporting a PDF, and the PDF embeds a subset of the used glyphs. Reading articles and exporting PNG or Markdown do not request these fonts.
