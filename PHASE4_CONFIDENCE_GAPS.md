# Phase 4 Confidence Gap Analysis

## Goal: Increase confidence from current levels to 90%+

**Last Updated**: After code review on Dec 20, 2025

---

## Task 4.1: Externalize System Prompt (Current: 95% → 98%)

### What I Know ✅
- How to read files in Node.js (`fs.readFileSync`)
- OpenPoke pattern: `Path(__file__).parent / "system_prompt.md"`
- Current prompt location: `ClaudeServiceEnhanced.buildAgentGracePrompt()` (lines 515-536)
- **tsconfig.json** uses `outDir: ./dist` and `rootDir: ./src`

### What I'm Missing ❓
- [x] **File path resolution in TypeScript** — RESOLVED: Use `__dirname` which works in both dev and prod
- [x] **Hot reload consideration** — RESOLVED: Read once at module load (like OpenPoke)
- [ ] **Error handling** — Need graceful fallback if file missing

### RESOLVED: How to Include .md Files in Build

**Option 1 (Recommended)**: Use npm script to copy assets
```json
// package.json
"scripts": {
  "build": "tsc && cp -r src/agents/prompts dist/agents/"
}
```

**Option 2**: Read from project root (not dist)
```typescript
import { join } from 'path';
import { readFileSync } from 'fs';

// Resolve relative to project root, not compiled output
const PROMPT_PATH = join(process.cwd(), 'src/agents/prompts/grace_system_prompt.md');
const GRACE_PROMPT = readFileSync(PROMPT_PATH, 'utf-8');
```

**Option 3**: Embed at build time (esbuild/webpack)
- More complex, not needed for this use case

### Confidence: 98%
- Simple implementation
- Only remaining question: error handling for missing file

---

## Task 4.2: Add Structured XML Context (Current: 85% → 92%)

### What I Know ✅
- OpenPoke XML structure: `<conversation_history>`, `<active_agents>`, `<new_user_message>`
- Current message building in `ClaudeServiceEnhanced.buildMessages()` (lines 241-333)
- Claude handles XML-like tags well for structured input

### RESOLVED: Integration Points Found

**Message Flow Traced**:
```
MessageRouter.handleIncomingMessage() (line 189)
  → getConversationHistory() (line 845) - fetches last 20 messages
  → claudeService.sendMessage(processedMessage, conversationHistory, toolContext) (line 305)
      → buildMessages(processedMessages, conversationHistory) (line 103)
          → Adds history as flat messages (lines 247-253)
          → Adds current message (lines 256-296)
```

**Integration Point**: Modify `buildMessages()` to wrap content in XML tags

### RESOLVED: Token Impact
- XML tags add ~10-20 tokens overhead per section
- Current `responseMaxTokens` is 600 (line 55-57)
- Minimal impact compared to conversation content

### RESOLVED: Message Format Decision
- **Single user message with XML sections** (like OpenPoke)
- Not multiple messages — Claude API requires alternating roles

### Remaining Questions
- [ ] **Where to get summary?** — Need working memory log first (Task 4.3)
- [ ] **User context source?** — `ContextService.getUserMemories()` exists but not called

### Implementation Sketch
```typescript
private buildMessages(
  processedMessages: ProcessedMessage[],
  conversationHistory: Array<{role: string; content: string}>,
  workingMemorySummary?: string,  // NEW
  userContext?: string            // NEW
): any[] {
  // Build structured context as single user message
  const structuredContext = this.buildStructuredContext(
    workingMemorySummary,
    conversationHistory.slice(-10), // Recent only
    userContext,
    processedMessages[0]?.text || ''
  );
  
  return [{ role: 'user', content: structuredContext }];
}
```

### Confidence: 92%
- Integration point clear
- Depends on Task 4.3 for summary data
- User context source identified

---

## Task 4.3: Implement Working Memory Log (Current: 75% → 88%)

### What I Know ✅
- OpenPoke uses file-based append-only logs
- Summarization triggered when entries exceed threshold
- `SummaryState` tracks: `summary_text`, `last_index`, `unsummarized_entries`
- BlueBubbles has `ConversationSummarizer` (unused but functional)
- BlueBubbles has `ContextMemory` entity (underutilized)
- **BullMQ already set up** for reminders (can reuse for background summarization)

### RESOLVED: Architecture Decisions

