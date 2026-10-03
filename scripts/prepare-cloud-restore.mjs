import fs from "node:fs/promises"
import { parseArgs } from "node:util"
import {
  prepareCloudRestore,
  verifyCloudRestorePlan,
  RestorePlanError,
} from "./lib/cloud-restore.mjs"
try {
  const { values } = parseArgs({
    options: {
      database: { type: "string" },
      "private-files": { type: "string" },
      target: { type: "string" },
      output: { type: "string" },
      verify: { type: "string" },
    },
  })
  let result
  if (values.verify) result = await verifyCloudRestorePlan(values.verify)
  else {
    if (!values.database || !values["private-files"] || !values.target || !values.output)
      throw new RestorePlanError("ARGUMENTS")
    result = await prepareCloudRestore({
      databasePath: values.database,
      privateFilesPath: values["private-files"],
      targetConfig: JSON.parse(await fs.readFile(values.target, "utf8")),
      productionConfig: JSON.parse(
        await fs.readFile(new URL("../content-service/wrangler.json", import.meta.url), "utf8"),
      ),
      output: values.output,
    })
  }
  console.log(JSON.stringify(result))
} catch (error) {
  console.error(
    JSON.stringify({
      verified: false,
      code: error instanceof RestorePlanError ? error.code : "UNEXPECTED",
      cloudWritesPerformed: false,
    }),
  )
  process.exitCode = 1
}
