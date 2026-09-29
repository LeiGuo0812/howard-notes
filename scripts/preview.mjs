import http from "node:http"
import handler from "serve-handler"

const prefix = "/howard-notes"
http
  .createServer((req, res) => {
    if (req.url === prefix) {
      res.writeHead(302, { Location: prefix + "/" })
      return res.end()
    }
    if (!req.url.startsWith(prefix + "/")) {
      res.writeHead(404)
      return res.end("Not found")
    }
    req.url = req.url.slice(prefix.length)
    return handler(req, res, { public: "public", cleanUrls: true, directoryListing: false })
  })
  .listen(8080, "0.0.0.0", () => console.log("Preview: http://localhost:8080/howard-notes/"))