#### Decision 1: Database Storage (Not File-Based)
**Rationale**:
- BlueBubbles already uses PostgreSQL + TypeORM
- Need per-user, per-conversation state (files would be messy)
- Easier to query and manage
- Already have `ContextMemory` entity pattern to follow

**Schema**:
```typescript
@Entity('working_memory_state')
export class WorkingMemoryState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string;

  @Column({ name: 'summary_text', type: 'text', default: '' })
  summaryText!: string;

  @Column({ name: 'last_entry_index', type: 'integer', default: -1 })
  lastEntryIndex!: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

#### Decision 2: Background Summarization via BullMQ
**Rationale**:
- Don't add latency to user responses
- BullMQ already configured for reminders
- Can debounce multiple messages

**Pattern** (from OpenPoke `scheduler.py`):
```typescript
// After each message saved:
if (unsummarizedCount >= threshold) {
  await summarizationQueue.add('summarize', {
    userId,
    conversationId
  }, {
    delay: 1000,  // Debounce
    removeOnComplete: true
  });
}
```

#### Decision 3: Augment ContextService (Don't Replace)
**Rationale**:
- `ContextService.buildConversationContext()` already exists
- Add working memory as another source
- Keep existing memory tiers (working/session/long_term)

### RESOLVED: Entry Format

Use existing `Message` entity — no new log entries table needed!
- Messages already have `conversationId`, `role`, `content`, `createdAt`
- Just need to track `lastSummarizedMessageId` in `WorkingMemoryState`

### RESOLVED: Summarization Trigger

From OpenPoke config and our existing settings:
```typescript
const SUMMARY_THRESHOLD = 10;  // Summarize after 10 unsummarized messages
const SUMMARY_TAIL_SIZE = 3;   // Keep last 3 messages unsummarized
```

Already have in `config.ts`:
- `summaryTriggerTokens: 5500`
- `contextWindowTokens: 7000`

### RESOLVED: Integration with Existing Code

**Existing `ConversationSummarizer`** (lines 25-63):
```typescript
async summarize(turns: ConversationTurn[]): Promise<string>
```
- Already works!
- Just need to call it from background job

**Integration Flow**:
```
1. MessageRouter.saveMessage() → triggers check
2. If unsummarized count > threshold:
   a. Queue background job
3. Background job:
   a. Load unsummarized messages from DB
   b. Call ConversationSummarizer.summarize()
   c. Update WorkingMemoryState.summaryText
   d. Update WorkingMemoryState.lastEntryIndex
4. ClaudeServiceEnhanced.buildMessages():
   a. Load WorkingMemoryState.summaryText
   b. Include in XML context
