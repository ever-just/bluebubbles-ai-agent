# Implementation Plan: Event-Driven Typing Indicators

## Problem Statement

The current typing indicator implementation has several issues:
1. **Wrong layer** - MessageRouter starts typing before knowing what the agent will do
2. **No coordination** - Multiple code paths can start typing, causing conflicts
3. **Start early, stop late** - Typing starts on message receipt, but actual "thinking" happens later
4. **Stuck indicators** - Typing indicators remain on after agent responds (especially with reactions)

## Solution: Event-Driven Typing (Option C)

Typing indicators should reflect when Claude is **actually thinking**, not when we're doing database lookups, message routing, or other preprocessing.

```
┌─────────────────────────────────────────────────────────────────┐
│                     Current Architecture                        │
├─────────────────────────────────────────────────────────────────┤
│  Message Received                                               │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │ MessageRouter   │ ◄── Starts typing HERE (too early)        │
│  │ - DB lookups    │                                           │
│  │ - Context build │                                           │
│  │ - History fetch │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ ClaudeService   │ ──► │ Anthropic API   │ ◄── ACTUAL THINKING│
│  │ Enhanced        │     │ (Claude)        │                   │
│  └────────┬────────┘     └─────────────────┘                   │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                           │
│  │ InteractionAgent│ ◄── Can make multiple Claude calls        │
│  │ Runtime         │     (tool loops)                          │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  Response Sent ◄── Stops typing HERE (sometimes too late)      │
└─────────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────────┐
│                     Proposed Architecture                       │
├─────────────────────────────────────────────────────────────────┤
│  Message Received                                               │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │ MessageRouter   │ ◄── NO typing here                        │
│  │ - DB lookups    │                                           │
│  │ - Context build │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ TypingManager   │ ◄───│ Event Emitter   │                   │
│  │ (singleton)     │     │ 'typing:start'  │                   │
│  │                 │     │ 'typing:stop'   │                   │
│  └────────┬────────┘     └────────▲────────┘                   │
│           │                       │                             │
│           ▼                       │                             │
│  ┌─────────────────┐     ┌────────┴────────┐                   │
│  │ BlueBubbles     │     │ Anthropic API   │                   │
│  │ Client          │     │ Wrapper         │                   │
│  │ (POST/DELETE)   │     │ - emits events  │                   │
│  └─────────────────┘     │ - before/after  │                   │
│                          │   each request  │                   │
│                          └─────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture Components

### 1. TypingManager (New Service)
**File:** `agent-service/src/services/TypingManager.ts`

Centralized singleton that manages typing state across all code paths.

```typescript
interface TypingSession {
  chatGuid: string;
  startedAt: number;
  owner: string;  // 'claude-request', 'interaction-agent', etc.
  autoStopTimer?: NodeJS.Timeout;
}

class TypingManager extends EventEmitter {
  private sessions = new Map<string, TypingSession>();
  private blueBubblesClient: BlueBubblesClient;
  private readonly maxTypingDurationMs = 30000; // Auto-stop after 30s
  
  // Start typing for a chat (idempotent - won't restart if already typing)
  async startTyping(chatGuid: string, owner: string): Promise<void>;
  
  // Stop typing for a chat (only if owner matches or force=true)
  async stopTyping(chatGuid: string, owner?: string, force?: boolean): Promise<void>;
  
  // Check if currently typing
  isTyping(chatGuid: string): boolean;
  
  // Auto-cleanup stale sessions
  private startAutoStopTimer(chatGuid: string): void;
}
```

**Key Features:**
- **Idempotent start** - Won't restart typing if already active
- **Owner tracking** - Prevents accidental stops from wrong code paths
- **Auto-stop timer** - Prevents stuck indicators (max 30 seconds)
- **Singleton pattern** - Single source of truth

### 2. Anthropic Request Wrapper
**File:** `agent-service/src/services/AnthropicRequestManager.ts` (modify existing)

Add event emission around Claude API calls.

```typescript
class AnthropicRequestManager extends EventEmitter {
  // Existing code...
  
  async execute<T>(task: () => Promise<T>, options: RequestOptions = {}): Promise<T> {
    const chatGuid = options.chatGuid; // NEW: Pass chatGuid in options
    
    if (chatGuid) {
      this.emit('request:start', { chatGuid, description: options.description });
    }
    
    try {
      const result = await this.executeInternal(task, options);
      return result;
    } finally {
      if (chatGuid) {
        this.emit('request:end', { chatGuid, description: options.description });
      }
    }
  }
}
```

### 3. Wire Up Events
**File:** `agent-service/src/services/MessageRouter.ts` (modify)

Connect TypingManager to AnthropicRequestManager events.

```typescript
// In MessageRouter.initialize()
const typingManager = getTypingManager();
const requestManager = getAnthropicRequestManager();

