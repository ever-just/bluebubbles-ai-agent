# Implementation Plan v6 - Agent UX Improvements

**Created**: December 26, 2025 12:15 PM CST  
**Status**: Planning Phase

---

## Executive Summary

This plan addresses multiple UX issues discovered during agent testing:

1. **Typing indicator stays on** after tapback-only responses
2. **No action acknowledgments** - user waits with no feedback during tool execution
3. **Delayed "searching" message** - sent after search completes, not before
4. **Robotic acknowledgments** - "🔍 searching..." is not natural
5. **Poor search result formatting** - raw Claude output sent to user

### Relationship to Existing Uncommitted Changes

The current uncommitted changes have already fixed:
- ✅ Echo detection (socket `is_from_me` check)
- ✅ GUID deduplication in debounce buffer
- ✅ Strip `||` from saved messages
- ✅ Record each bubble for echo detection
- ✅ Typing indicator stops on early returns
- ✅ Wait tool logging
- ✅ Text-only response fallback
- ✅ Prompt updates for wait tool restrictions

This plan builds ON TOP of those changes, not replacing them.

---

## Issue Analysis

### Issue 1: Typing Indicator After Tapback-Only Response

**Symptom**: When agent sends only a tapback (no text), typing indicator stays on indefinitely.

**Root Cause Analysis**:
- Typing starts at `MessageRouter.ts:772-778`
- Agent uses `react_to_message` tool
- Reaction sent via `iMessageAdapter.sendReaction()`
- `messagesSent` remains empty (reactions not counted)
- Typing stop at line 912-917 SHOULD be reached
- **Hypothesis**: Race condition or BlueBubbles API issue

**Investigation Needed**:
- Add debug logging to confirm `stopTypingIndicator` is called
- Check if `activeTypingIndicators` Set is properly managed
- Verify BlueBubbles DELETE request is sent

### Issue 2: No Action Acknowledgments

**Symptom**: User sends "remind me tomorrow" and sees nothing until reminder is created.

**Root Cause**:
- `send_message_to_agent` spawns ExecutionAgent asynchronously
- InteractionAgentRuntime returns immediately
- No acknowledgment sent to user
- User waits 2-5 seconds with no feedback

**Solution**: Send acknowledgment BEFORE spawning agent or executing tool.

### Issue 3: Delayed "searching" Message

**Symptom**: "🔍 searching..." appears at same time as search results.

**Root Cause**:
- `web_search` is a **server tool** executed by Anthropic
- Detection happens AFTER Claude API call returns
- Search has already completed by then

**Solution**: Pre-emptive detection based on user message patterns.

### Issue 4: Robotic Acknowledgments

**Symptom**: "🔍 searching..." feels robotic.

**Solution**: Array of natural language alternatives with random selection.

### Issue 5: Poor Search Result Formatting

**Symptom**: Raw Claude output with citation markup sent to user.

**Current State**: `stripCitations()` removes markup but no further formatting.

**Solution**: Post-processing function for better iMessage formatting.

---

## Architecture: Agent Communication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ User Message → MessageRouter → InteractionAgentRuntime                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
            ┌───────▼───────┐               ┌──────▼──────┐
            │ Direct Tools  │               │ Delegation  │
            │ - web_search  │               │ - send_to_  │
            │ - react       │               │   agent     │
            │ - send_to_    │               └──────┬──────┘
            │   user        │                      │
            └───────┬───────┘                      ▼
                    │               ┌──────────────────────────┐
                    │               │ ExecutionBatchManager    │
                    │               │ → ExecutionAgentRuntime  │
                    │               │ → Tools (reminders, etc) │
                    │               └──────────────┬───────────┘
                    │                              │
                    │                              ▼
                    │               ┌──────────────────────────┐
                    │               │ Results → Interaction    │
                    │               │ Agent → send_to_user     │
                    │               └──────────────────────────┘
                    │                              │
                    └──────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────┐
                    │ User Sees Response       │
                    └──────────────────────────┘
