const encoder = new TextEncoder()
const decoder = new TextDecoder()
const FORMAT = "howard-notes-backup-v1"

export const backupHash = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

export function backupKey(secret) {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}=?$/.test(secret))
    throw new Error("Backup encryption requires a 32-byte base64url secret.")
  const raw = atob(secret.replace(/-/g, "+").replace(/_/g, "/"))
  if (raw.length !== 32) throw new Error("Backup encryption key length is invalid.")
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export async function encryptBackup(bytes, secret, context) {
  const header = encoder.encode(JSON.stringify({ format: FORMAT, context }))
  if (header.byteLength > 1024) throw new Error("Backup context is too long.")
  const key = await crypto.subtle.importKey("raw", backupKey(secret), "AES-GCM", false, ["encrypt"])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header }, key, bytes),
  )
  const output = new Uint8Array(4 + header.byteLength + iv.byteLength + ciphertext.byteLength)
  new DataView(output.buffer).setUint32(0, header.byteLength)
  output.set(header, 4)
  output.set(iv, 4 + header.byteLength)
  output.set(ciphertext, 16 + header.byteLength)
  return output
}

export async function decryptBackup(input, secret, expectedContext) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength < 34) throw new Error("Encrypted backup is truncated.")
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  if (length > 1024 || length + 32 > bytes.byteLength)
    throw new Error("Encrypted backup header is invalid.")
  const header = bytes.subarray(4, 4 + length)
  const value = JSON.parse(decoder.decode(header))
  if (value.format !== FORMAT || value.context !== expectedContext)
    throw new Error("Encrypted backup context does not match.")
  const key = await crypto.subtle.importKey("raw", backupKey(secret), "AES-GCM", false, ["decrypt"])
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(4 + length, 16 + length), additionalData: header },
      key,
      bytes.subarray(16 + length),
    ),
  )
}

export const encodeBackupJson = (value) => encoder.encode(JSON.stringify(value))
export const decodeBackupJson = (bytes) => JSON.parse(decoder.decode(bytes))