```

### Remaining Questions
- [ ] **Summarization prompt quality** — Current `ConversationSummarizer` prompt is basic; may need OpenPoke-style structured prompt
- [ ] **Migration** — How to handle existing conversations without working memory?

### Confidence: 88%
- Architecture decisions made
- Integration points clear
- Existing code can be reused
- Only prompt quality and migration are open questions

---

## Specific Questions — RESOLVED

### Architecture Questions
1. **File vs Database for working memory?** ✅ RESOLVED
   - **Decision**: Database (PostgreSQL + TypeORM)
   - **Rationale**: Multi-user, per-conversation state; already have DB infrastructure

2. **Summarization trigger mechanism?** ✅ RESOLVED
   - **Decision**: Background job via BullMQ (already configured for reminders)
   - **Pattern**: Queue job after message save, with debounce delay

3. **How to integrate with existing systems?** ✅ RESOLVED
   - **Decision**: Augment, don't replace
   - Reuse `ConversationSummarizer` for actual summarization
   - Add `WorkingMemoryState` entity for state tracking
   - Integrate into `ClaudeServiceEnhanced.buildMessages()`

### Implementation Questions
4. **What's the entry schema for working memory log?** ✅ RESOLVED
   - **Decision**: No new schema needed!
   - Use existing `Message` entity (already has conversationId, role, content, createdAt)
   - Track `lastSummarizedMessageId` in `WorkingMemoryState`

5. **How to handle the summarization prompt?** ⚠️ PARTIALLY RESOLVED
   - Current `ConversationSummarizer` prompt is basic (line 16):
     `"You are an expert note taker. Summarize the conversation succinctly..."`
   - **Recommendation**: Upgrade to OpenPoke-style structured prompt (Timeline, Pending, Preferences)
   - Can be done as enhancement after initial implementation

6. **What's the right threshold for summarization?** ✅ RESOLVED
   - **Decision**: Use existing config values
   - `summaryTriggerTokens: 5500` (from config.ts)
   - Or message count: 10 messages threshold, 3 tail size

### Code Questions
7. **Where to hook into message flow?** ✅ RESOLVED
   - Hook in `MessageRouter.saveMessage()` (line 823)
   - After both user and assistant messages saved
   - Check unsummarized count, queue job if threshold exceeded

8. **How to pass summary to Claude?** ✅ RESOLVED
   - **Decision**: Part of user message in XML context (Task 4.2)
   - `<conversation_summary>...</conversation_summary>` section

---

## Files Reviewed ✅

### BlueBubbles (Current Implementation)
- [x] `src/services/MessageRouter.ts` — Message flow traced, hook point identified (line 823)
- [x] `src/services/ContextService.ts` — Memory system understood, can augment
- [x] `src/services/ConversationSummarizer.ts` — Existing summarizer works, can reuse
- [x] `src/services/ClaudeServiceEnhanced.ts` — buildMessages() is integration point (line 241)
- [x] `src/config.ts` — Has summaryTriggerTokens, contextWindowTokens
- [x] `tsconfig.json` — Reviewed for build output configuration

### OpenPoke (Reference Implementation)
- [x] `server/services/conversation/summarization/working_memory_log.py` — Full implementation reviewed
- [x] `server/services/conversation/summarization/scheduler.py` — Background trigger pattern understood
- [x] `server/services/conversation/summarization/prompt_builder.py` — Structured summary prompt

---

## Updated Confidence Levels (After Deep Dive)

| Task | Initial | After Research | After Deep Dive | Status |
|------|---------|----------------|-----------------|--------|
| 4.1 Externalize Prompt | 95% | 98% | **95%** | ✅ Ready |
| 4.2 XML Context | 85% | 92% | **92%** | ✅ Ready |
| 4.3 Working Memory Log | 75% | 88% | **90%** | ✅ Ready |

---

## Critical Questions Answered

| Question | Answer |
|----------|--------|
| File location for prompt? | `src/agents/prompts/` with copy in build script |
| Hot reload in dev? | No, read once at module load (simpler) |
| Fallback if file missing? | Log error + use hardcoded default |
| Images in XML? | Keep as content blocks inside `<new_user_message>` |
| Token budget per section? | Summary: 500, Recent: 1000, Context: 200 |
| XML escaping? | Simple replace for `<>&` characters |
| Message vs token threshold? | Message count (10) - simpler |
| Concurrent jobs? | BullMQ `jobId` deduplication per conversation |
| Retry strategy? | 3 retries with exponential backoff |

---

## Code Investigation Findings

### Finding 1: BullMQ Already Configured
`ReminderService.ts` lines 20-27 shows exact pattern to copy for summarization queue.

### Finding 2: Message Entity Has All Needed Fields
- `id`, `conversationId`, `role`, `content`, `createdAt`, `tokensUsed`
- No new log entries table needed!

### Finding 3: Config Has Token Thresholds
- `summaryTriggerTokens: 4000`
- `contextWindowTokens: 6000`
- `responseMaxTokens: 600`

### Finding 4: `__dirname` Pattern Works
`config/index.ts` uses `path.join(__dirname, ...)` - same pattern for prompt file.

---

## Remaining Low-Risk Questions (Defer)

1. **Summarization prompt quality** — Current prompt is basic; can enhance later
2. **Migration for existing conversations** — Start with empty summary, build over time
3. **Prompt versioning** — Not needed initially
4. **Template variables** — Not needed initially
5. **Summary of summary** — Handle if conversations get very long

---

## Implementation Order

1. **Task 4.1** (30-45 min) — Externalize prompt
2. **Task 4.3** (2-3 hrs) — Working memory log (enables 4.2)
3. **Task 4.2** (1-2 hrs) — XML context (uses summary from 4.3)

---

## Summary

**All critical questions answered. All architecture decisions made.**

Key decisions:
- ✅ Database storage (PostgreSQL + TypeORM)
- ✅ Background summarization via BullMQ (copy ReminderService pattern)
- ✅ Augment existing services (don't replace)
- ✅ Reuse existing `ConversationSummarizer`
- ✅ Use existing `Message` entity (no new log table)
- ✅ XML context in single user message
- ✅ `__dirname` pattern for file paths
- ✅ BullMQ jobId for deduplication

**Ready to implement Phase 4.**
