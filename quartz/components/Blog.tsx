// Generated before Quartz builds. Live publishing imports the pure view directly.
// @ts-ignore The generated JSON does not exist in a freshly checked-out tree.
import generatedBlogData from "../../.local/blog-data.json"
import { BlogNav, setStaticBlogData, type BlogData } from "./BlogView"
// @ts-ignore Quartz's inline-script loader turns this module into a JavaScript string.
import browserScript from "./scripts/note-browser.inline"

// Browser behavior remains separate from the pure view reused by publishing.
setStaticBlogData(generatedBlogData as BlogData)
BlogNav.afterDOMLoaded = browserScript
export * from "./BlogView"
