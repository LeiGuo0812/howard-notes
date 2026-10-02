export function contentIndexScript(basePath?: string): string
export function pageSecurityPolicy(options?: {
  basePath?: string
  connectOrigins?: string[]
  meta?: boolean
}): Promise<string>
export function applyPageSecurity(
  response: Response,
  options?: { basePath?: string; connectOrigins?: string[] },
): Promise<Response>
