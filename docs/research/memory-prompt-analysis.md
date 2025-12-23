# Memory & Prompt System Analysis

## Comparative Analysis: BlueBubbles vs OpenPoke

---

## 1. Memory System Comparison

### BlueBubbles Current Approach

**Architecture**: Database-centric with TypeORM entities

```
ContextMemory Entity
├── userId (UUID)
├── conversationId (UUID, optional)
├── memoryType: 'working' | 'session' | 'long_term'
├── key (varchar 255)
├── value (text)
├── metadata (jsonb)
├── expiresAt (timestamp)
└── embedding (jsonb, optional)
```

**Memory Tiers**:
| Type | TTL | Scope |
|------|-----|-------|
| working | 1 hour | Conversation-specific |
| session | 24 hours | Conversation-specific |
| long_term | Never expires | User-wide |

**How Context is Built** (`ContextService.buildConversationContext`):
```typescript
// Order: long_term → session → working → recent messages
context = 'Long-term context:\n' + longTermMemories
        + 'Session context:\n' + sessionMemories
        + 'Current context:\n' + workingMemories
        + 'Recent conversation:\n' + messages
```

**Issues Identified**:
1. **Not actively used** — `buildConversationContext()` exists but isn't called in main flow
2. **Key-value only** — Memories stored as simple key-value pairs, not structured
3. **No automatic summarization** — `ConversationSummarizer` exists but not integrated
4. **Embeddings are random** — `generateEmbedding()` returns random floats (placeholder)
5. **No working memory log** — No append-only log for conversation state

---

### OpenPoke Approach

**Architecture**: File-based append-only logs with structured summarization

```
Working Memory System
├── ConversationLog (poke_conversation.log)
│   ├── <user_message timestamp="...">content</user_message>
│   ├── <agent_message timestamp="...">content</agent_message>
│   ├── <poke_reply timestamp="...">content</poke_reply>
│   └── <wait timestamp="...">reason</wait>
│
├── WorkingMemoryLog (poke_working_memory.log)
│   ├── <summary_info>{"last_index": N, "updated_at": "..."}</summary_info>
│   ├── <conversation_summary>structured summary</conversation_summary>
│   └── <unsummarized entries...>
│
└── ExecutionAgentLogStore (per-agent logs)
    ├── <agent_request timestamp="...">instruction</agent_request>
    ├── <agent_action timestamp="...">tool call</agent_action>
    ├── <tool_response timestamp="...">result</tool_response>
    └── <agent_response timestamp="...">final response</agent_response>
```

**Summarization System**:
```python
# Triggered when unsummarized entries exceed threshold
if len(unsummarized_entries) >= threshold + tail_size:
    batch = unsummarized_entries[:threshold]
    new_summary = await summarize(previous_summary, batch)
    # Keep tail_size recent entries unsummarized for context
```

**Summary Prompt Structure** (from `prompt_builder.py`):
```
Timeline & Commitments:
- YYYY-MM-DD HH:MM — event/meeting with participants, status

Pending & Follow-ups:
- Due YYYY-MM-DD — task with owner, status, next step

Routines & Recurring:
- Cadence — habit/reminder with channel, rules

Preferences & Profile:
- Stable preference or personal detail

Context & Notes:
- Strategic insight or configuration
```

**Key Differences**:

| Aspect | BlueBubbles | OpenPoke |
|--------|-------------|----------|
| Storage | PostgreSQL | File-based logs |
| Format | Key-value pairs | XML-tagged entries |
| Summarization | Not integrated | Automatic with threshold |
| Structure | Flat | Hierarchical (timeline, tasks, preferences) |
| Agent Memory | None | Per-agent log stores |
| Wait Tracking | None | Explicit `<wait>` entries |

---

## 2. Prompt System Comparison

### BlueBubbles Current Approach

**System Prompt** (`ClaudeServiceEnhanced.buildAgentGracePrompt`):
```typescript
// Hardcoded in TypeScript, ~20 lines
return `You are Grace, an executive assistant for Weldon Makori...

