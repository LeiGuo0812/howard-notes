// VFile and path-browserify need a working directory, never the visitor's environment.
const process = { cwd: () => "/", env: {}, platform: "browser" }
export { process }
export default process
