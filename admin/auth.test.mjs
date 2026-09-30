import test from "node:test"
import assert from "node:assert/strict"
import { acceptsMessage, brokerOrigin } from "./auth.mjs"
test("login only accepts credentials from its own popup, exact origin and random channel", () => {
  const popup = {},
    origin = "https://auth.example.test",
    channel = "c".repeat(43)
  const event = {
    source: popup,
    origin,
    data: {
      type: "howard-github-auth",
      channel,
      token: "ghu_mock-authorized-user",
      login: "LeiGuo0812",
      expiresAt: Date.now() + 3600000,
    },
  }
  assert.equal(acceptsMessage(event, popup, origin, channel), true)
  for (const change of [
    { source: {} },
    { origin: "https://evil.test" },
    { data: { ...event.data, channel: "other" } },
    { data: { ...event.data, expiresAt: 1 } },
    { data: { ...event.data, token: "" } },
  ])
    assert.equal(acceptsMessage({ ...event, ...change }, popup, origin, channel), false)
})
test("broker config accepts only HTTPS origins without credentials or redirects", () => {
  assert.equal(brokerOrigin("https://auth.example.test/"), "https://auth.example.test")
  for (const value of [
    "http://auth.example.test",
    "https://user:pass@auth.example.test",
    "https://auth.example.test/login",
    "https://auth.example.test/?next=evil",
    "javascript:alert(1)",
  ])
    assert.throws(() => brokerOrigin(value))
})
