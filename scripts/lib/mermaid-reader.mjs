// Use Quartz's inline-script loader rather than serializing bundled functions:
// keepNames can inject build-time helpers into a function's toString() result.
export function adaptMermaidResource(resource, runtime) {
  if (
    resource.contentType !== "inline" ||
    !resource.script.includes('querySelectorAll("code.mermaid")') ||
    !resource.script.includes("/mermaid/11.4.0/mermaid.esm.min.mjs")
  ) {
    return resource
  }
  return { ...resource, script: runtime }
}
