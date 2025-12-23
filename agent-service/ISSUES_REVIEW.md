# Agent Issues Review & Fix Plan

**Review Date**: December 22, 2025  
**Status**: In Progress

---

## Table of Contents

1. [Issue Analysis](#1-issue-analysis)
2. [Cascading Issues Identified](#2-cascading-issues-identified)
3. [Root Cause Analysis](#3-root-cause-analysis)
4. [Fix Plan](#4-fix-plan)

---

## 1. Issue Analysis

### Issue 1: Prompt Doesn't Explain XML Summary Format

**Severity**: Medium  
**Impact**: Agent won't know how to interpret structured context

**Details**:
- `WorkingMemoryLog.render()` generates XML-formatted context:
  ```xml
  <conversation_summary>...summary...</conversation_summary>
  <recent_messages>
    <user_message timestamp="...">content</user_message>
  </recent_messages>
  ```
- The system prompt (`grace_system_prompt.md`) has NO guidance on this format
- Agent may ignore or misinterpret this structured data

**Related Code**:
- `WorkingMemoryLog.ts:117-135` - generates XML
- `grace_system_prompt.md` - missing guidance

---

### Issue 2: No Debounce for Rapid Messages

**Severity**: Medium  
**Impact**: Multiple Claude calls for rapid user messages, wasted tokens, potential race conditions

**Details**:
- Each incoming message triggers `handleIncomingMessage()` immediately
- No batching/debounce window to collect rapid messages
- User sends "hey" → Claude call starts
- User sends "actually check weather" → Another Claude call starts
- Both calls may respond, causing confusion

**Current Flow**:
```
Message 1 arrives → handleIncomingMessage() → Claude call 1
Message 2 arrives → handleIncomingMessage() → Claude call 2
Message 3 arrives → handleIncomingMessage() → Claude call 3
```

**Desired Flow**:
```
Message 1 arrives → start 2-second debounce timer
Message 2 arrives → reset timer
Message 3 arrives → reset timer
Timer expires → handleIncomingMessage() with all 3 messages
```

**Related Code**:
- `MessageRouter.ts:380-382` - message listener with no debounce
- `MessageRouter.ts:441-751` - handleIncomingMessage processes immediately

---

### Issue 3: Summary Not Injected Into Prompts

**Severity**: HIGH  
**Impact**: Agent has no memory of past conversations - treats every conversation as fresh

**Details**:
- `WorkingMemoryLog` stores summaries and entries
- `WorkingMemoryLog.render()` method exists but is NEVER CALLED
- `buildPromptRuntimeContext()` builds context but doesn't include WorkingMemoryLog output
- The `runtimeContext` is passed to `toolContext` but NOT to Claude's system prompt

**Trace**:
```
1. Message arrives
2. buildPromptRuntimeContext() called (line 594)
3. runtimeContext stored in toolContext (line 601)
4. claudeService.sendMessage() called (line 650)
5. sendMessage() uses buildAgentGracePrompt() for system prompt (line 124)
6. buildAgentGracePrompt() returns ONLY the static markdown file
7. runtimeContext is NEVER injected into the prompt!
```

**The Gap**:
- `runtimeContext` contains: userProfile, userPreferences, memoryHighlights, activeTasks, activeReminders, conversationSummary, recentMessages
- But `buildAgentGracePrompt()` doesn't use ANY of this
- The context is built but thrown away

**Related Code**:
- `MessageRouter.ts:84-148` - builds runtimeContext
- `MessageRouter.ts:594-601` - stores in toolContext
- `ClaudeServiceEnhanced.ts:124` - ignores runtimeContext, uses static prompt
- `WorkingMemoryLog.ts:117-135` - render() never called

---

### Issue 4: conversation.metadata.summary May Be Empty

**Severity**: Medium  
**Impact**: Even if we fix Issue 3, summary might not exist

**Details**:
- `buildPromptRuntimeContext()` reads `conversation.metadata.summary` (line 104-106)
- This is only populated by `prepareConversationHistory()` when summarization triggers
- Summarization only triggers when token count exceeds threshold
- For new conversations, summary will always be empty

**Related Code**:
- `MessageRouter.ts:104-106` - reads summary
- `MessageRouter.ts:1039-1047` - writes summary to metadata
- Summarization threshold: 4000 tokens (config)

---

## 2. Cascading Issues Identified

### Cascade A: Context Never Reaches Claude

**Chain**:
1. Issue 3 (summary not injected) →
2. runtimeContext built but unused →
3. Agent has no user profile, preferences, or memory →
4. Agent treats every message as first contact →
5. No personalization, no continuity

### Cascade B: Dual Summarization Systems

**Problem**: Two separate summarization systems exist but don't integrate:

1. **WorkingMemoryLog + SummarizationService**:
   - Appends entries to WorkingMemoryLog
   - Triggers summarization at 20 entries
   - Stores summary in WorkingMemoryState entity
   - Has `render()` method for prompts
   - **NEVER USED IN PROMPTS**

2. **ConversationSummarizer + prepareConversationHistory**:
   - Summarizes when token count > threshold
   - Stores summary in conversation.metadata.summary
   - Used in runtimeContext
   - **runtimeContext NEVER INJECTED**

**Result**: Both systems work, neither output reaches Claude.

### Cascade C: Race Conditions with Rapid Messages

**Chain**:
1. Issue 2 (no debounce) →
2. Multiple concurrent Claude calls →
3. Each call fetches same conversation history →
4. Each call may respond →
5. Multiple responses sent to user →
6. Echo detection may catch some but not all →
7. Confusing user experience

### Cascade D: Fresh Start Every Time

**Chain**:
1. Issue 3 + Issue 4 →
2. No context injected →
3. Agent doesn't know user's name, timezone, preferences →
4. Agent doesn't remember previous conversations →
5. User has to re-explain everything each time

---

## 3. Root Cause Analysis

### Root Cause 1: Missing Context Injection Layer

**Problem**: There's no code that combines:
- Static system prompt (grace_system_prompt.md)
- Dynamic runtime context (runtimeContext)
- Working memory (WorkingMemoryLog.render())

**Evidence**:
```typescript
// ClaudeServiceEnhanced.ts:124
const finalSystemPrompt = systemPrompt || this.buildAgentGracePrompt();
// ^^^ Only uses static prompt, ignores toolContext.runtimeContext
```

### Root Cause 2: Architectural Gap

**Problem**: The code was designed with context in mind but never wired up:
- `PromptRuntimeContext` interface defined
- `buildPromptRuntimeContext()` implemented
- `toolContext.runtimeContext` passed around
- But no consumer uses it for prompt building

### Root Cause 3: Two Parallel Memory Systems

**Problem**: OpenPoke-style WorkingMemoryLog was added alongside existing ConversationSummarizer:
- Both do similar things
- Neither is fully integrated
- Creates confusion about which to use

---

## 4. Fix Plan

### Priority 1: Inject Context Into Claude Prompt (CRITICAL)

**Files to modify**:
- `ClaudeServiceEnhanced.ts`

**Changes**:
1. Modify `sendMessage()` to accept runtimeContext
2. Create `buildDynamicSystemPrompt(staticPrompt, runtimeContext)` method
3. Append runtime context to static prompt before sending to Claude

**Format**:
```markdown
[Static grace_system_prompt.md content]

---

## CURRENT CONTEXT

### User Profile
- Phone: +1234567890
- Timezone: America/Chicago

### Memory Highlights
- User prefers morning reminders
- User's assistant is named Sarah

### Conversation Summary
[Previous conversation summary here]

### Current DateTime
2025-12-22T21:10:00-06:00
```

---

### Priority 2: Add Message Debounce (MEDIUM)

**Files to modify**:
- `MessageRouter.ts`

**Changes**:
1. Add debounce map: `Map<conversationId, { messages: [], timer: NodeJS.Timeout }>`
2. On message arrival, add to buffer and reset timer
3. On timer expiry (2 seconds), process all buffered messages together
4. Merge message texts before sending to Claude

---

### Priority 3: Unify Summarization Systems (MEDIUM)

**Options**:
A. Keep WorkingMemoryLog, remove ConversationSummarizer
B. Keep ConversationSummarizer, remove WorkingMemoryLog
C. Integrate both (WorkingMemoryLog feeds ConversationSummarizer)

**Recommendation**: Option A - WorkingMemoryLog is more sophisticated

**Changes**:
1. Use WorkingMemoryLog.render() output in context injection
2. Remove or deprecate ConversationSummarizer
3. Ensure WorkingMemoryLog summary is persisted and loaded

---

### Priority 4: Add Prompt Guidance for Context Format (LOW)

**Files to modify**:
- `grace_system_prompt.md`

**Changes**:
Add section explaining context format:
```markdown
## CONTEXT FORMAT

You will receive dynamic context appended to this prompt including:
- User profile information
- Memory highlights from previous conversations
- Conversation summary (if available)
- Current date/time

Use this context naturally without explicitly referencing it.
```

---

## Implementation Order

1. **Fix Priority 1 first** - This is the critical blocker
2. **Fix Priority 4** - Quick prompt update
3. **Fix Priority 2** - Improves UX for rapid messages
4. **Fix Priority 3** - Cleanup/consolidation

---

## Files Affected

| File | Changes Needed |
|------|----------------|
| `ClaudeServiceEnhanced.ts` | Add context injection to system prompt |
| `MessageRouter.ts` | Add debounce logic, wire up WorkingMemoryLog |
| `grace_system_prompt.md` | Add context format guidance |
| `WorkingMemoryLog.ts` | No changes (already correct) |
| `SummarizationService.ts` | May deprecate or integrate |

---

## Detailed Fix Specifications

### FIX 1: Inject runtimeContext into Claude System Prompt

**Problem**: `toolContext.runtimeContext` is built but never used in the system prompt.

**Solution**: Modify `ClaudeServiceEnhanced.sendMessage()` to build a dynamic system prompt.

**File**: `ClaudeServiceEnhanced.ts`

**Change 1.1**: Add method to format runtime context as markdown

```typescript
/**
 * Build dynamic system prompt by appending runtime context to static prompt.
 */
private buildDynamicSystemPrompt(
  staticPrompt: string,
  runtimeContext?: PromptRuntimeContext
): string {
  if (!runtimeContext) {
    return staticPrompt;
  }

  const contextSections: string[] = [];

  // Current datetime
  if (runtimeContext.currentDatetime) {
    contextSections.push(`**Current DateTime**: ${runtimeContext.currentDatetime}`);
  }

  // User profile
  if (runtimeContext.userProfile) {
    const profile = Object.entries(runtimeContext.userProfile)
      .filter(([_, v]) => v)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    if (profile) {
      contextSections.push(`**User Profile**:\n${profile}`);
    }
  }

  // User preferences
  if (runtimeContext.userPreferences?.length) {
    contextSections.push(`**User Preferences**:\n${runtimeContext.userPreferences.map(p => `- ${p}`).join('\n')}`);
  }

  // Memory highlights
  if (runtimeContext.memoryHighlights?.length) {
    contextSections.push(`**Memory Highlights**:\n${runtimeContext.memoryHighlights.map(m => `- ${m}`).join('\n')}`);
  }

  // Conversation summary
  if (runtimeContext.conversationSummary) {
    contextSections.push(`**Conversation Summary**:\n${runtimeContext.conversationSummary}`);
  }

  // Active tasks
  if (runtimeContext.activeTasks?.length) {
    contextSections.push(`**Active Tasks**:\n${runtimeContext.activeTasks.map(t => `- ${t}`).join('\n')}`);
  }

  // Active reminders
  if (runtimeContext.activeReminders?.length) {
    contextSections.push(`**Active Reminders**:\n${runtimeContext.activeReminders.map(r => `- ${r}`).join('\n')}`);
  }

  if (contextSections.length === 0) {
    return staticPrompt;
  }

  return `${staticPrompt}\n\n---\n\n## CURRENT SESSION CONTEXT\n\n${contextSections.join('\n\n')}`;
}
```

**Change 1.2**: Modify `sendMessage()` to use dynamic prompt

```typescript
// Line 124 - BEFORE:
const finalSystemPrompt = systemPrompt || this.buildAgentGracePrompt();

// Line 124 - AFTER:
const basePrompt = systemPrompt || this.buildAgentGracePrompt();
const finalSystemPrompt = this.buildDynamicSystemPrompt(basePrompt, toolContext.runtimeContext);
```

**Change 1.3**: Import PromptRuntimeContext type

Add at top of file or inline the interface.

---

### FIX 2: Add Message Debounce for Rapid Messages

**Problem**: Each message triggers separate Claude call immediately.

**Solution**: Add debounce buffer that collects messages for 2 seconds before processing.

**File**: `MessageRouter.ts`

**Change 2.1**: Add debounce state

```typescript
// Add after line 59 (workingMemoryLogs)
private messageDebounceBuffers = new Map<string, {
  messages: BlueBubblesMessage[];
  timer: NodeJS.Timeout | null;
  conversationId?: string;
}>();
private readonly debounceDelayMs = 2000; // 2 seconds
```

**Change 2.2**: Add debounce handler method

```typescript
/**
 * Debounce incoming messages - collect rapid messages before processing.
 */
private debounceMessage(bbMessage: BlueBubblesMessage): void {
  const chatId = bbMessage.chat_id || bbMessage.handle?.address || 'unknown';
  
  let buffer = this.messageDebounceBuffers.get(chatId);
  if (!buffer) {
    buffer = { messages: [], timer: null };
    this.messageDebounceBuffers.set(chatId, buffer);
  }

  // Add message to buffer
  buffer.messages.push(bbMessage);

  // Clear existing timer
  if (buffer.timer) {
    clearTimeout(buffer.timer);
  }

  // Set new timer
  buffer.timer = setTimeout(async () => {
    const messagesToProcess = buffer!.messages;
    this.messageDebounceBuffers.delete(chatId);
    
    if (messagesToProcess.length > 0) {
      // Process the last message but include all message texts in context
      const lastMessage = messagesToProcess[messagesToProcess.length - 1];
      
      // Combine all message texts for context
      if (messagesToProcess.length > 1) {
        const combinedText = messagesToProcess
          .map(m => m.text || '')
          .filter(t => t.length > 0)
          .join('\n\n');
        lastMessage.text = combinedText;
        lastMessage.metadata = {
          ...lastMessage.metadata,
          combinedMessageCount: messagesToProcess.length
        };
      }
      
      await this.handleIncomingMessage(lastMessage);
    }
  }, this.debounceDelayMs);
}
```

**Change 2.3**: Modify message listener to use debounce

```typescript
// Line 380-382 - BEFORE:
this.blueBubblesClient.on('message', async (message: BlueBubblesMessage) => {
  await this.handleIncomingMessage(message);
});

// Line 380-382 - AFTER:
this.blueBubblesClient.on('message', async (message: BlueBubblesMessage) => {
  this.debounceMessage(message);
});
```

---

### FIX 3: Add Prompt Guidance for Context Format

**File**: `grace_system_prompt.md`

**Change**: Add section after "CONTEXT AWARENESS" (around line 120)

```markdown
### Understanding Your Context

At the end of this prompt, you may receive a "CURRENT SESSION CONTEXT" section containing:
- **Current DateTime** - Use for interpreting relative times
- **User Profile** - Phone, email, timezone
- **User Preferences** - Communication style preferences
- **Memory Highlights** - Important facts from previous conversations
- **Conversation Summary** - Summary of earlier parts of this conversation
- **Active Tasks/Reminders** - Current pending items

Use this context naturally. Don't say "I see from your profile..." - just use the information.
```

---

### FIX 4: Wire Up WorkingMemoryLog Summary to runtimeContext

**Problem**: WorkingMemoryLog has summaries but they're not used in runtimeContext.

**File**: `MessageRouter.ts`

**Change 4.1**: Modify `buildPromptRuntimeContext()` to include WorkingMemoryLog summary

```typescript
// In buildPromptRuntimeContext(), around line 104-106, REPLACE:
const summary = typeof conversation.metadata?.summary === 'string'
  ? conversation.metadata.summary
  : undefined;

// WITH:
let summary = typeof conversation.metadata?.summary === 'string'
  ? conversation.metadata.summary
  : undefined;

// Also check WorkingMemoryLog for summary
try {
  const workingMemoryLog = await this.getWorkingMemoryLog(user.id, conversation.id);
  const wmSummary = workingMemoryLog.getSummary();
  if (wmSummary && (!summary || wmSummary.length > summary.length)) {
    summary = wmSummary;
  }
} catch (e) {
  // Ignore errors - summary is optional
}
```

---

## Summary of All Changes

| Fix | File | Lines | Change |
|-----|------|-------|--------|
| 1.1 | `ClaudeServiceEnhanced.ts` | New method | Add `buildDynamicSystemPrompt()` |
| 1.2 | `ClaudeServiceEnhanced.ts` | ~124 | Use dynamic prompt in `sendMessage()` |
| 1.3 | `ClaudeServiceEnhanced.ts` | Top | Import/define `PromptRuntimeContext` |
| 2.1 | `MessageRouter.ts` | ~60 | Add debounce state variables |
| 2.2 | `MessageRouter.ts` | New method | Add `debounceMessage()` |
| 2.3 | `MessageRouter.ts` | ~380 | Use debounce in message listener |
| 3 | `grace_system_prompt.md` | ~120 | Add context format guidance |
| 4.1 | `MessageRouter.ts` | ~104 | Include WorkingMemoryLog summary |

---

## Testing Plan

1. **Context Injection Test**:
   - Send message, check logs for "System prompt preview" 
   - Verify it includes "CURRENT SESSION CONTEXT"

2. **Debounce Test**:
   - Send 3 messages rapidly
   - Verify only 1 Claude call made
   - Verify response addresses all 3 messages

3. **Memory Test**:
   - Have conversation, trigger summarization (20+ messages)
   - Start new session
   - Verify agent remembers previous context