requestManager.on('request:start', ({ chatGuid }) => {
  typingManager.startTyping(chatGuid, 'claude-request');
});

requestManager.on('request:end', ({ chatGuid }) => {
  typingManager.stopTyping(chatGuid, 'claude-request');
});
```

### 4. Remove Old Typing Logic
**Files to modify:**
- `MessageRouter.ts` - Remove `typingStarted`, `typingGuid` variables and manual start/stop calls
- `iMessageAdapter.ts` - Remove `startTyping()`, `stopTyping()` methods (or keep but delegate to TypingManager)
- `BlueBubblesClient.ts` - Keep `startTypingIndicator()`, `stopTypingIndicator()` but only called by TypingManager

## Implementation Steps

### Phase 1: Create TypingManager
1. Create `agent-service/src/services/TypingManager.ts`
2. Implement singleton with start/stop/isTyping methods
3. Add auto-stop timer for safety
4. Add unit tests

### Phase 2: Modify AnthropicRequestManager
1. Add `chatGuid` to `RequestOptions` interface
2. Add EventEmitter inheritance
3. Emit `request:start` and `request:end` events
4. Update all callers to pass `chatGuid`

### Phase 3: Update Callers to Pass chatGuid
1. **ClaudeServiceEnhanced.sendMessage()** - Pass chatGuid from toolContext
2. **InteractionAgentRuntime** - Pass chatGuid when calling Claude directly
3. **ExecutionAgentRuntime** - Pass chatGuid (if applicable)

### Phase 4: Wire Up in MessageRouter
1. Import TypingManager
2. Subscribe to AnthropicRequestManager events
3. Remove old typing logic (typingStarted, typingGuid variables)
4. Remove manual startTypingIndicator/stopTypingIndicator calls

### Phase 5: Cleanup
1. Remove typing methods from iMessageAdapter (or delegate to TypingManager)
2. Update config to re-enable typing indicators by default
3. Test end-to-end

## Code Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `services/TypingManager.ts` | **NEW** | Centralized typing state management |
| `services/AnthropicRequestManager.ts` | MODIFY | Add EventEmitter, emit request events |
| `services/ClaudeServiceEnhanced.ts` | MODIFY | Pass chatGuid to request manager |
| `services/MessageRouter.ts` | MODIFY | Wire up events, remove old typing logic |
| `agents/InteractionAgentRuntime.ts` | MODIFY | Pass chatGuid when calling Claude |
| `agents/iMessageAdapter.ts` | MODIFY | Remove or delegate typing methods |
| `config/index.ts` | MODIFY | Re-enable typing indicators |

## Testing Plan

1. **Unit Tests:**
   - TypingManager start/stop/isTyping
   - Auto-stop timer functionality
   - Owner-based stop protection

2. **Integration Tests:**
   - Send message → typing starts when Claude called → typing stops when response received
   - Multiple rapid messages → typing doesn't flicker
   - Reaction-only response → typing stops correctly
   - Long Claude response (tool loops) → typing stays on during all API calls

3. **Manual Testing:**
   - Send "hi" → verify typing appears briefly, stops after response
   - Send "thanks" → verify typing appears briefly, stops after reaction
   - Send search query → verify typing during web_search tool execution

## Rollback Plan

If issues arise:
1. Set `TYPING_INDICATORS_ENABLED=false` in .env
2. TypingManager will short-circuit all operations when disabled

## Timeline Estimate

- Phase 1: 1 hour
- Phase 2: 30 minutes
- Phase 3: 30 minutes
- Phase 4: 30 minutes
- Phase 5: 30 minutes
- Testing: 1 hour

**Total: ~4 hours**

## Open Questions

1. Should typing continue during tool execution (e.g., email send, reminder create)?
   - **Recommendation:** Yes, but with shorter auto-stop timer (10s for tools)

2. Should we show typing during pre-emptive acknowledgments?
   - **Recommendation:** No, acknowledgment is sent immediately, no "thinking" happening

3. What about ExecutionAgentRuntime - does it need typing?
   - **Recommendation:** No, execution agents don't interact with users directly
