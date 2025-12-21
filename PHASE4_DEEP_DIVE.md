# Phase 4 Deep Dive: Thinking, Questions, and Review Plan

## Purpose
This document captures structured thinking about Phase 4 implementation to identify hidden risks, edge cases, and ensure we have truly high confidence before implementation.

---

# PART 1: STRUCTURED THINKING

## Task 4.1: Externalize System Prompt

### Current State
- Prompt is hardcoded in `ClaudeServiceEnhanced.buildAgentGracePrompt()` (lines 515-536)
- ~20 lines, basic personality and message cadence instructions
- No tool usage guidelines
- No structured context awareness

### What We Want
- External `.md` file that can be edited without code changes
- Expanded prompt with tool guidelines, personality, interaction modes
- Easy to A/B test different prompts

### Thinking Through the Implementation

**Step 1: Where should the file live?**
- Option A: `src/agents/prompts/grace_system_prompt.md`
- Option B: `prompts/grace_system_prompt.md` (project root)
- Option C: `config/prompts/grace_system_prompt.md`

**Consideration**: TypeScript compiles to `dist/`. If file is in `src/`, we need to copy it.

**Step 2: When should we read the file?**
- Option A: Once at module load (like OpenPoke)
- Option B: Every request (allows hot reload)
- Option C: Cached with TTL (balance)

**Consideration**: For production, once at load is fine. For development, hot reload is nice.

**Step 3: What if the file is missing?**
- Option A: Crash on startup (fail fast)
- Option B: Fall back to hardcoded default
- Option C: Log warning and use default

**Consideration**: Fail fast is safer for production. But we need the fallback during development.

**Step 4: How do we test this?**
- Unit test: Mock file system, verify prompt loaded
- Integration test: Verify Claude receives correct prompt
- Manual test: Change prompt, verify behavior changes

### Edge Cases to Consider
1. File exists but is empty
2. File has invalid encoding (not UTF-8)
3. File is very large (>100KB)
4. File permissions prevent reading
5. File path has special characters
6. Running in Docker vs local development

### Questions to Answer
- [ ] Q1.1: What's the best file location for both dev and prod?
- [ ] Q1.2: Should we support hot reload in development?
- [ ] Q1.3: What's the fallback behavior if file is missing?
- [ ] Q1.4: How do we handle prompt versioning/history?
- [ ] Q1.5: Should prompt support template variables (e.g., {{user_name}})?

---

## Task 4.2: Add Structured XML Context

### Current State
- `buildMessages()` creates flat message array (lines 241-333)
- Conversation history added as separate messages
- Current message added at end
- No structured sections, no summary, no user context

### What We Want
- Single user message with XML-tagged sections
- `<conversation_summary>` for compressed history
- `<recent_messages>` for last few exchanges
- `<user_context>` for preferences/profile
- `<new_user_message>` for current input

### Thinking Through the Implementation

**Step 1: How does this change the message structure?**

Current:
```
messages = [
  { role: 'user', content: 'msg1' },
  { role: 'assistant', content: 'resp1' },
  { role: 'user', content: 'msg2' },
  { role: 'assistant', content: 'resp2' },
  { role: 'user', content: 'current message' }
]
```

Proposed:
```
messages = [
  { role: 'user', content: `
    <conversation_summary>
    User asked about weather, assistant provided forecast...
    </conversation_summary>
    
    <recent_messages>
    <user_message>msg2</user_message>
    <assistant_message>resp2</assistant_message>
    </recent_messages>
    
    <user_context>
    Timezone: America/Chicago
    Preferences: concise responses
    </user_context>
    
    <new_user_message>
    current message
    </new_user_message>
  ` }
]
```

**Step 2: What about multi-modal content (images)?**
- Current code handles images in `buildMessages()` (lines 260-270)
- Images are added as content blocks
- Need to preserve this in new structure

**Consideration**: Images should be in `<new_user_message>` section, but as content blocks not text.

**Step 3: How many recent messages to include?**
- Too few: Lose context
- Too many: Waste tokens, duplicate summary
- OpenPoke: Uses tail_size of 3-5

