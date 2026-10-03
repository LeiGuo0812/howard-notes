import { compileEditorPreview } from "../runtime/editor-preview.ts"
self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: await compileEditorPreview(data.input) })
  } catch {
    self.postMessage({ id: data.id, error: "预览暂时无法生成，请检查内容后重试。" })
  }
}
