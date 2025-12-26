# Implementation Plan v5 - Production Issue Fixes

**Created**: December 26, 2025  
**Status**: READY FOR IMPLEMENTATION

---

## Executive Summary

Four issues identified in production. This plan addresses them in priority order.

| Phase | Focus | Priority | Estimated Effort |
|-------|-------|----------|------------------|
| 1 | Prompt fixes for `wait` tool misuse | 🔴 HIGH | 15 min |
| 2 | Code fixes for typing indicator bug | 🔴 HIGH | 30 min |
| 3 | Memory system enhancement | 🟡 MEDIUM | 1-2 hours |
| 4 | Data cleanup | 🟢 LOW | 10 min |

---

## Phase 1: Prompt Fixes (🔴 HIGH PRIORITY)

### Problem
Agent uses `wait` tool on direct questions, leaving user without response.

### File: `src/agents/prompts/interaction_system_prompt.md`

### Changes Required

#### 1.1 Update `wait` tool section (lines 39-46)

**Current:**
```markdown
### wait
Use this when you should NOT send a response.

**When to use:**
- The message you would send is already in conversation history
- You're processing an agent result that doesn't need user notification
- Avoiding duplicate acknowledgments
- After `react_to_message` when no text response is needed
```

**New:**
```markdown
### wait
Use this when you should NOT send a response.

**When to use:**
- The message you would send is already in conversation history
- You're processing an agent result that doesn't need user notification
- Avoiding duplicate acknowledgments
- After `react_to_message` when no text response is needed
- User sends a tapback reaction (e.g., "Liked [message]", "Loved [message]")

**CRITICAL - NEVER use `wait` for:**
- ❌ Direct questions (who, what, when, where, why, how, do you, can you, etc.)
- ❌ Requests for information
- ❌ Any message ending with "?"
- ❌ When unsure - **always respond rather than wait**

**Rule of thumb:** If the user is asking something or expecting information, ALWAYS respond.
```

#### 1.2 Add new section after `wait` tool (after line 46)

**Add:**
```markdown
### WHEN TO RESPOND vs WAIT (Decision Guide)

| User Message Type | Action | Example |
|-------------------|--------|---------|
| Question (ends with ?) | **RESPOND** | "What's your email?" → answer |
| Request for info | **RESPOND** | "Tell me about X" → answer |
| "Do you know..." | **RESPOND** | Always answer yes/no + info |
| "Can you..." | **RESPOND** | Always answer yes/no |
| Simple acknowledgment | `react` + `wait` | "ok", "got it", "k" |
| Gratitude | `react` + `wait` | "thanks", "ty" |
| Tapback reaction | `wait` only | "Liked [message]" |
| Goodbye | `react` + `wait` | "bye", "ttyl" |

**When unsure:** Always respond. A short response is better than silence.
```

---

## Phase 2: Code Fixes (🔴 HIGH PRIORITY)

### Problem
Typing indicator not stopped on early return paths.

### File: `src/services/MessageRouter.ts`

### Changes Required

#### 2.1 Fix early return at line 773 (isRecentAssistantEcho)

**Current:**
```typescript
if (this.isRecentAssistantEcho(conversation.id, bbMessage, processedMessage.text)) {
  logDebug('Skipping assistant echo detected via outbound cache', {
    guid: bbMessage.guid,
    conversationId: conversation.id
  });
  return;
}
```

**New:**
```typescript
if (this.isRecentAssistantEcho(conversation.id, bbMessage, processedMessage.text)) {
  logDebug('Skipping assistant echo detected via outbound cache', {
    guid: bbMessage.guid,
    conversationId: conversation.id
  });
  // Stop typing indicator before early return
  if (typingStarted && typingGuid) {
    await this.blueBubblesClient.stopTypingIndicator(typingGuid);
  }
  return;
}
```

#### 2.2 Fix early return at line 840 (isResponseRateLimited - dual-agent)

**Current:**
```typescript
if (this.isResponseRateLimited(conversation.id)) {
  logWarn('Skipping dual-agent response due to rate limit - possible loop detected', {
    conversationId: conversation.id
  });
  return;
}
```

**New:**
```typescript
if (this.isResponseRateLimited(conversation.id)) {
  logWarn('Skipping dual-agent response due to rate limit - possible loop detected', {
    conversationId: conversation.id
  });
  // Stop typing indicator before early return
  if (typingStarted && typingGuid) {
    await this.blueBubblesClient.stopTypingIndicator(typingGuid);
  }
  return;
}
```

#### 2.3 Fix early return at line 922 (isResponseRateLimited - legacy)

**Current:**
```typescript
if (sendEnabled && this.isResponseRateLimited(conversation.id)) {
  logWarn('Skipping response due to rate limit - possible loop detected', {
    conversationId: conversation.id
  });
  return;
}
```

