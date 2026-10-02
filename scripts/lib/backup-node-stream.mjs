import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import { Transform } from "node:stream"
import { pipeline, finished } from "node:stream/promises"
import { backupKey } from "./backup-crypto.mjs"

export async function encryptBackupStream(input, output, secret, context) {
  const header = Buffer.from(JSON.stringify({ format: "howard-notes-backup-v1", context }))
  if (header.length > 1024) throw new Error("Backup context is too long.")
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(header.length)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", backupKey(secret), iv)
  cipher.setAAD(header)
  const hash = createHash("sha256")
  let size = 0
  const digest = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    },
  })
  const handle = await fs.open(output, "wx", 0o600)
  const destination = handle.createWriteStream()
  destination.write(Buffer.concat([prefix, header, iv]))
  try {
    await pipeline(input, digest, cipher, destination, { end: false })
    destination.end(cipher.getAuthTag())
    await finished(destination)
    return { size, sha256: hash.digest("hex") }
  } catch (error) {
    destination.destroy()
    await fs.unlink(output).catch(() => {})
    throw error
  }
}

export async function decryptBackupStream(input, output, secret, expectedContext) {
  const stat = await fs.stat(input)
  const source = await fs.open(input, "r")
  let header, iv, tag, offset
  try {
    const lengthBuffer = Buffer.alloc(4)
    await source.read(lengthBuffer, 0, 4, 0)
    const length = lengthBuffer.readUInt32BE()
    if (!length || length > 1024 || stat.size < length + 32)
      throw new Error("Encrypted backup header is invalid.")
    header = Buffer.alloc(length)
    iv = Buffer.alloc(12)
    tag = Buffer.alloc(16)
    await source.read(header, 0, length, 4)
    await source.read(iv, 0, 12, 4 + length)
    await source.read(tag, 0, 16, stat.size - 16)
    const value = JSON.parse(header.toString("utf8"))
    if (value.format !== "howard-notes-backup-v1" || value.context !== expectedContext)
      throw new Error("Encrypted backup context does not match.")
    offset = 16 + length
  } finally {
    await source.close()
  }
  const cipher = createDecipheriv("aes-256-gcm", backupKey(secret), iv)
  cipher.setAAD(header)
  cipher.setAuthTag(tag)
  const hash = createHash("sha256")
  let size = 0
  const digest = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      size += chunk.length
      callback(null, chunk)
    },
  })
  const handle = await fs.open(output, "wx", 0o600)
  try {
    await pipeline(
      createReadStream(input, { start: offset, end: stat.size - 17 }),
      cipher,
      digest,
      handle.createWriteStream(),
    )
    return { size, sha256: hash.digest("hex") }
  } catch (error) {
    await fs.unlink(output).catch(() => {})
    throw error
  }
}