Core voice:
- Sound like a smart, caring professional peer.
- Default to short, direct bubbles (1-2 sentences)...

Message cadence:
- Treat responses like iMessage bubbles...

Dynamic length:
- Default to concise replies...

General rules:
- Acknowledge the user's message...`;
```

**Message Building** (`ClaudeServiceEnhanced.buildMessages`):
```typescript
// Simple concatenation of conversation history
messages = conversationHistory.map(msg => ({
  role: msg.role,
  content: msg.content
}));
messages.push({ role: 'user', content: processedContent });
```

**Issues Identified**:
1. **No structured context** — History is flat, no XML tags or sections
2. **No active agent awareness** — Claude doesn't know about pending tasks
3. **No tool usage guidelines** — System prompt doesn't explain when/how to use tools
4. **No duplicate prevention** — No `wait` tool or similar pattern
5. **Prompt in code** — Hard to iterate on prompt without code changes

---

### OpenPoke Approach

**System Prompt** (`system_prompt.md`):
```markdown
# 144 lines of detailed instructions in Markdown file

TOOLS
- send_message_to_agent: Primary tool for tasks
- send_message_to_user: For acknowledgements, updates
- send_draft: For email drafts (requires confirmation)
- wait: Prevents duplicate responses

Interaction Modes
- <new_user_message>: Acknowledge, explain, then delegate
- <new_agent_message>: Summarize results for user

Message Structure
- <conversation_history>: Previous exchanges
- <active_agents>: Currently running agents
- <new_user_message> or <new_agent_message>: Current input

Personality
- Witty and warm, but not overdone
- Terse and to the point
- Adapt to user's texting style
```

**Message Building** (`agent.py.prepare_message_with_history`):
```python
# Structured XML sections
content = """
<conversation_history>
{transcript}
</conversation_history>

<active_agents>
<agent name="email_handler" />
</active_agents>

<new_user_message>
{latest_text}
</new_user_message>
"""
```

**Key Differences**:

| Aspect | BlueBubbles | OpenPoke |
|--------|-------------|----------|
| Prompt Location | Hardcoded in TS | External .md file |
| Prompt Length | ~20 lines | ~144 lines |
| Tool Guidelines | None | Detailed per-tool |
| Message Structure | Flat | XML-tagged sections |
| Agent Awareness | None | `<active_agents>` section |
| Duplicate Prevention | None | `wait` tool documented |
| Personality | Brief | Detailed (wit, warmth, tone) |

---

## 3. Prompt + Code Integration Patterns

### BlueBubbles Pattern: Code-Centric

```
┌─────────────────────────────────────────────────────────┐
│                    TypeScript Code                       │
│                                                          │
│  buildAgentGracePrompt() {                              │
│    return `You are Grace...`;  // Prompt embedded       │
│  }                                                       │
│                                                          │
│  buildMessages(history, content) {                      │
│    return history.concat({ role: 'user', content });    │
│  }                                                       │
└─────────────────────────────────────────────────────────┘
```

**Pros**:
- Simple, all in one place
- Type-safe

**Cons**:
- Prompt changes require code changes
- Hard to A/B test prompts
- No separation of concerns
- Prompt buried in business logic

---

### OpenPoke Pattern: Separation of Concerns

```
┌─────────────────────────────────────────────────────────┐
│                 system_prompt.md                         │
│  (External file, easy to edit)                          │
│                                                          │
│  TOOLS                                                   │
│  - send_message_to_agent: ...                           │
│  - wait: ...                                            │
│                                                          │
│  Interaction Modes                                       │
│  - <new_user_message>: ...                              │
│  - <new_agent_message>: ...                             │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Python Code                           │
│                                                          │
│  SYSTEM_PROMPT = Path("system_prompt.md").read_text()   │
│                                                          │
│  def prepare_message_with_history(text, transcript):    │
│    return f"""                                          │
│    <conversation_history>{transcript}</conversation_history>
│    <active_agents>{render_agents()}</active_agents>     │
│    <new_user_message>{text}</new_user_message>          │
│    """                                                   │
└─────────────────────────────────────────────────────────┘
```

**Pros**:
- Prompt can be edited without code changes
- Clear separation: prompt = what, code = how
- Structured context with XML tags
- Easy to version control prompts separately

**Cons**:
- Slightly more complex setup
- Need to ensure prompt file exists

---

## 4. Recommendations for BlueBubbles

### Priority 1: Externalize System Prompt

**Current**:
```typescript
// src/services/ClaudeServiceEnhanced.ts
private buildAgentGracePrompt(): string {
  return `You are Grace...`;
}
```

**Recommended**:
```typescript
// src/agents/prompts/grace_system_prompt.md
// (External file with full prompt)

