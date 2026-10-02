import path from "path-browserify"
import { renderLibrary, splitNote } from "../scripts/lib/library-render.mjs"
import { validateCatalog, safeRelative, REPOSITORY } from "../scripts/lib/catalog.mjs"
import { validateSite } from "../scripts/lib/site-settings.mjs"
import { generateSitePages } from "../scripts/lib/site-pages.mjs"
import { readActivity } from "../scripts/lib/activity.mjs"
import { createdDay, modifiedDay } from "../scripts/lib/note-dates.mjs"
import {
  MARKDOWN_VERSION,
  createMarkdownCompiler,
  renderArticleFragment,
  transclusionTargets,
} from "./markdown.ts"
import { AST_CACHE_ENCODING, encodeAstCache, decodeAstCache } from "./cache.mjs"
import { THUMBNAIL_VERSION, extractArticleThumbnail } from "../scripts/lib/article-thumbnail.mjs"

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { ignoreBOM: true })
const encode = (text) => encoder.encode(text)
const decode = (bytes) => decoder.decode(bytes)

export async function digest(bytes, algorithm = "SHA-256") {
  const result = await crypto.subtle.digest(algorithm, bytes)
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

// Git's blob ID hashes the byte-length header and the original bytes, not normalized text.
export async function gitBlobSha(bytes) {
  const header = encode(`blob ${bytes.byteLength}\0`)
  const blob = new Uint8Array(header.byteLength + bytes.byteLength)
  blob.set(header)
  blob.set(bytes, header.byteLength)
  return digest(blob, "SHA-1")
}

function assetURLs(sources, entries, commit) {
  const urls = new Map()
  if (!/^[a-f0-9]{40}$/.test(commit || "")) return urls
  const files = new Set([...sources.keys()].filter((file) => file.startsWith("assets/")))
  for (const file of entries?.keys() || [])
    if (file.startsWith("library/assets/")) files.add(file.slice("library/".length))
  for (const file of files)
    if (safeRelative(file) && /\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(file))
      urls.set(
        file,
        `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/library/${file.split("/").map(encodeURIComponent).join("/")}`,
      )
  return urls
}

// Markdown compilation belongs to Node or the authenticated owner's lazy browser bundle.
// Workers only verify canonical Git versions and serve the resulting public projection.
export async function prepareProjection({
  catalog,
  settings,
  sources,
  commit,
  entries,
  previous,
  now = new Date(),
  onProgress,
}) {
  validateCatalog(catalog)
  validateSite(settings)
  if (!(sources instanceof Map)) throw new Error("文库源码必须使用 Map 提供。")
  const publicCatalog = {
    version: 2,
    articles: structuredClone(catalog.articles.filter((article) => article.published)),
  }
  const publicSources = new Map()
  for (const article of publicCatalog.articles) {
    const bytes = sources.get(article.file)
    if (!(bytes instanceof Uint8Array)) throw new Error(`找不到公开原文：${article.file}`)
    publicSources.set(article.file, bytes)
  }
  for (const [file, bytes] of sources)
    if (file.startsWith("assets/") && bytes instanceof Uint8Array) publicSources.set(file, bytes)
  const hashes = new Map()
  await Promise.all(
    [...publicSources.values()].map(async (bytes) => hashes.set(bytes, await digest(bytes))),
  )
  const adapters = {
    path,
    hash: (bytes) => hashes.get(bytes),
    encode,
    decode,
    assetURLs: assetURLs(publicSources, entries, commit),
  }
  const cached = new Map((previous?.documents || []).map((doc) => [doc.id, doc]))
  const sourceShas = new Map()
  await Promise.all(
    publicCatalog.articles.map(async (article) => {
      sourceShas.set(article.id, await gitBlobSha(publicSources.get(article.file)))
    }),
  )
  const excerpts = new Map(
    publicCatalog.articles.flatMap((article) => {
      const old = cached.get(article.id)
      return old?.sourceSha === sourceShas.get(article.id) && typeof old.excerpt === "string"
        ? [[article.id, old.excerpt]]
        : []
    }),
  )
  const pages = generateSitePages(
    settings,
    publicCatalog,
    readActivity(publicCatalog.articles, now),
    24,
    publicSources,
    encode,
    excerpts,
  )
  const allSlugs = [
    ...new Set([
      ...publicCatalog.articles.map((article) => `notes/${article.id}`),
      ...[...pages.output.keys()].map((file) => file.replace(/\.md$/, "")),
    ]),
  ]
  const resolverKey = await digest(
    encode(
      JSON.stringify([
        publicCatalog.articles.map(({ id, file, title }) => ({ id, file, title })),
        [...adapters.assetURLs],
        allSlugs,
      ]),
    ),
  )
  const inputs = new Map()
  const changedIds = new Set()
  for (const article of publicCatalog.articles) {
    const inputKey = await digest(
      encode(JSON.stringify([MARKDOWN_VERSION, resolverKey, sourceShas.get(article.id), article])),
    )
    inputs.set(article.id, inputKey)
    const old = cached.get(article.id)
    if (
      old?.inputKey !== inputKey ||
      old.cacheEncoding !== AST_CACHE_ENCODING ||
      typeof old.astCache !== "string"
    )
      changedIds.add(article.id)
  }
  const rendered = renderLibrary(publicCatalog, publicSources, {
    ...adapters,
    articleIds: changedIds,
  })
  const compile = createMarkdownCompiler(allSlugs)
  const stages = new Map()
  const publicSlugs = new Set(publicCatalog.articles.map((article) => `notes/${article.id}`))
  let parsed = 0

  async function compileStage(stage, markdown) {
    if (!markdown)
      markdown = renderLibrary(publicCatalog, publicSources, {
        ...adapters,
        articleIds: new Set([stage.article.id]),
      }).output.get(`notes/${stage.article.id}.md`)
    const note = splitNote(decode(markdown))
    const { tree, data } = await compile(note.body, note.data, `notes/${stage.article.id}`)
    stage.tree = tree
    stage.blocks = data.blocks || {}
    Object.assign(stage.doc, {
      compileKey: `${MARKDOWN_VERSION}:${await digest(markdown)}`,
      toc: data.toc || [],
      text: data.text || "",
      links: (data.links || []).filter((slug) => publicSlugs.has(slug)),
      tags: data.frontmatter?.tags || [],
      transclusions: transclusionTargets(tree),
      astCache: await encodeAstCache(tree, stage.blocks),
      thumbnail: extractArticleThumbnail(tree, `notes/${stage.article.id}`),
      thumbnailVersion: THUMBNAIL_VERSION,
    })
    parsed++
  }

  // Source SHA, metadata and the resolver index identify exactly which Markdown needs
  // reparsing. Visibility/name changes invalidate resolutions, including missing targets.
  for (const article of publicCatalog.articles) {
    const sourceBytes = publicSources.get(article.file)
    const old = cached.get(article.id)
    const doc = {
      id: article.id,
      file: article.file,
      source: decode(sourceBytes),
      sourceSha: sourceShas.get(article.id),
      html: "",
      toc: old?.toc || [],
      text: old?.text || "",
      links: old?.links || [],
      tags: old?.tags || [],
      created: createdDay(article),
      modified: modifiedDay(article),
      rendererVersion: MARKDOWN_VERSION,
      inputKey: inputs.get(article.id),
      compileKey: old?.compileKey,
      cacheEncoding: AST_CACHE_ENCODING,
      astCache: old?.astCache,
      transclusions: old?.transclusions || [],
      excerpt: pages.data.articles.find((row) => row.id === article.id).excerpt,
      thumbnail: old?.thumbnail,
      thumbnailVersion: old?.thumbnailVersion,
    }
    const stage = { doc, article, tree: null, blocks: null }
    if (changedIds.has(article.id)) {
      const markdown = rendered.output.get(`notes/${article.id}.md`)
      const compileKey = `${MARKDOWN_VERSION}:${await digest(markdown)}`
      // A catalog change may affect the resolver without changing this document's
      // resolved Markdown. Retain its compressed AST and avoid loading a grammar.
      if (
        old?.rendererVersion !== MARKDOWN_VERSION ||
        old?.compileKey !== compileKey ||
        old.cacheEncoding !== AST_CACHE_ENCODING ||
        typeof old.astCache !== "string"
      )
        await compileStage(stage, markdown)
    }
    stages.set(`notes/${article.id}`, stage)
    onProgress?.({ phase: "compile", completed: stages.size, total: publicCatalog.articles.length })
    // Yield between documents so owner-side navigation/status updates remain responsive.
    if (stages.size % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const allFiles = () =>
    [...stages.values()].map(({ doc, article, tree, blocks }) => ({
      slug: `notes/${doc.id}`,
      frontmatter: { title: article.title, tags: doc.tags },
      htmlAst: tree,
      blocks: blocks || {},
    }))

  async function ensureTree(slug, visited = new Set()) {
    if (visited.has(slug)) return
    visited.add(slug)
    const stage = stages.get(slug)
    if (!stage) return
    if (!stage.tree) {
      try {
        const { tree, blocks } = await decodeAstCache(stage.doc.astCache)
        stage.tree = tree
        stage.blocks = blocks
      } catch {
        await compileStage(stage)
      }
    }
    for (const target of stage.doc.transclusions) await ensureTree(target, visited)
  }

  // A changed embedded note invalidates all ancestors, while ordinary links do not force
  // their readers to be parsed again. A visited set makes cycles finite and deterministic.
  function dependencyKeys(slug, visited = new Set()) {
    if (visited.has(slug)) return []
    visited.add(slug)
    const stage = stages.get(slug)
    if (!stage) return [`${slug}:unavailable`]
    return [
      `${slug}:${stage.doc.compileKey}`,
      ...stage.doc.transclusions.flatMap((target) => dependencyKeys(target, visited)),
    ]
  }
  for (const [slug, stage] of stages) {
    const { doc } = stage
    doc.renderKey = await digest(encode(JSON.stringify(dependencyKeys(slug).sort())))
    const old = cached.get(doc.id)
    if (old?.renderKey === doc.renderKey && typeof old.html === "string") doc.html = old.html
    else {
      await ensureTree(slug)
      doc.html = renderArticleFragment(stage.tree, slug, allFiles())
    }
    if (doc.thumbnailVersion !== THUMBNAIL_VERSION) {
      let tree = stage.tree
      if (!tree) {
        try {
          tree = (await decodeAstCache(doc.astCache)).tree
        } catch {
          await compileStage(stage)
          tree = stage.tree
        }
      }
      doc.thumbnail = extractArticleThumbnail(tree, slug)
      doc.thumbnailVersion = THUMBNAIL_VERSION
    }
    // The generator deliberately shares row objects between article, topic,
    // home and collection lists, so one update keeps every live list in sync.
    const row = pages.data.articles.find((row) => row.id === doc.id)
    if (doc.thumbnail) row.thumbnail = doc.thumbnail
  }

  // The public About page uses the same syntax and the same published-only resolver.
  let aboutId = "runtime-about"
  while (publicCatalog.articles.some((article) => article.id === aboutId)) aboutId += "-about"
  const about = {
    id: aboutId,
    file: `notes/${aboutId}.md`,
    title: settings.about.title,
    category: "关于",
    date: "2000-01-01",
    published: true,
  }
  const aboutBytes = encode(settings.about.body || "")
  hashes.set(aboutBytes, await digest(aboutBytes))
  const withAbout = new Map(publicSources).set(about.file, aboutBytes)
  const aboutMarkdown = renderLibrary(
    { version: 2, articles: [...publicCatalog.articles, about] },
    withAbout,
    { ...adapters, articleIds: new Set([aboutId]) },
  ).output.get(`notes/${aboutId}.md`)
  const aboutNote = splitNote(decode(aboutMarkdown))
  const aboutCompiled = await compile(aboutNote.body, aboutNote.data, "about")
  for (const target of transclusionTargets(aboutCompiled.tree)) await ensureTree(target)
  const aboutHtml = renderArticleFragment(aboutCompiled.tree, "about", allFiles())
  const documents = [...stages.values()].map(({ doc }) => doc)
  const contentIndex = {}
  for (const [file, bytes] of pages.output) {
    const slug = file.replace(/\.md$/, "")
    if (slug === "private/index") continue
    const metadata = splitNote(decode(bytes)).data
    contentIndex[slug] = {
      slug,
      filePath: file,
      title: metadata.title || "",
      links: [],
      tags: [],
      content: slug === "about" ? aboutCompiled.data.text || "" : "",
    }
  }
  for (const doc of documents) {
    const slug = `notes/${doc.id}`
    contentIndex[slug] = {
      slug,
      filePath: `${slug}.md`,
      title: publicCatalog.articles.find((article) => article.id === doc.id).title,
      links: doc.links,
      tags: doc.tags,
      content: doc.text,
    }
  }
  return {
    version: 1,
    ...(commit ? { commit } : {}),
    settings: structuredClone(settings),
    catalog: publicCatalog,
    blogData: pages.data,
    documents,
    contentIndex,
    aboutHtml,
    warnings: [
      ...(previous?.warnings || []).filter(
        (warning) =>
          !changedIds.has(warning.article) &&
          publicCatalog.articles.some((article) => article.id === warning.article),
      ),
      ...rendered.warnings,
    ],
    compilation: { parsed, reused: documents.length - parsed },
  }
}
