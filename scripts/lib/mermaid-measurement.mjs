// Mermaid's flow renderer looks up its SVG below document.body even when given
// a custom container. Quartz's body reconciliation is synchronous: temporarily
// park these hidden surfaces outside that subtree, then restore them before any
// asynchronous Mermaid measurement can resume. The surface never disconnects.
export function morphWithMeasurements(body, nextBody, morph) {
  const surfaces = [...body.children].filter(
    (node) => node.classList.contains("mermaid-measurement") && node.inert,
  )
  for (const surface of surfaces) body.parentElement.appendChild(surface)
  try {
    return morph(body, nextBody)
  } finally {
    for (const surface of surfaces) body.appendChild(surface)
  }
}
