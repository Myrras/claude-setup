export type Item = { id: string; text: string; done: boolean; firstSeenTurn: number }

export type Status = { goal: string; next: string; blockers: string }

export type Doc = Status & {
  sessionId: string
  turn: number
  tldr: string
  items: Item[]
}

declare module 'claude-code' {
  interface PluginState {
    'tldr-checklist': { doc: Shaped<Doc>; prompt: string; interactive: boolean }
  }
}