// src/services/ClaudeServiceEnhanced.ts
import { readFileSync } from 'fs';
import { join } from 'path';

const GRACE_PROMPT_PATH = join(__dirname, '../agents/prompts/grace_system_prompt.md');
const GRACE_SYSTEM_PROMPT = readFileSync(GRACE_PROMPT_PATH, 'utf-8');

private buildAgentGracePrompt(): string {
  return GRACE_SYSTEM_PROMPT;
}
```

---

### Priority 2: Add Structured Message Context

**Current**:
```typescript
// Flat message array
messages = [
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: 'hi' },
  { role: 'user', content: 'new message' }
];
```

**Recommended**:
```typescript
// Structured XML context
const context = `
<conversation_summary>
${workingMemorySummary}
</conversation_summary>

<recent_messages>
${recentMessages.map(m => `<${m.role}_message timestamp="${m.timestamp}">${m.content}</${m.role}_message>`).join('\n')}
</recent_messages>

<user_context>
${userPreferences}
</user_context>

<new_user_message>
${currentMessage}
</new_user_message>
`;

messages = [{ role: 'user', content: context }];
```

---

### Priority 3: Implement Working Memory Log

**New File**: `src/services/WorkingMemoryLog.ts`

```typescript
interface SummaryState {
  summaryText: string;
  lastIndex: number;
  updatedAt: Date | null;
  unsummarizedEntries: LogEntry[];
}

interface LogEntry {
  tag: string;
  payload: string;
  timestamp: string;
  index: number;
}

class WorkingMemoryLog {
  private path: string;
  
  appendEntry(tag: string, payload: string): void;
  loadSummaryState(): SummaryState;
  writeSummaryState(state: SummaryState): void;
  renderTranscript(): string;
}
```

---

### Priority 4: Add Summarization Integration

**New File**: `src/services/ConversationSummarizationService.ts`

```typescript
// Triggered when unsummarized entries exceed threshold
async function summarizeConversation(userId: string, conversationId: string): Promise<void> {
  const workingMemory = getWorkingMemoryLog(userId, conversationId);
  const state = workingMemory.loadSummaryState();
  
  const threshold = config.summarization.threshold; // e.g., 10
  const tailSize = config.summarization.tailSize;   // e.g., 3
  
  if (state.unsummarizedEntries.length < threshold + tailSize) {
    return; // Not enough entries to summarize
  }
  
  const batch = state.unsummarizedEntries.slice(0, threshold);
  const newSummary = await generateSummary(state.summaryText, batch);
  
  const newState: SummaryState = {
    summaryText: newSummary,
    lastIndex: batch[batch.length - 1].index,
    updatedAt: new Date(),
    unsummarizedEntries: state.unsummarizedEntries.slice(threshold)
  };
  
  workingMemory.writeSummaryState(newState);
}
```

---

### Priority 5: Enhance System Prompt

**New File**: `src/agents/prompts/grace_system_prompt.md`

```markdown
You are Grace, an executive assistant for Weldon Makori, CEO of EverJust.

## TOOLS

