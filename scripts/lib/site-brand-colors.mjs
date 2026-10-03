const validColor = (value) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value)

const luminance = (color) => {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

const contrast = (first, second) => {
  const values = [luminance(first), luminance(second)].sort((a, b) => a - b)
  return (values[1] + 0.05) / (values[0] + 0.05)
}

// One opaque color pair for the navigation mark and every favicon format.
// Keep approved palette inks when legible; yellow and pastel plates must not
// inherit a white signal ink that only works on the palette's darker buttons.
export function brandMarkColors(mode, fallbackAccent = "#365f8b") {
  const background = [mode?.mark, mode?.signal, fallbackAccent].find(validColor) || "#365f8b"
  const foreground =
    [mode?.onSignal, mode?.text].find(
      (color) => validColor(color) && contrast(background, color) >= 4.5,
    ) ||
    (contrast(background, "#ffffff") >= contrast(background, "#000000") ? "#ffffff" : "#000000")
  return { background, foreground }
}