**Consideration**: Make configurable. Start with 5 recent messages.

**Step 4: Where does the summary come from?**
- Depends on Task 4.3 (Working Memory Log)
- If no summary yet, omit section or use empty
- Need graceful degradation

**Step 5: Where does user context come from?**
- `ContextService.getUserMemories()` exists
- Currently not called in message flow
- Need to wire this up

### Edge Cases to Consider
1. No conversation history (first message)
2. No summary available yet
3. No user context stored
4. Very long summary (token budget)
5. Special characters in messages (XML escaping)
6. Multi-modal messages (images + text)
7. Tool results in history

### Questions to Answer
- [ ] Q2.1: How to handle images in XML structure?
- [ ] Q2.2: What's the token budget for each section?
- [ ] Q2.3: How to escape special characters in XML?
- [ ] Q2.4: Should tool results be in recent_messages?
- [ ] Q2.5: What if summary is longer than recent messages?
- [ ] Q2.6: How does this affect Claude's response quality?

---

## Task 4.3: Implement Working Memory Log

### Current State
- `ConversationSummarizer` exists but not integrated
- `ContextService` has memory tiers but not used for summaries
- Messages stored in `Message` entity
- No working memory state tracking

### What We Want
- Track summarization state per conversation
- Automatically summarize when threshold exceeded
- Background processing (don't block responses)
- Summary available for XML context (Task 4.2)

### Thinking Through the Implementation

**Step 1: What state do we need to track?**
```typescript
interface WorkingMemoryState {
  userId: string;
  conversationId: string;
  summaryText: string;           // The actual summary
  lastSummarizedMessageId: string; // Last message included in summary
  updatedAt: Date;
}
```

**Step 2: How do we know when to summarize?**

Option A: Message count threshold
```
unsummarizedCount = totalMessages - summarizedMessages
if (unsummarizedCount >= threshold) { summarize() }
```

Option B: Token count threshold
```
unsummarizedTokens = estimateTokens(unsummarizedMessages)
if (unsummarizedTokens >= threshold) { summarize() }
```

Option C: Both (whichever triggers first)

**Consideration**: Token-based is more accurate but slower. Message count is simpler.

**Step 3: How do we trigger summarization?**

Option A: Inline (after each message)
- Pro: Always up to date
- Con: Adds latency to every response

Option B: Background job (BullMQ)
- Pro: No latency impact
- Con: Summary may be stale

Option C: Scheduled (every N minutes)
- Pro: Predictable load
- Con: May miss recent context

**Consideration**: Background job is best. BullMQ already configured.

**Step 4: What happens during summarization?**
```
1. Load unsummarized messages from DB
2. Load existing summary (if any)
3. Call ConversationSummarizer with both
4. Save new summary to WorkingMemoryState
5. Update lastSummarizedMessageId
```

**Step 5: What if summarization fails?**
- Retry with exponential backoff
- Log error but don't crash
- Use stale summary until next attempt

**Step 6: What about concurrent summarizations?**
- Same conversation could trigger multiple jobs
- Need deduplication or locking
- BullMQ has job deduplication options

### Edge Cases to Consider
1. First message (no history to summarize)
2. Very long conversation (summary of summary?)
3. Summarization fails repeatedly
4. Concurrent messages trigger multiple jobs
5. User deletes messages (summary becomes stale)
6. Conversation spans multiple days
7. Summary exceeds token budget
8. Database connection lost during summarization

### Questions to Answer
- [ ] Q3.1: Message count vs token count for threshold?
- [ ] Q3.2: How to handle concurrent summarization jobs?
- [ ] Q3.3: What's the retry strategy for failed summarizations?
- [ ] Q3.4: Should we summarize the summary for very long conversations?
- [ ] Q3.5: How to handle stale summaries after message deletion?
- [ ] Q3.6: What's the performance impact of loading all unsummarized messages?
- [ ] Q3.7: Should we use the OpenPoke structured summary prompt?

---

# PART 2: REVIEW PLAN

## Task 4.1 Review Subtasks

### 4.1.A: File Location Decision
- [ ] Review how other Node.js projects handle asset files
- [ ] Check if `tsconfig.json` can copy non-TS files
- [ ] Test file reading from different locations
- [ ] Decide on final location

### 4.1.B: Error Handling Design
- [ ] Define behavior for missing file
- [ ] Define behavior for empty file
- [ ] Define behavior for read errors
- [ ] Write error handling code pattern

### 4.1.C: Testing Strategy
- [ ] Design unit tests for prompt loading
- [ ] Design integration tests for prompt usage
- [ ] Plan manual testing approach

### 4.1.D: Template Variables (Optional)
- [ ] Decide if we need template variables
- [ ] If yes, design variable syntax
- [ ] Implement variable substitution

---

## Task 4.2 Review Subtasks

### 4.2.A: Message Structure Design
- [ ] Document exact XML structure
- [ ] Handle multi-modal content (images)
- [ ] Handle tool results
- [ ] Define escaping strategy

### 4.2.B: Token Budget Analysis
- [ ] Measure current token usage
- [ ] Allocate budget per section
- [ ] Implement truncation if needed

### 4.2.C: Integration Points
- [ ] Map exact code changes in `buildMessages()`
- [ ] Identify where to get summary
- [ ] Identify where to get user context
- [ ] Plan backward compatibility

### 4.2.D: Testing Strategy
- [ ] Test with various message types
- [ ] Test with missing sections
- [ ] Test token limits
- [ ] Verify Claude response quality

---

## Task 4.3 Review Subtasks

### 4.3.A: Database Schema Design
- [ ] Finalize `WorkingMemoryState` entity
- [ ] Create migration file
- [ ] Add indexes for performance
- [ ] Test schema with sample data

### 4.3.B: Summarization Trigger Design
- [ ] Choose threshold type (message vs token)
- [ ] Set threshold values
- [ ] Design trigger logic in `saveMessage()`
- [ ] Handle edge cases

### 4.3.C: Background Job Design
- [ ] Create summarization queue
- [ ] Design job payload
- [ ] Implement job processor
- [ ] Handle job deduplication
- [ ] Implement retry logic

### 4.3.D: Summarization Logic
- [ ] Review `ConversationSummarizer` code
- [ ] Decide if prompt needs enhancement
- [ ] Handle incremental summarization
- [ ] Handle very long conversations

### 4.3.E: Integration with Task 4.2
- [ ] Design API for getting summary
- [ ] Handle missing/stale summary
- [ ] Test end-to-end flow

### 4.3.F: Performance Analysis
- [ ] Estimate DB query cost
- [ ] Estimate LLM call cost
- [ ] Measure latency impact
- [ ] Plan optimization if needed

---

# PART 3: INVESTIGATION TASKS

## Immediate Investigations Needed

### Investigation 1: Current Token Usage
**Goal**: Understand current token consumption to set budgets
**Steps**:
1. Add logging to capture actual token usage per request
2. Run several test conversations
3. Analyze: How many tokens for history? For response?
4. Document findings

### Investigation 2: BullMQ Current Setup
**Goal**: Understand existing queue infrastructure
**Steps**:
1. Find where BullMQ is configured
2. Review reminder queue implementation
3. Understand connection settings
4. Plan summarization queue

### Investigation 3: ConversationSummarizer Quality
**Goal**: Evaluate if current summarizer is good enough
**Steps**:
1. Run summarizer on sample conversations
2. Evaluate summary quality
3. Compare to OpenPoke prompt
4. Decide if enhancement needed

### Investigation 4: Message Entity Analysis
**Goal**: Confirm Message entity has all needed fields
**Steps**:
1. Review Message entity schema
2. Check if we can track summarization state
3. Verify query performance for fetching unsummarized

### Investigation 5: ContextService Usage
**Goal**: Understand how to get user context
**Steps**:
1. Review `getUserMemories()` method
2. Check if any code calls it
3. Understand what context is available
4. Plan integration

---

# PART 4: RISK ASSESSMENT

## High Risk Items

### Risk 1: XML Escaping Bugs
**Impact**: Malformed prompts, Claude errors
**Mitigation**: Use proper XML escaping library, comprehensive tests

### Risk 2: Token Budget Exceeded
**Impact**: API errors, truncated context
**Mitigation**: Implement token counting, truncation logic

### Risk 3: Summarization Latency
**Impact**: Stale summaries, poor context
**Mitigation**: Tune thresholds, monitor job queue

### Risk 4: Concurrent Summarization Race
**Impact**: Duplicate work, inconsistent state
**Mitigation**: Job deduplication, database locking

## Medium Risk Items

### Risk 5: Prompt File Missing in Production
**Impact**: Service fails to start or uses wrong prompt
**Mitigation**: Fail fast on startup, include in deployment

### Risk 6: Summary Quality
**Impact**: Poor context, worse responses
**Mitigation**: Test with real conversations, iterate on prompt

### Risk 7: Backward Compatibility
**Impact**: Existing conversations break
**Mitigation**: Graceful degradation, empty defaults

---

# PART 5: NEXT STEPS

## Before Implementation

1. **Complete Investigation 1-5** (1-2 hours)
   - Get concrete data on token usage
   - Verify BullMQ setup
   - Test summarizer quality

2. **Answer All Questions** (30 min)
   - Go through Q1.1-Q3.7
   - Document decisions

3. **Finalize Design Decisions** (30 min)
   - File location for prompt
   - XML structure details
   - Threshold values

4. **Create Test Plan** (30 min)
   - Unit tests needed
   - Integration tests needed
   - Manual test scenarios

## Implementation Order

1. Task 4.1 (Externalize Prompt) - 30-45 min
2. Task 4.3 (Working Memory) - 2-3 hours
3. Task 4.2 (XML Context) - 1-2 hours
4. Integration Testing - 1 hour
5. Documentation - 30 min

---

# PART 6: QUESTIONS SUMMARY

## Must Answer Before Implementation

| ID | Question | Status | Answer |
|----|----------|--------|--------|
| Q1.1 | Best file location for prompt? | ✅ ANSWERED | `src/agents/prompts/` with copy in build script |
| Q1.2 | Support hot reload in dev? | ✅ ANSWERED | No, read once at module load (simpler) |
| Q1.3 | Fallback if file missing? | ✅ ANSWERED | Log error + use hardcoded default |
| Q2.1 | How to handle images in XML? | ✅ ANSWERED | Keep as content blocks inside `<new_user_message>` |
| Q2.2 | Token budget per section? | ✅ ANSWERED | Summary: 500, Recent: 1000, Context: 200 |
| Q2.3 | XML escaping strategy? | ✅ ANSWERED | Use `he` library or simple replace for `<>&` |
| Q3.1 | Message vs token threshold? | ✅ ANSWERED | Message count (10) - simpler, config already has token thresholds |
| Q3.2 | Handle concurrent jobs? | ✅ ANSWERED | BullMQ `jobId` deduplication per conversation |
| Q3.3 | Retry strategy? | ✅ ANSWERED | 3 retries with exponential backoff (BullMQ default) |

## Can Answer During Implementation

| ID | Question | Status |
|----|----------|--------|
| Q1.4 | Prompt versioning? | Defer |
| Q1.5 | Template variables? | Defer |
| Q2.4 | Tool results in history? | Defer |
| Q2.5 | Summary vs recent length? | Defer |
| Q3.4 | Summary of summary? | Defer |
| Q3.5 | Handle message deletion? | Defer |
| Q3.6 | Performance of loading messages? | Defer |
| Q3.7 | Use OpenPoke prompt? | Defer |

---

# PART 7: CODE INVESTIGATION FINDINGS

## Finding 1: BullMQ Already Configured
**Location**: `src/services/ReminderService.ts` lines 20-27
```typescript
this.reminderQueue = new Bull('reminders', {
  redis: {
    port: 6379,
    host: new URL(config.redis.url).hostname,
    password: new URL(config.redis.url).password
  }
});
```
**Implication**: Can create `summarizationQueue` with same pattern.

## Finding 2: Message Entity Has All Needed Fields
**Location**: `src/database/entities/Message.ts`
- `id` (UUID) - can track last summarized
- `conversationId` - for filtering
- `role` - user/assistant
- `content` - the text
- `createdAt` - for ordering
- `tokensUsed` - already tracking tokens!

**Implication**: No new entity needed for log entries. Just need `WorkingMemoryState`.

## Finding 3: Config Has Token Thresholds
**Location**: `src/config/index.ts` lines 76-78
```typescript
summaryTriggerTokens: parseInt(process.env.ANTHROPIC_SUMMARY_TRIGGER_TOKENS || '4000', 10),
contextWindowTokens: parseInt(process.env.ANTHROPIC_CONTEXT_WINDOW_TOKENS || '6000', 10),
responseMaxTokens: parseInt(process.env.ANTHROPIC_RESPONSE_MAX_TOKENS || '600', 10),
```
**Implication**: Token budgets already defined. Can use for section allocation.

## Finding 4: Config Uses `path.join(__dirname, ...)`
**Location**: `src/config/index.ts` line 6
```typescript
dotenv.config({ path: path.join(__dirname, '../../.env') });
```
**Implication**: Same pattern works for prompt file. `__dirname` resolves correctly in compiled output.

---

# PART 8: REVISED CONFIDENCE ASSESSMENT

## Task 4.1: Externalize Prompt
| Aspect | Confidence | Notes |
|--------|------------|-------|
| File location | 98% | Use `__dirname` pattern from config |
| Error handling | 95% | Fallback to hardcoded default |
| Build integration | 90% | Need to add copy step to package.json |
| **Overall** | **95%** | Ready to implement |

## Task 4.2: XML Context
| Aspect | Confidence | Notes |
|--------|------------|-------|
| Message structure | 95% | Clear design, single user message |
| Image handling | 90% | Keep as content blocks |
| Token budgets | 90% | Use existing config values |
| Integration point | 95% | `buildMessages()` is clear |
| **Overall** | **92%** | Ready to implement |

## Task 4.3: Working Memory
| Aspect | Confidence | Notes |
|--------|------------|-------|
| Database schema | 95% | Simple entity, follows existing patterns |
| BullMQ integration | 95% | Copy ReminderService pattern |
| Summarization logic | 85% | Reuse ConversationSummarizer |
| Concurrency handling | 90% | BullMQ jobId deduplication |
| Performance | 80% | Need to test with real data |
| **Overall** | **90%** | Ready to implement |

---

# PART 9: IMPLEMENTATION CHECKLIST

## Pre-Implementation
- [x] Reviewed BullMQ setup in ReminderService
- [x] Reviewed Message entity schema
- [x] Reviewed config patterns
- [x] Answered all critical questions
- [ ] Create test conversation data (optional)

## Task 4.1 Implementation Steps
1. [ ] Create `src/agents/prompts/` directory
2. [ ] Create `grace_system_prompt.md` with expanded prompt
3. [ ] Update `ClaudeServiceEnhanced.ts` to read from file
4. [ ] Add fallback for missing file
5. [ ] Update `package.json` build script to copy prompts
6. [ ] Test prompt loading

## Task 4.3 Implementation Steps (Before 4.2)
1. [ ] Create `WorkingMemoryState` entity
2. [ ] Create database migration
3. [ ] Create `SummarizationService.ts`
4. [ ] Create summarization BullMQ queue
5. [ ] Add trigger in `MessageRouter.saveMessage()`
6. [ ] Implement job processor
7. [ ] Test summarization flow

## Task 4.2 Implementation Steps
1. [ ] Create `buildStructuredContext()` method
2. [ ] Update `buildMessages()` to use structured context
3. [ ] Add XML escaping utility
4. [ ] Wire up summary from WorkingMemoryState
5. [ ] Wire up user context from ContextService
6. [ ] Test with various message types
7. [ ] Verify Claude response quality
