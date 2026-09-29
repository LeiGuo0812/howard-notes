import path from "path"
import { FilePath } from "./path"
import { globby } from "globby"

export function toPosixPath(fp: string): string {
  return fp.split(path.sep).join("/")
}

export async function glob(
  pattern: string,
  cwd: string,
  ignorePatterns: string[],
): Promise<FilePath[]> {
  const fps = (
    await globby(pattern, {
      cwd,
      ignore: ignorePatterns,
      // This site generates the allowlisted content directory before each build.
      // It is excluded from Git, but must still be visible to the renderer.
      gitignore: path.resolve(cwd) !== path.resolve("content"),
    })
  ).map(toPosixPath)
  return fps as FilePath[]
}