### create_reminder
Use this when the user asks to be reminded about something. Always confirm the time and content before creating.

### list_reminders
Use this to show the user their pending reminders.

### cancel_reminder
Use this when the user wants to cancel a reminder. Confirm which one first.

## MESSAGE STRUCTURE

Your input follows this structure:
- `<conversation_summary>`: Summarized history (if available)
- `<recent_messages>`: Last few exchanges
- `<user_context>`: User preferences and profile
- `<new_user_message>`: The current message to respond to

## INTERACTION GUIDELINES

1. **Acknowledge first** — Let the user know you understood their request
2. **Use tools when appropriate** — Don't mention tool names to the user
3. **Avoid duplicates** — Check conversation history before repeating information
4. **Match user's style** — If they're brief, be brief. If they use emojis, you can too.

## PERSONALITY

- Sound like a smart, caring professional peer
- Default to short, direct bubbles (1-2 sentences)
- Mirror the user's energy while keeping things calm and confident
- No over-apologizing, no corporate fluff

## MESSAGE CADENCE

- Treat responses like iMessage bubbles
- Use "||" delimiter for multiple bubbles
- Avoid more than three bubbles unless critical

## NEVER SAY

- "Let me know if you need anything else"
- "How can I help you?"
- "I apologize for the confusion"
```

---

## 5. Database Schema Recommendations

### Current Schema (Sufficient but Underutilized)

```sql
-- context_memory table exists but not actively populated
CREATE TABLE context_memory (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID,
  memory_type VARCHAR(50), -- 'working' | 'session' | 'long_term'
  key VARCHAR(255),
  value TEXT,
  metadata JSONB,
  expires_at TIMESTAMP,
  embedding JSONB
);
```

### Recommended Additions

```sql
-- Working memory state per user/conversation
CREATE TABLE working_memory_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  conversation_id UUID,
  summary_text TEXT,
  last_entry_index INTEGER DEFAULT -1,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);

-- Conversation log entries (append-only)
CREATE TABLE conversation_log_entries (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  entry_index INTEGER NOT NULL,
  tag VARCHAR(50) NOT NULL, -- 'user_message', 'assistant_message', 'wait'
  payload TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(conversation_id, entry_index)
);
CREATE INDEX idx_conv_log_conv_id ON conversation_log_entries(conversation_id);
CREATE INDEX idx_conv_log_entry_index ON conversation_log_entries(entry_index);
```

---

## 6. Implementation Priority Matrix

| Task | Impact | Effort | Priority |
|------|--------|--------|----------|
| Externalize system prompt to .md file | High | Low | **P1** |
| Add tool usage guidelines to prompt | High | Low | **P1** |
| Add structured XML context to messages | High | Medium | **P2** |
| Implement WorkingMemoryLog | High | Medium | **P2** |
| Integrate ConversationSummarizer | Medium | Medium | **P3** |
| Add working_memory_state table | Medium | Low | **P3** |
| Add conversation_log_entries table | Medium | Medium | **P4** |
| Implement per-agent log stores | Low | High | **P5** |

---

## 7. Summary

### What BlueBubbles Does Well
- Clean TypeORM entity structure
- Memory tier concept (working/session/long_term)
- ConversationSummarizer exists (just not integrated)
- Good foundation for expansion

### What OpenPoke Does Better
- **Structured prompts** — External .md files, easy to iterate
- **XML-tagged context** — Clear sections for LLM to parse
- **Working memory with summarization** — Automatic context compression
- **Agent awareness** — `<active_agents>` section
- **Duplicate prevention** — `wait` tool pattern
- **Per-agent memory** — Execution agents have their own logs

### Key Takeaways
1. **Externalize prompts** — Biggest quick win
2. **Structure context with XML** — Helps LLM understand sections
3. **Implement working memory** — Critical for long conversations
4. **Add tool guidelines to prompt** — Claude needs to know when/how to use tools
5. **Consider append-only logs** — Simpler than complex DB queries for history
