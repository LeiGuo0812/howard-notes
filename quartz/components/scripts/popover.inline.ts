import { computePosition, flip, inline, shift } from "@floating-ui/dom"
import { normalizeRelativeURLs } from "../../util/path"
import { fetchCanonical } from "./util"

const p = new DOMParser()
let activeAnchor: HTMLAnchorElement | null = null
let disposePopovers: (() => void) | undefined
let popoverGeneration = 0

async function mouseEnterHandler(
  this: HTMLAnchorElement,
  { clientX, clientY }: { clientX: number; clientY: number },
) {
  const generation = popoverGeneration
  const link = (activeAnchor = this)
  if (link.dataset.noPopover === "true") {
    return
  }

  async function setPosition(popoverElement: HTMLElement) {
    const { x, y } = await computePosition(link, popoverElement, {
      strategy: "fixed",
      middleware: [inline({ x: clientX, y: clientY }), shift(), flip()],
    })
    Object.assign(popoverElement.style, {
      transform: `translate(${x.toFixed()}px, ${y.toFixed()}px)`,
    })
  }

  function showPopover(popoverElement: HTMLElement) {
    clearActivePopover()
    activeAnchor = link
    popoverElement.classList.add("active-popover")
    setPosition(popoverElement as HTMLElement)

    if (hash !== "") {
      const inner = popoverElement.querySelector(".popover-inner") as HTMLElement | null
      if (inner) {
        const targetAnchor = `#popover-internal-${hash.slice(1)}`
        const heading = inner.querySelector(targetAnchor) as HTMLElement | null
        if (heading) {
          // leave ~12px of buffer when scrolling to a heading
          inner.scroll({ top: heading.offsetTop - 12, behavior: "instant" })
        }
      }
    }
  }

  const targetUrl = new URL(link.href)
  const hash = decodeURIComponent(targetUrl.hash)
  targetUrl.hash = ""
  targetUrl.search = ""
  const popoverId = `popover-${link.pathname}`
  const prevPopoverElement = document.getElementById(popoverId)

  // dont refetch if there's already a popover
  if (!!document.getElementById(popoverId)) {
    showPopover(prevPopoverElement as HTMLElement)
    return
  }

  const response = await fetchCanonical(targetUrl).catch((err) => {
    console.error(err)
  })

  if (!response || !link.isConnected || generation !== popoverGeneration) return
  const rawContentType = response.headers.get("Content-Type")
  if (!rawContentType) return
  const [contentType] = rawContentType.split(";")
  const [contentTypeCategory, typeInfo] = contentType.split("/")

  const popoverElement = document.createElement("div")
  popoverElement.id = popoverId
  popoverElement.classList.add("popover")
  const popoverInner = document.createElement("div")
  popoverInner.classList.add("popover-inner")
  popoverInner.dataset.contentType = contentType ?? undefined
  popoverElement.appendChild(popoverInner)

  switch (contentTypeCategory) {
    case "image":
      const img = document.createElement("img")
      img.src = targetUrl.toString()
      img.alt = targetUrl.pathname

      popoverInner.appendChild(img)
      break
    case "application":
      switch (typeInfo) {
        case "pdf":
          const pdf = document.createElement("iframe")
          pdf.src = targetUrl.toString()
          popoverInner.appendChild(pdf)
          break
        default:
          break
      }
      break
    default:
      const contents = await response.text()
      if (generation !== popoverGeneration || !link.isConnected) return
      const html = p.parseFromString(contents, "text/html")
      normalizeRelativeURLs(html, targetUrl)
      // prepend all IDs inside popovers to prevent duplicates
      html.querySelectorAll("[id]").forEach((el) => {
        const targetID = `popover-internal-${el.id}`
        el.id = targetID
      })
      const elts = [...html.getElementsByClassName("popover-hint")]
      if (elts.length === 0) return

      elts.forEach((elt) => popoverInner.appendChild(elt))
  }

  if (
    generation !== popoverGeneration ||
    !link.isConnected ||
    !!document.getElementById(popoverId)
  ) {
    return
  }

  // Bound retained preview DOM just like the shared six-page HTML cache.
  // Keep the visible preview, including its current scroll position.
  const retained = [...document.querySelectorAll<HTMLElement>(".popover")]
  while (retained.length >= 6) {
    const index = retained.findIndex((node) => !node.classList.contains("active-popover"))
    if (index < 0) break
    retained.splice(index, 1)[0].remove()
  }
  document.body.appendChild(popoverElement)
  if (activeAnchor !== this) {
    return
  }

  showPopover(popoverElement)
}

function clearActivePopover() {
  activeAnchor = null
  const allPopoverElements = document.querySelectorAll(".popover")
  allPopoverElements.forEach((popoverElement) => popoverElement.classList.remove("active-popover"))
}

function setupPopovers() {
  disposePopovers?.()
  const enter = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.<HTMLAnchorElement>("a.internal")
    if (!link || (event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) return
    void mouseEnterHandler.call(link, event)
  }
  const leave = (event: MouseEvent) => {
    const link = (event.target as Element).closest?.<HTMLAnchorElement>("a.internal")
    if (link && !(event.relatedTarget instanceof Node && link.contains(event.relatedTarget)))
      clearActivePopover()
  }
  // Delegation also covers freshly sampled and timeline cards, without a
  // listener pair and a cleanup closure for every link on every navigation.
  document.addEventListener("mouseover", enter)
  document.addEventListener("mouseout", leave)
  const cleanup = () => {
    if (disposePopovers !== cleanup) return
    disposePopovers = undefined
    popoverGeneration++
    document.removeEventListener("mouseover", enter)
    document.removeEventListener("mouseout", leave)
    clearActivePopover()
    document.querySelectorAll(".popover").forEach((node) => node.remove())
  }
  disposePopovers = cleanup
  window.addCleanup(cleanup)
}

document.addEventListener("nav", setupPopovers)
document.addEventListener("render", setupPopovers)
document.addEventListener("howard:index-invalidated", setupPopovers)
