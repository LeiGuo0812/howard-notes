export function formatSelection(text, start, end, command, extra = "") {
  const selected = text.slice(start, end)
  const replace = (from, to, value, a = 0, b = value.length) => ({
    text: text.slice(0, from) + value + text.slice(to),
    start: from + a,
    end: from + b,
  })
  const wrap = (left, right = left, placeholder = "文字") => {
    if (
      selected.startsWith(left) &&
      selected.endsWith(right) &&
      selected.length >= left.length + right.length
    )
      return replace(start, end, selected.slice(left.length, -right.length))
    if (
      text.slice(start - left.length, start) === left &&
      text.slice(end, end + right.length) === right
    )
      return replace(start - left.length, end + right.length, selected)
    const value = selected || placeholder
    return replace(start, end, left + value + right, left.length, left.length + value.length)
  }
  if (command === "bold") return wrap("**")
  if (command === "italic") return wrap("*")
  if (command === "strike") return wrap("~~")
  if (command === "highlight") return wrap("==")
  if (command === "inline-code") return wrap("`", "`", "code")
  if (command === "math") return wrap("$", "$", "x^2")
  if (command === "link") {
    if (!/^(https?:\/\/|mailto:|#|\.\.?\/)/i.test(extra) || /[<>\s"\u0000-\u001f]/.test(extra))
      throw new Error("请输入有效链接。")
    const label = (selected || "链接文字").replace(/[\[\]]/g, "\\$&"),
      url = extra.replace(/\(/g, "%28").replace(/\)/g, "%29")
    return replace(start, end, `[${label}](${url})`, 1, 1 + label.length)
  }
  if (["code-block", "table", "divider", "math-block", "mermaid"].includes(command)) {
    const value =
      command === "code-block"
        ? `\n\n\`\`\`${extra || "text"}\n${selected || "代码"}\n\`\`\`\n\n`
        : command === "table"
          ? "\n\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n\n"
          : command === "divider"
            ? "\n\n---\n\n"
            : command === "mermaid"
              ? "\n\n```mermaid\nflowchart LR\n  A[开始] --> B[完成]\n```\n\n"
              : `\n\n$$\n${selected || "E = mc^2"}\n$$\n\n`
    return replace(start, end, value, value.length, value.length)
  }
  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1
  const searchEnd = end > start && text[end - 1] === "\n" ? end - 1 : end
  const next = text.indexOf("\n", searchEnd),
    to = next < 0 ? text.length : next
  const lines = text.slice(from, to).split("\n")
  let changed
  if (/^h[1-6]$/.test(command))
    changed = lines.map(
      (line) => `${"#".repeat(Number(command[1]))} ${line.replace(/^#{1,6}\s+/, "")}`,
    )
  else if (command === "paragraph") changed = lines.map((line) => line.replace(/^#{1,6}\s+/, ""))
  else if (command === "quote")
    changed = lines.map((line) =>
      lines.every((s) => s.startsWith("> ")) ? line.slice(2) : "> " + line,
    )
  else if (command === "unordered" || command === "ordered" || command === "task")
    changed = lines.map(
      (line, i) =>
        `${command === "unordered" ? "- " : command === "ordered" ? `${i + 1}. ` : "- [ ] "}${line.replace(/^(?:[-*] (?:\[[ x]\] )?|\d+\. )/, "")}`,
    )
  else if (command === "indent") changed = lines.map((line) => "  " + line)
  else if (command === "outdent") changed = lines.map((line) => line.replace(/^(?: {1,2}|\t)/, ""))
  else throw new Error("未知格式操作。")
  return replace(from, to, changed.join("\n"))
}

export class TextHistory {
  constructor(text = "") {
    this.reset(text)
  }
  reset(text) {
    this.states = [{ text, start: 0, end: 0 }]
    this.index = 0
    this.lastKind = ""
    this.lastAt = 0
  }
  record(state, kind = "typing", now = Date.now()) {
    if (this.states[this.index]?.text === state.text) return
    this.states = this.states.slice(0, this.index + 1)
    if (kind === "typing" && this.lastKind === kind && now - this.lastAt < 600 && this.index > 0)
      this.states[this.index] = { ...state }
    else {
      this.states.push({ ...state })
      this.index++
      if (this.states.length > 100) {
        this.states.shift()
        this.index--
      }
    }
    this.lastKind = kind
    this.lastAt = now
  }
  undo() {
    this.lastKind = ""
    if (this.index > 0) this.index--
    return this.states[this.index]
  }
  redo() {
    this.lastKind = ""
    if (this.index < this.states.length - 1) this.index++
    return this.states[this.index]
  }
}
