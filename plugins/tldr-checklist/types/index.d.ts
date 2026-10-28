// `ref` is the item number `<turn>-<n>`; `tickedBy` says who ticked a done item: the user (read) or a reply (done).
// `closedTurn`: the turn whose checklist tool call closed it; it stays until the reply after that turn's.
export type Item = { id: string; text: string; done: boolean; firstSeenTurn: number; ref: string; tickedBy?: 'user' | 'reply'; closedTurn?: number }

export type Status = { goal: string; next: string; blockers: string }

export type Doc = Status & {
  sessionId: string
  turn: number
  tldr: string
  items: Item[]
  // The last item number handed out, so a removed item's number is not given again in its turn.
  lastRef?: string
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