```

**Key Insight**: There are TWO places where acknowledgments should be sent:
1. **Before web_search** (server tool) - pre-emptive detection
2. **Before send_to_agent** (delegation) - on tool detection

---

## Implementation Plan

### Phase 1: Action Acknowledgment System (HIGH PRIORITY)

#### Task 1.1: Create Action Acknowledgments Utility
**File**: `src/utils/actionAcknowledgments.ts` (NEW)

```typescript
export type ActionType = 
  | 'web_search'
  | 'send_email'
  | 'create_reminder'
  | 'list_reminders'
  | 'create_trigger'
  | 'spawn_agent'
  | 'generic_tool';

const ACTION_ACKNOWLEDGMENTS: Record<ActionType, string[]> = {
  web_search: [
    "let me look that up",
    "searching for that now",
    "one sec, checking on that",
    "looking into it",
    "let me find out",
  ],
  send_email: [
    "sending that email now",
    "on it, drafting the email",
    "let me send that for you",
  ],
  create_reminder: [
    "setting that reminder",
    "got it, creating the reminder",
    "I'll remind you",
  ],
  list_reminders: [
    "let me check your reminders",
    "pulling up your reminders",
  ],
  create_trigger: [
    "setting that up for you",
    "creating that automation",
  ],
  spawn_agent: [
    "working on that",
    "let me handle that",
    "on it",
    "give me a moment",
  ],
  generic_tool: [
    "working on it",
    "one moment",
    "on it",
  ],
};

export function getActionAcknowledgment(actionType: ActionType): string {
  const options = ACTION_ACKNOWLEDGMENTS[actionType] || ACTION_ACKNOWLEDGMENTS.generic_tool;
  return options[Math.floor(Math.random() * options.length)];
}

export function detectActionType(toolName: string): ActionType {
  const toolToAction: Record<string, ActionType> = {
    'web_search': 'web_search',
    'send_email': 'send_email',
    'reply_email': 'send_email',
    'create_reminder': 'create_reminder',
    'list_reminders': 'list_reminders',
    'cancel_reminder': 'list_reminders',
    'create_trigger': 'create_trigger',
    'send_message_to_agent': 'spawn_agent',
  };
  return toolToAction[toolName] || 'generic_tool';
}

export function looksLikeSearchQuery(text: string): boolean {
  const searchPatterns = [
    /\b(what|who|when|where|how|why)\b.*\?/i,
    /\b(search|find|look up|google|check)\b/i,
    /\b(weather|news|price|stock|score|result)\b/i,
    /\b(happening|events|today|tonight|tomorrow)\b/i,
  ];
  return searchPatterns.some(p => p.test(text));
}
```

#### Task 1.2: Integrate Pre-emptive Search Acknowledgment
**File**: `src/agents/InteractionAgentRuntime.ts`

**Changes**:
1. Add `hasAcknowledged` flag to prevent duplicate acknowledgments
2. Before Claude API call, check if message looks like search query
3. If yes, send acknowledgment immediately
4. Remove hardcoded "🔍 searching..." message

```typescript
// In runInteractionLoop(), before Claude API call:

// PRE-EMPTIVE: For web search (server tool), detect early
if (messageType === 'user' && looksLikeSearchQuery(content) && !hasAcknowledged) {
  const ack = getActionAcknowledgment('web_search');
  await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
  messagesSent.push(ack);
  hasAcknowledged = true;
}
```

#### Task 1.3: Integrate Tool-Based Acknowledgment
**File**: `src/agents/InteractionAgentRuntime.ts`

**Changes**:
1. When processing `send_to_agent` tool, send acknowledgment BEFORE spawning
2. For other tools, send acknowledgment on first tool detection

```typescript
// In tool processing loop:

case 'send_to_agent':
  // Send acknowledgment BEFORE spawning agent
  if (!hasAcknowledged) {
    const ack = getActionAcknowledgment('spawn_agent');
    await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
    messagesSent.push(ack);
    hasAcknowledged = true;
  }
  // Then spawn agent...
