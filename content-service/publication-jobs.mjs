import { GitHubLibrary, gitBlobSha } from "../admin/github.mjs"
import { CATALOG_PATH, equal, validateCatalog } from "../scripts/lib/catalog.mjs"
import { getPersonalArticle, finalizePersonalNotePublication } from "./personal-notes.mjs"
import { publishPrivateAttachments, publicAttachmentMapping } from "./public-attachments.mjs"

const encoder = new TextEncoder()
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const shaPattern = /^[a-f0-9]{40}$/
const kinds = new Set(["publish-private", "privatize-public", "sync-public"])
const terminal = new Set(["completed", "conflict", "cancelled"])
const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
class JobError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
const decode = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0))
async function cipherKey(env) {
  if (!env.SESSION_SECRET) throw new JobError("后台发布任务尚未配置。", 503)
  return crypto.subtle.importKey("raw", decode(env.SESSION_SECRET), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}
async function sealToken(env, id, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`publication-job:${id}`) },
    await cipherKey(env),
    encoder.encode(token),
  )
  return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`
}
async function openToken(env, row) {
  if (!row.token_cipher || row.token_expires_at <= Date.now())
    throw new JobError("任务需要重新登录后继续。", 401)
  const [iv, ciphertext] = row.token_cipher.split(".")
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv),
        additionalData: encoder.encode(`publication-job:${row.id}`),
      },
      await cipherKey(env),
      decode(ciphertext),
    ),
  )
}
const digest = async (value) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
function tokenExpiration(value, now = Date.now()) {
  if (value == null) return now + 3600000
  if (!Number.isSafeInteger(value) || value <= now)
    throw new JobError("登录状态已过期，请重新登录后继续。", 401)
  return Math.min(now + 8 * 3600000, value)
}
function cleanInput(value) {
  if (!kinds.has(value.kind)) throw new JobError("发布操作不正确。")
  if (value.kind === "sync-public") {
    if (!shaPattern.test(value.commit || "")) throw new JobError("提交版本不正确。")
    return { kind: value.kind, commit: value.commit }
  }
  if (
    !idPattern.test(value.articleId || "") ||
    !Number.isSafeInteger(value.privateVersion) ||
    value.privateVersion < 1
  )
    throw new JobError("私密文章版本信息不完整。")
  const input = {
    kind: value.kind,
    articleId: value.articleId,
    privateVersion: value.privateVersion,
  }
  if (value.publishAttachments === true) input.publishAttachments = true
  if (value.publicBaseline != null) {
    if (!shaPattern.test(value.publicBaseline.sha || "")) throw new JobError("公开版本信息不正确。")
    validateCatalog({ version: 2, articles: [value.publicBaseline.article] })
    if (!value.publicBaseline.article.published) throw new JobError("公开版本信息不正确。")
    input.publicBaseline = structuredClone(value.publicBaseline)
  }
  if (value.kind === "privatize-public" && !input.publicBaseline)
    throw new JobError("请先读取当前公开文章。")
  return input
}
function describe(row) {
  const input = JSON.parse(row.input)
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    articleId: input.articleId || null,
    publicArticleId: input.publicBaseline?.article.id || input.articleId || null,
    privateVersion: input.privateVersion || null,
    checkpoint: row.checkpoint ? JSON.parse(row.checkpoint) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
const sourceChange = (path, content) => ({
  path,
  mode: "100644",
  type: "blob",
  ...(content === null ? { sha: null } : { content }),
})
function publicArticle(note, baseline) {
  const source = {
    ...note.article,
    ...(baseline
      ? { id: baseline.article.id, file: baseline.article.file, date: baseline.article.date }
      : {}),
    published: true,
  }
  // Private provenance, recovery metadata and future internal fields never
  // become public merely because the editor copied an article object.
  const fields = [
    "id",
    "file",
    "title",
    "description",
    "category",
    "date",
    "created",
    "modified",
    "dateOrigin",
    "tags",
    "featured",
    "published",
    "attachments",
  ]
  const article = Object.fromEntries(
    fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]),
  )
  if (article.description !== undefined && typeof article.description !== "string")
    delete article.description
  if (article.featured !== undefined && typeof article.featured !== "boolean")
    delete article.featured
  if (article.dateOrigin) {
    const origin = article.dateOrigin
    const allowed = [
      "frontmatter",
      "filesystem",
      "git",
      "git-history",
      "catalog",
      "import",
      "memos",
      "manual",
      "fallback",
      "first-record",
      "vault-history",
      "source",
    ]
    article.dateOrigin = Object.fromEntries(
      ["created", "modified"]
        .filter((field) => allowed.includes(origin[field]))
        .map((field) => [field, origin[field]]),
    )
    if (!Object.keys(article.dateOrigin).length) delete article.dateOrigin
  }
  // A private download URL must never be copied into the public repository.
  // Publishing attachments uses separately consented public mappings.
  if (article.attachments) article.attachments = article.attachments.map(publicAttachmentMapping)
  validateCatalog({ version: 2, articles: [article] })
  return article
}
async function persistCheckpoint(db, row, leaseId, checkpoint) {
  const result = await db
    .prepare(
      "UPDATE publication_jobs SET checkpoint=?,status='awaiting_sync',updated_at=?,error=NULL WHERE id=? AND lease_id=?",
    )
    .bind(JSON.stringify(checkpoint), Date.now(), row.id, leaseId)
    .run()
  if (!result.meta.changes) throw new JobError("任务已由其他处理接管。", 409)
}
async function writeGit(env, db, row, client, leaseId) {
  const input = JSON.parse(row.input)
  if (row.checkpoint) return JSON.parse(row.checkpoint)
  if (input.kind === "sync-public") {
    const checkpoint = { commit: input.commit }
    await persistCheckpoint(db, row, leaseId, checkpoint)
    return checkpoint
  }
  const note = await getPersonalArticle(db, input.articleId)
  if (!note || note.status === "TRASH" || note.version !== input.privateVersion)
    throw new JobError("私密文章已在另一端修改；当前内容完整保留，请重新发布。", 409)
  const latest = await client.snapshot()
  const baseline = input.publicBaseline || note.article.draftBaseline || null
  const publicId = baseline?.article.id || note.article.id
  const current = latest.catalog.articles.find((a) => a.id === publicId)
  const currentSha = current ? latest.entries.get(`library/${current.file}`)?.sha : null
  let catalog = structuredClone(latest.catalog),
    changes,
    checkpoint
  if (input.kind === "privatize-public") {
    const expected = input.publicBaseline
    if (note.article.id !== publicId && note.article.draftOf !== publicId)
      throw new JobError("私密文章与要撤下的公开文章没有版本关联。", 409)
    if (current) {
      if (!equal(current, expected.article) || currentSha !== expected.sha)
        throw new JobError("公开文章已在另一端修改；私密副本已保留，本次未撤下文章。", 409)
      if (catalog.articles.some((a) => a.draftOf === current.id))
        throw new JobError("请先将现有公开仓库修改稿迁入私密草稿箱。", 409)
      catalog.articles = catalog.articles.filter((a) => a.id !== publicId)
      changes = [
        sourceChange(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n"),
        sourceChange(`library/${current.file}`, null),
      ]
    } else {
      // After an accepted ref update and an interrupted acknowledgement, an
      // absent article is sufficient; no second deletion or commit is made.
      changes = []
    }
    checkpoint = {
      commit: latest.commit,
      articleId: publicId,
      removed: true,
      privateId: note.article.id,
    }
  } else {
    if (baseline ? !equal(current, baseline.article) || currentSha !== baseline.sha : !!current) {
      // A completed target is still accepted below after deriving its mappings.
      if (currentSha !== (await gitBlobSha(note.raw)))
        throw new JobError(
          "公开文章或同网址已在另一端修改；私密原文已保留，请核对后重新发布。",
          409,
        )
    }
    const prepared = await publishPrivateAttachments(
      env,
      db,
      client,
      note.article,
      latest.settings,
      input.publishAttachments,
      row.attachment_mappings ? JSON.parse(row.attachment_mappings) : [],
    )
    const attachments = prepared.mappings
    if (attachments.length && row.attachment_mappings !== JSON.stringify(attachments)) {
      const saved = await db
        .prepare("UPDATE publication_jobs SET attachment_mappings=? WHERE id=? AND lease_id=?")
        .bind(JSON.stringify(attachments), row.id, leaseId)
        .run()
      if (!saved.meta.changes) throw new JobError("附件任务已由其他处理接管。", 409)
    }
    if (!prepared.complete) return { deferred: true }
    const article = publicArticle(
      { ...note, article: { ...note.article, ...(attachments.length ? { attachments } : {}) } },
      baseline,
    )
    if (/\/api\/content\/personal\/files\//.test(note.raw) && !article.attachments?.length)
      throw new JobError("文章包含私密附件链接，请先处理附件公开权限。", 409)
    const targetSha = await gitBlobSha(note.raw)
    // Check the desired end state before checking the old baseline. This is
    // the idempotent acknowledgement of a ref update whose response was lost.
    if (equal(current, article) && currentSha === targetSha) changes = []
    else {
      if (baseline ? !equal(current, baseline.article) || currentSha !== baseline.sha : !!current)
        throw new JobError(
          "公开文章或同网址已在另一端修改；私密原文已保留，请核对后重新发布。",
          409,
        )
      if (catalog.articles.some((a) => a.id !== publicId && a.file === article.file))
        throw new JobError("公开原文路径已有其他文章。", 409)
      catalog.articles = catalog.articles.filter((a) => a.id !== publicId)
      catalog.articles.push(article)
      changes = [
        sourceChange(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n"),
        sourceChange(`library/${article.file}`, note.raw),
      ]
    }
    checkpoint = {
      commit: latest.commit,
      articleId: publicId,
      sourceSha: targetSha,
      article,
      privateId: note.article.id,
    }
  }
  if (changes.length) {
    const result = await client.commit(
      latest,
      changes,
      `${input.kind === "privatize-public" ? "Make private" : "Publish"}: ${publicId}`,
    )
    checkpoint.commit = result.sha
  }
  await persistCheckpoint(db, row, leaseId, checkpoint)
  return checkpoint
}
async function synchronized(db, checkpoint, client) {
  const current = await db.prepare("SELECT * FROM content_state WHERE id=1").first()
  if (!current?.commit_sha) return false
  if (current.commit_sha !== checkpoint.commit) {
    const relation = await client.repo(`compare/${checkpoint.commit}...${current.commit_sha}`)
    if (!["ahead", "identical"].includes(relation.status)) return false
  }
  if (checkpoint.articleId) {
    const source = await db
      .prepare("SELECT source_sha FROM public_documents WHERE revision=? AND id=?")
      .bind(current.revision, checkpoint.articleId)
      .first()
    if (checkpoint.removed) {
      if (source) throw new JobError("该文章之后又被公开，私密副本仍保留，请核对当前可见性。", 409)
    } else if (source?.source_sha !== checkpoint.sourceSha) {
      throw new JobError("公开原文已更新为其他版本，私密原文仍保留，请核对后再发布。", 409)
    }
  }
  return true
}
export async function runPublicationJob(env, db, id, fetcher = fetch) {
  let row = await db.prepare("SELECT * FROM publication_jobs WHERE id=?").bind(id).first()
  if (!row || terminal.has(row.status)) return row ? describe(row) : null
  const now = Date.now(),
    leaseId = crypto.randomUUID()
  const claimed = await db
    .prepare(
      "UPDATE publication_jobs SET lease_id=?,lease_until=?,attempts=attempts+1,status=CASE WHEN checkpoint IS NULL THEN 'running' ELSE 'awaiting_sync' END,updated_at=? WHERE id=? AND lease_until<=? AND status NOT IN ('completed','conflict','cancelled')",
    )
    .bind(leaseId, now + 120_000, now, id, now)
    .run()
  if (!claimed.meta.changes) return describe(row)
  row = await db.prepare("SELECT * FROM publication_jobs WHERE id=?").bind(id).first()
  try {
    const token = await openToken(env, row)
    const githubFetch = (url, options) =>
      fetcher(url, {
        ...options,
        redirect: "manual",
        headers: { ...options.headers, "User-Agent": "Howard-Notes-Publication" },
      })
    const client = new GitHubLibrary(token, githubFetch, {
      repository: env.REPOSITORY,
      branch: env.BRANCH,
    })
    const checkpoint = await writeGit(env, db, row, client, leaseId)
    if (checkpoint.deferred) {
      await db
        .prepare(
          "UPDATE publication_jobs SET status='queued',lease_until=0,lease_id=NULL,next_run_at=?,updated_at=?,error=NULL WHERE id=? AND lease_id=?",
        )
        .bind(Date.now(), Date.now(), id, leaseId)
        .run()
      return describe(
        await db.prepare("SELECT * FROM publication_jobs WHERE id=?").bind(id).first(),
      )
    }
    if (await synchronized(db, checkpoint, client)) {
      const input = JSON.parse(row.input)
      let warning = null
      if (input.kind === "publish-private") {
        try {
          await finalizePersonalNotePublication(db, input.articleId, input.privateVersion, {
            articleId: checkpoint.articleId,
            commit: checkpoint.commit,
            sourceSha: checkpoint.sourceSha,
            sha: checkpoint.sourceSha,
            article: checkpoint.article,
          })
        } catch (error) {
          if (error.status !== 409) throw error
          warning = "发布已完成，之后的私密修改稿继续保留。"
        }
      }
      await db
        .prepare(
          "UPDATE publication_jobs SET status='completed',token_cipher=NULL,lease_until=0,lease_id=NULL,updated_at=?,error=? WHERE id=? AND lease_id=?",
        )
        .bind(Date.now(), warning, id, leaseId)
        .run()
    } else
      await db
        .prepare(
          "UPDATE publication_jobs SET status='awaiting_sync',lease_until=0,lease_id=NULL,next_run_at=?,updated_at=?,error=NULL WHERE id=? AND lease_id=?",
        )
        .bind(Date.now() + 30_000, Date.now(), id, leaseId)
        .run()
  } catch (error) {
    const status = [401, 403].includes(error.status)
      ? "awaiting_auth"
      : error.status === 409 || /另一端|远端|已存在|已有其他|不能|路径不合法/.test(error.message)
        ? "conflict"
        : "retry"
    const message =
      status === "awaiting_auth"
        ? "请重新登录后继续此任务。"
        : status === "conflict"
          ? String(error.message).slice(0, 250)
          : "后台暂时无法完成操作，已保留原文，将自动重试。"
    await db
      .prepare(
        "UPDATE publication_jobs SET status=?,error=?,token_cipher=CASE WHEN ? IN ('awaiting_auth','conflict') THEN NULL ELSE token_cipher END,lease_until=0,lease_id=NULL,next_run_at=?,updated_at=? WHERE id=? AND lease_id=?",
      )
      .bind(
        status,
        message,
        status,
        Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(row.attempts, 5)),
        Date.now(),
        id,
        leaseId,
      )
      .run()
  }
  return describe(await db.prepare("SELECT * FROM publication_jobs WHERE id=?").bind(id).first())
}
export async function runPendingPublications(env, db, fetcher = fetch) {
  const rows = await db
    .prepare(
      "SELECT id FROM publication_jobs WHERE status IN ('queued','running','awaiting_sync','retry') AND next_run_at<=? AND lease_until<=? ORDER BY created_at LIMIT 1",
    )
    .bind(Date.now(), Date.now())
    .all()
  for (const row of rows.results) await runPublicationJob(env, db, row.id, fetcher)
  await db
    .prepare(
      "UPDATE publication_jobs SET token_cipher=NULL,status='awaiting_auth',error='请重新登录后继续此任务。' WHERE token_expires_at<=? AND token_cipher IS NOT NULL AND status NOT IN ('completed','conflict','cancelled')",
    )
    .bind(Date.now())
    .run()
  await db
    .prepare(
      "DELETE FROM publication_jobs WHERE updated_at<? AND status IN ('completed','cancelled','conflict')",
    )
    .bind(Date.now() - 30 * 86400000)
    .run()
}
export async function publicationJobsResponse(
  request,
  env,
  db,
  route,
  authorize,
  ctx = {},
  fetcher = fetch,
) {
  try {
    if (request.headers.has("X-Howard-Sync-Key"))
      throw new JobError("发布任务需要维护账号登录。", 403)
    const token = await authorize(request)
    if (request.method === "GET") {
      const id = route.replace(/^personal\/jobs\/?/, "")
      if (id) {
        if (!uuid.test(id)) throw new JobError("任务编号不正确。")
        const row = await db.prepare("SELECT * FROM publication_jobs WHERE id=?").bind(id).first()
        if (
          row &&
          !terminal.has(row.status) &&
          row.status !== "awaiting_auth" &&
          row.next_run_at <= Date.now()
        )
          ctx.waitUntil?.(runPublicationJob(env, db, row.id, fetcher))
        return row ? json(describe(row)) : json({ error: "任务不存在。" }, 404)
      }
      const rows = await db
        .prepare("SELECT * FROM publication_jobs ORDER BY created_at DESC LIMIT 100")
        .all()
      const pending = rows.results.find(
        (row) =>
          !terminal.has(row.status) &&
          row.status !== "awaiting_auth" &&
          row.next_run_at <= Date.now(),
      )
      if (pending) ctx.waitUntil?.(runPublicationJob(env, db, pending.id, fetcher))
      return json({ jobs: rows.results.map(describe) })
    }
    if (
      request.method !== "POST" ||
      request.headers.get("Content-Type")?.split(";")[0] !== "application/json"
    )
      throw new JobError("请求格式不正确。", 405)
    const bytes = await request.arrayBuffer()
    if (bytes.byteLength > 170_000) throw new JobError("任务请求过大。", 413)
    let value
    try {
      value = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw new JobError("任务内容格式不正确。")
    }
    const resume = /^personal\/jobs\/([a-f0-9-]+)\/resume$/.exec(route)
    if (resume) {
      const row = await db
        .prepare("SELECT * FROM publication_jobs WHERE id=?")
        .bind(resume[1])
        .first()
      if (!row || terminal.has(row.status)) throw new JobError("此任务不能继续。", 409)
      const cipher = await sealToken(env, row.id, token)
      await db
        .prepare(
          "UPDATE publication_jobs SET token_cipher=?,token_expires_at=?,status=CASE WHEN checkpoint IS NULL THEN 'queued' ELSE 'awaiting_sync' END,next_run_at=?,updated_at=? WHERE id=?",
        )
        .bind(cipher, tokenExpiration(value.tokenExpiresAt), Date.now(), Date.now(), row.id)
        .run()
      ctx.waitUntil?.(runPublicationJob(env, db, row.id, fetcher))
      return json(
        describe(
          await db.prepare("SELECT * FROM publication_jobs WHERE id=?").bind(row.id).first(),
        ),
        202,
      )
    }
    if (route !== "personal/jobs" || !uuid.test(value.requestId || ""))
      throw new JobError("任务请求编号不正确。")
    const input = cleanInput(value),
      fingerprint = await digest(JSON.stringify(input))
    const prior = await db
      .prepare("SELECT * FROM publication_jobs WHERE request_id=?")
      .bind(value.requestId)
      .first()
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new JobError("任务编号已用于其他内容。", 409)
      return json(describe(prior), 202)
    }
    if (input.articleId) {
      const note = await getPersonalArticle(db, input.articleId)
      if (!note || note.status === "TRASH" || note.version !== input.privateVersion)
        throw new JobError("请先保存当前私密原文，确认版本后再发布。", 409)
    }
    const id = crypto.randomUUID(),
      now = Date.now(),
      cipher = await sealToken(env, id, token)
    const expires = tokenExpiration(value.tokenExpiresAt, now)
    await db
      .prepare(
        "INSERT OR IGNORE INTO publication_jobs(id,request_id,fingerprint,kind,input,status,token_cipher,token_expires_at,next_run_at,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?,?,?)",
      )
      .bind(
        id,
        value.requestId,
        fingerprint,
        input.kind,
        JSON.stringify(input),
        cipher,
        expires,
        now,
        now,
        now,
      )
      .run()
    const created = await db
      .prepare("SELECT * FROM publication_jobs WHERE request_id=?")
      .bind(value.requestId)
      .first()
    if (created.fingerprint !== fingerprint) throw new JobError("任务编号已用于其他内容。", 409)
    ctx.waitUntil?.(runPublicationJob(env, db, created.id, fetcher))
    return json(describe(created), 202)
  } catch (error) {
    return json(
      { error: error.status ? error.message : "后台任务暂不可用，请稍后重试。" },
      error.status || 503,
    )
  }
}