**New:**
```typescript
if (sendEnabled && this.isResponseRateLimited(conversation.id)) {
  logWarn('Skipping response due to rate limit - possible loop detected', {
    conversationId: conversation.id
  });
  // Stop typing indicator before early return
  if (typingStarted && typingGuid) {
    await this.blueBubblesClient.stopTypingIndicator(typingGuid);
  }
  return;
}
```

#### 2.4 Add logging for `wait` tool usage

**File:** `src/agents/InteractionAgentRuntime.ts` (around line 250)

**Current:**
```typescript
case 'wait':
  waitReasons.push(data.reason);
  toolResults.push({
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: `Waiting: ${data.reason}`
  });
  break;
```

**New:**
```typescript
case 'wait':
  waitReasons.push(data.reason);
  logInfo('Agent used wait tool', {
    reason: data.reason,
    conversationId: this.conversationId,
    lastUserMessage: this.lastUserMessageText?.substring(0, 50)
  });
  toolResults.push({
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: `Waiting: ${data.reason}`
  });
  break;
```

---

## Phase 3: Memory System Enhancement (🟡 MEDIUM PRIORITY)

### Problem
`context_memory` table is empty despite 11,392 messages. Memory only saves during summarization.

### Changes Required

#### 3.1 Add proactive memory extraction (Future Enhancement)

**File:** `src/services/MessageRouter.ts`

**Location:** After successful response handling (around line 960)

**Add:**
```typescript
// Extract and save important facts from conversation
void this.extractAndSaveMemories(user.id, conversation.id, messageText, assistantResponse);
```

**New method:**
```typescript
private async extractAndSaveMemories(
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  // Only process messages that might contain memorable info
  const memoryTriggers = [
    /my (name|email|phone|birthday|address)/i,
    /i (prefer|like|hate|love|always|never)/i,
    /remind me that/i,
    /remember that/i,
    /i am|i'm a/i
  ];
  
  const shouldExtract = memoryTriggers.some(pattern => pattern.test(userMessage));
  if (!shouldExtract) return;
  
  try {
    // Use Claude to extract facts (lightweight call)
    const extraction = await this.claudeService.extractFacts(userMessage);
    if (extraction.success && extraction.data?.facts?.length > 0) {
      for (const fact of extraction.data.facts) {
        await this.contextService.saveMemory(
          userId,
          fact.key,
          fact.value,
          'long_term',
          conversationId
        );
      }
    }
  } catch (error) {
    logWarn('Failed to extract memories', { error });
  }
}
```

**Note:** This is a larger change that requires adding `extractFacts` to ClaudeService. Consider as Phase 3.

---

## Phase 4: Data Cleanup (🟢 LOW PRIORITY)

### Problem
15 stale pending reminders from October 2025.

### SQL to run:
```sql
-- View stale reminders
SELECT id, content, remind_at, status 
FROM reminders 
WHERE status = 'pending' 
AND remind_at < NOW() - INTERVAL '7 days';

-- Cancel stale reminders
UPDATE reminders 
SET status = 'cancelled', 
    metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{cancelled_reason}', '"auto-expired"')
WHERE status = 'pending' 
AND remind_at < NOW() - INTERVAL '7 days';
```

### Future: Add auto-expiration logic

**File:** `src/services/ReminderService.ts`

**Add to `checkAndSendReminders()` method:**
```typescript
// Auto-expire reminders that are more than 24 hours past due
const expiredReminders = await this.reminderRepo.find({
  where: {
    status: 'pending',
    remindAt: LessThan(new Date(Date.now() - 24 * 60 * 60 * 1000))
  }
});

for (const reminder of expiredReminders) {
  reminder.status = 'cancelled';
  reminder.metadata = { ...reminder.metadata, cancelled_reason: 'auto-expired' };
  await this.reminderRepo.save(reminder);
  logInfo('Auto-expired stale reminder', { id: reminder.id });
}
```

---

## Implementation Order

1. **Phase 1** - Prompt fixes (can be done immediately, low risk)
2. **Phase 2** - Typing indicator fixes (high impact, moderate risk)
3. **Phase 4** - Data cleanup (one-time SQL, no code changes)
4. **Phase 3** - Memory system (larger change, can be deferred)

---

## Testing Checklist

After implementation:

- [ ] Send "What's your email?" → Agent responds with email
- [ ] Send "Do you know X?" → Agent responds yes/no
- [ ] Send "ok" → Agent reacts + waits (no text)
- [ ] Trigger rate limit → Typing indicator stops
- [ ] Trigger echo detection → Typing indicator stops
- [ ] Check server logs for `wait` tool usage logging

---

## Rollback Plan

If issues persist:
1. Revert prompt changes
2. Revert code changes
3. Consider disabling `wait` tool temporarily
