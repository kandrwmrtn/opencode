import { createMemo, createSignal, createEffect, Show } from "solid-js"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useParams } from "@solidjs/router"
import { AssistantMessage } from "@opencode-ai/sdk/v2/client"

export function SessionContextUsage() {
  const sync = useSync()
  const sdk = useSDK()
  const params = useParams()
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))

  // Track child session costs fetched from server
  const [childCosts, setChildCosts] = createSignal<Record<string, number>>({})

  // Fetch child session messages to calculate their costs
  createEffect(() => {
    if (!params.id) return
    const childSessions = sync.data.session.filter((s) => s.parentID === params.id)
    for (const child of childSessions) {
      // Skip if we already have this child's cost
      if (childCosts()[child.id] !== undefined) continue
      // Fetch messages for this child session
      sdk.client.session.messages({ sessionID: child.id }).then((res) => {
        const msgs = res.data ?? []
        // Note: response is { info: Message, parts: Part[] }[], so access .info for message data
        const cost = msgs.reduce((sum, m) => sum + (m.info.role === "assistant" ? m.info.cost : 0), 0)
        setChildCosts((prev) => ({ ...prev, [child.id]: cost }))
      }).catch(() => {
        // If fetch fails, set cost to 0
        setChildCosts((prev) => ({ ...prev, [child.id]: 0 }))
      })
    }
  })

  const cost = createMemo(() => {
    // Sum cost from current session
    let total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    // Also sum cost from child sessions (subagents)
    const costs = childCosts()
    for (const childCost of Object.values(costs)) {
      total += childCost
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.all.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  return (
    <Show when={context?.()}>
      {(ctx) => (
        <Tooltip
          value={
            <div class="">
              <div class="flex items-center gap-2">
                <span class="text-text-invert-strong">{ctx().tokens}</span>
                <span class="text-text-invert-base">Tokens</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-text-invert-strong">{ctx().percentage ?? 0}%</span>
                <span class="text-text-invert-base">Usage</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-text-invert-strong">{cost()}</span>
                <span class="text-text-invert-base">Cost</span>
              </div>
            </div>
          }
          placement="top"
        >
          <div class="p-1">
            <ProgressCircle size={16} strokeWidth={2} percentage={ctx().percentage ?? 0} />
          </div>
        </Tooltip>
      )}
    </Show>
  )
}
