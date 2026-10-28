// `ref` is the item number `<turn>-<n>`; `tickedBy` says who ticked a done item: the user (read) or a reply (done).
export type Item = { id: string; text: string; done: boolean; firstSeenTurn: number; ref: string; tickedBy?: 'user' | 'reply' }

export type Status = { goal: string; next: string; blockers: string }

export type Doc = Status & {
  sessionId: string
  turn: number
  tldr: string
  items: Item[]
}

declare module 'claude-code' {
  interface PluginState {
    'tldr-checklist': {
      doc: Shaped<Doc>
      prompt: string
      interactive: boolean
      unreadable: string
      // The checklist state last sent with a prompt, for which session, and the prompts since.
      sent: { sessionId: string; text: string; count: number }
    }
  }
}
