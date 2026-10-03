export function brandMarkColors(
  mode:
    | {
        readonly mark?: string
        readonly signal?: string
        readonly onSignal?: string
        readonly text?: string
      }
    | undefined,
  fallbackAccent?: string,
): { background: string; foreground: string }