```

### Phase 2: Typing Indicator Debug (MEDIUM PRIORITY)

#### Task 2.1: Add Debug Logging for Typing Indicator
**File**: `src/services/MessageRouter.ts`

**Changes**:
1. Log when typing indicator is started with timestamp
2. Log when typing indicator is stopped with timestamp
3. Log if `stopTypingIndicator` returns early due to missing GUID

#### Task 2.2: Verify BlueBubbles DELETE Request
**File**: `src/integrations/BlueBubblesClient.ts`

**Changes**:
1. Log successful DELETE request
2. Log if `activeTypingIndicators` doesn't contain the GUID

### Phase 3: Search Result Formatting (LOW PRIORITY)

#### Task 3.1: Create Formatting Utility
**File**: `src/utils/messageFormatting.ts` (NEW)

```typescript
export function formatSearchResults(text: string): string {
  let formatted = text;
  
  // Remove excessive newlines
  formatted = formatted.replace(/\n{3,}/g, '\n\n');
  
  // Ensure bullet points are consistent
  formatted = formatted.replace(/^[•●○]\s*/gm, '• ');
  
  // Truncate if too long for iMessage
  if (formatted.length > 1000) {
    formatted = formatted.substring(0, 997) + '...';
  }
  
  return formatted;
}
```

#### Task 3.2: Apply Formatting to Search Results
**File**: `src/agents/InteractionAgentRuntime.ts`

**Changes**:
1. After `stripCitations()`, apply `formatSearchResults()`

---

## Prompt Updates Required

### Update: interaction_system_prompt.md

Add section about action acknowledgments:

```markdown
### Action Acknowledgments

When you're about to perform an action that takes time (search, send email, create reminder, etc.), 
the system will automatically send a brief acknowledgment to the user. You don't need to send 
your own "let me check" or "searching" messages - the system handles this.

Focus on:
1. Understanding the user's request
2. Choosing the right tool/agent
3. Sending the final result

The acknowledgment system handles the "in progress" communication.
```

---

## Testing Checklist

### Phase 1 Tests
- [ ] User asks "What's the weather?" → immediate acknowledgment before search
- [ ] User says "Remind me tomorrow" → immediate acknowledgment before agent spawn
- [ ] User says "Send an email to John" → immediate acknowledgment before email
- [ ] Acknowledgments are varied (not always the same message)
- [ ] Only ONE acknowledgment per request (no duplicates)

### Phase 2 Tests
- [ ] User sends "ok" → agent reacts with tapback, typing indicator stops
- [ ] User sends "thanks" → agent reacts with tapback, typing indicator stops
- [ ] Logs show `stopTypingIndicator` being called

### Phase 3 Tests
- [ ] Search results are properly formatted
- [ ] Long results are truncated
- [ ] No citation markup visible to user

---

## Files to Modify Summary

| File | Action | Description |
|------|--------|-------------|
| `src/utils/actionAcknowledgments.ts` | CREATE | Acknowledgment strings and detection |
| `src/utils/messageFormatting.ts` | CREATE | Search result formatting |
| `src/agents/InteractionAgentRuntime.ts` | MODIFY | Integrate acknowledgment system |
| `src/services/MessageRouter.ts` | MODIFY | Add typing indicator debug logging |
| `src/integrations/BlueBubblesClient.ts` | MODIFY | Add typing indicator debug logging |
| `src/agents/prompts/interaction_system_prompt.md` | MODIFY | Document acknowledgment behavior |
| `PROMPT_CODE_HARMONY_AUDIT.md` | MODIFY | Add Section 14 with new findings |

---

## Rollback Plan

If issues arise:
1. Remove `actionAcknowledgments.ts` import
2. Restore hardcoded "🔍 searching..." message
3. Remove `hasAcknowledged` flag logic

---

## Next Steps

1. [ ] Implement Task 1.1: Create actionAcknowledgments.ts
2. [ ] Implement Task 1.2: Pre-emptive search acknowledgment
3. [ ] Implement Task 1.3: Tool-based acknowledgment
4. [ ] Test Phase 1
5. [ ] Implement Phase 2 (typing indicator debug)
6. [ ] Implement Phase 3 (formatting)
7. [ ] Update PROMPT_CODE_HARMONY_AUDIT.md
