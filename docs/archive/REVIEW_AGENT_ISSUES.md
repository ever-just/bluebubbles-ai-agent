# Agent Issues Review Plan

**Created**: December 26, 2025 11:58 AM CST  
**Status**: Investigation in Progress

---

## Issue Summary

| # | Issue | Severity | Root Cause Status |
|---|-------|----------|-------------------|
| 1 | Which agent handles reactions/tapbacks? | Info | ✅ IDENTIFIED |
| 2 | Typing indicator stays on after tapback (no follow-up response) | 🔴 HIGH | 🔍 INVESTIGATING |
| 3a | "searching" message sent delayed (same time as results) | 🟡 MEDIUM | 🔍 INVESTIGATING |
| 3b | "searching" message too robotic, should be natural | 🟢 LOW | 📝 DESIGN NEEDED |
| 4 | Search result formatting poor, unclear which agent sends | 🟡 MEDIUM | 🔍 INVESTIGATING |
| 5 | Primary/Secondary agent dynamic unclear | Info | 📝 DOCUMENTATION |

---

## 1. Which Agent Handles Reactions/Tapbacks?

### Answer: **InteractionAgent** (Primary Agent)

**Flow:**
```
User Message → MessageRouter → InteractionAgentRuntime → InteractionAgent.executeTool('react_to_message')
                                      ↓
                              iMessageAdapter.sendReaction()
                                      ↓
                              BlueBubblesClient.sendReaction()
```

**Key Files:**
- `src/agents/InteractionAgent.ts:67-81` - Tool definition for `react_to_message`
- `src/agents/InteractionAgentRuntime.ts:282-318` - Executes the reaction
- `src/agents/iMessageAdapter.ts:144-160` - Sends via BlueBubbles
- `src/integrations/BlueBubblesClient.ts:272-311` - REST API call

**Tool Definition:**
```typescript
{
  name: 'react_to_message',
  description: 'Send a tapback reaction (❤️👍👎😂‼️❓) to the user\'s last message. Use liberally for acknowledgments. Prefer this over sending emoji as text.',
  input_schema: {
    type: 'object',
    properties: {
      reaction: {
        type: 'string',
        enum: ['love', 'like', 'dislike', 'laugh', 'emphasize', 'question'],
        description: 'The reaction type: love=❤️, like=👍, dislike=👎, laugh=😂, emphasize=‼️, question=❓'
      }
    },
    required: ['reaction']
  }
}
```

---

## 2. Typing Indicator Stays On After Tapback

### Hypothesis

When the agent decides to ONLY send a tapback (no text response), the typing indicator is started but never stopped because:

1. Typing indicator starts in `MessageRouter.handleIncomingMessage()` at line ~767
2. Agent processes message and decides to use `react_to_message` tool ONLY
3. `InteractionAgentRuntime` executes the reaction
4. Runtime returns with `messagesSent: []` (empty - no text messages sent)
5. **BUG**: Typing indicator stop logic may be tied to `messagesSent.length > 0`

### Code to Investigate

**MessageRouter.ts** - Typing indicator stop logic:
```typescript
// Line ~903-911
if (typingStarted && typingGuid) {
  await this.blueBubblesClient.stopTypingIndicator(typingGuid);
  logDebug('Typing indicator stopped', { typingGuid });
  typingStarted = false;
  typingGuid = null;
}
```

**Question**: Is this code path reached when `result.messagesSent.length === 0`?

### Proposed Fix

Ensure typing indicator is ALWAYS stopped after `InteractionAgentRuntime.processUserMessage()` returns, regardless of whether messages were sent.

---

## 3a. "searching" Message Sent Delayed

### Current Behavior

The "🔍 searching..." message is sent at the same time as the search results, not immediately when the search starts.

### Root Cause Analysis

Looking at `InteractionAgentRuntime.ts:178-184`:

```typescript
// If web_search server tool is being used, notify user immediately
const hasWebSearch = serverToolBlocks.some((block: any) => block.name === 'web_search');
if (hasWebSearch) {
  logInfo('Web search server tool detected - notifying user');
  await this.iMessageAdapter.sendToUser('🔍 searching...', this.chatGuid, true);
  messagesSent.push('🔍 searching...');
}
```

**Problem**: This code runs AFTER the Claude API call returns, which means:
1. Claude receives the request
2. Claude decides to use `web_search` server tool
3. Anthropic executes the search (takes time)
4. Claude returns the response with `server_tool_use` blocks
5. THEN we detect `hasWebSearch` and send "searching..."
6. THEN we send the actual results

The search has ALREADY COMPLETED by the time we detect it!

### Proposed Fix

**Option A**: Pre-emptive detection
- Before calling Claude, analyze the user message
- If it looks like a search query, send "searching..." immediately
- Risk: False positives

**Option B**: Streaming response
- Use streaming API to detect `server_tool_use` as soon as Claude decides to search
- Send "searching..." immediately when detected
- More complex but accurate

**Option C**: Two-phase approach
- First Claude call: Decide if search is needed
- If yes, send "searching..." and make second call with search enabled
- More API calls but predictable

---

## 3b. "searching" Message Too Robotic

### Current Message
```
🔍 searching...
```

### Proposed Natural Alternatives

The agent should randomly select from a variety of natural responses:

```typescript
const SEARCH_ACKNOWLEDGMENTS = [
  "let me look that up for you",
  "searching for that now...",
  "one sec, checking on that",
  "looking into it...",
  "let me find out",
  "checking...",
  "on it, give me a moment",
  "let me search for that",
];
```

### Implementation Location
`src/agents/InteractionAgentRuntime.ts:182`

---

## 4. Search Result Formatting

### Current Behavior

Search results are sent with citation markup that gets stripped, but the formatting may still be poor.

### Which Agent Sends Search Results?

**Answer**: The **InteractionAgent** (Primary Agent) sends search results.

**Flow:**
1. Claude uses `web_search` server tool (executed by Anthropic)
2. Results come back in `response.content` as text blocks
3. `InteractionAgentRuntime` detects no more client tools needed
4. Text content is extracted and sent via `iMessageAdapter.sendToUser()`

**Code Path** (`InteractionAgentRuntime.ts:186-204`):
```typescript
if (toolUseBlocks.length === 0) {
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );
  
  if (textBlocks.length > 0) {
    const textContent = textBlocks.map(b => b.text).join('\n').trim();
    if (textContent) {
      const cleanMessage = stripCitations(textContent);
      await this.iMessageAdapter.sendToUser(cleanMessage, this.chatGuid, true);
      messagesSent.push(cleanMessage);
    }
  }
}
```

### Formatting Issues

1. **Citation stripping** may leave awkward formatting
2. **No post-processing** to make results more conversational
3. **Raw Claude output** sent directly to user

### Proposed Fix

Add a formatting step before sending search results:
- Detect if response contains search results
- Apply formatting rules (bullet points, headers, etc.)
- Make response more conversational

---

## 5. Primary/Secondary Agent Dynamic

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        MessageRouter                             │
│  - Receives incoming messages                                    │
│  - Manages typing indicators                                     │
│  - Saves messages to database                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  InteractionAgentRuntime                         │
│  (PRIMARY AGENT - User-Facing)                                   │
│                                                                  │
│  Tools:                                                          │
│  - send_message_to_user    → Send text to user                  │
│  - send_message_to_agent   → Spawn execution agent              │
│  - wait                    → Do nothing                          │
│  - react_to_message        → Send tapback reaction              │
│  - web_search (server)     → Anthropic-executed search          │
│                                                                  │
│  Responsibilities:                                               │
│  - Decide how to respond to user                                │
│  - Send messages/reactions directly                             │
│  - Delegate complex tasks to execution agents                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ send_message_to_agent
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ExecutionBatchManager                           │
│  - Manages spawned execution agents                             │
│  - Batches results                                               │
│  - Calls back to InteractionAgentRuntime                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ExecutionAgentRuntime                           │
│  (SECONDARY AGENT - Task Execution)                              │
│                                                                  │
│  Tools (from ToolRegistry):                                      │
│  - create_reminder         → Create reminders                   │
│  - list_reminders          → List reminders                     │
│  - cancel_reminder         → Cancel reminders                   │
│  - create_trigger          → Create triggers                    │
│  - send_email              → Send emails                        │
│  - list_emails             → List emails                        │
│  - etc.                                                          │
│                                                                  │
│  Responsibilities:                                               │
│  - Execute specific tasks                                       │
│  - Return results to InteractionAgent                           │
│  - Does NOT send messages directly to user                      │
└─────────────────────────────────────────────────────────────────┘
```

### Key Differences

| Aspect | InteractionAgent (Primary) | ExecutionAgent (Secondary) |
|--------|---------------------------|---------------------------|
| **Purpose** | User communication | Task execution |
| **Sends messages?** | YES | NO (returns results) |
| **Sends reactions?** | YES | NO |
| **Has web_search?** | YES (server tool) | NO |
| **Has reminder tools?** | NO | YES |
| **Has email tools?** | NO | YES |
| **Spawned by** | MessageRouter | InteractionAgent |
| **Returns to** | MessageRouter | InteractionAgent |

### Message Flow Example: "Remind me to call mom tomorrow"

```
1. User: "Remind me to call mom tomorrow"
2. MessageRouter → InteractionAgentRuntime
3. InteractionAgent decides: send_message_to_agent("Reminder Agent", "Create reminder...")
4. ExecutionBatchManager spawns ExecutionAgentRuntime
5. ExecutionAgent uses create_reminder tool
6. ExecutionAgent returns: "Reminder created for tomorrow at 9am"
7. InteractionAgent receives result via handleAgentMessage()
8. InteractionAgent decides: send_message_to_user("Done! I'll remind you...")
9. User sees: "Done! I'll remind you to call mom tomorrow at 9am"
```

### Message Flow Example: "What's the weather in Minneapolis?"

```
1. User: "What's the weather in Minneapolis?"
2. MessageRouter → InteractionAgentRuntime
3. InteractionAgent decides: use web_search server tool
4. Anthropic executes search (we detect this AFTER it completes)
5. InteractionAgent receives search results in response
6. InteractionAgent sends results directly to user (no ExecutionAgent involved)
7. User sees: weather information
```

---

## Action Items

### Immediate Fixes (High Priority)

1. **Fix typing indicator after tapback-only responses**
   - Ensure typing indicator stops even when `messagesSent.length === 0`
   - File: `MessageRouter.ts`

2. **Fix delayed "searching" message**
   - Investigate streaming API or pre-emptive detection
   - File: `InteractionAgentRuntime.ts`

### Medium Priority

3. **Improve search result formatting**
   - Add post-processing for search results
   - File: `InteractionAgentRuntime.ts`

4. **Make "searching" message natural**
   - Add variety of acknowledgment messages
   - File: `InteractionAgentRuntime.ts`

### Documentation

5. **Document agent architecture**
   - Add to `PROMPT_CODE_HARMONY_AUDIT.md`
   - Create architecture diagram

---

## Next Steps

1. [ ] Reproduce typing indicator issue with tapback-only response
2. [ ] Trace code path to confirm hypothesis
3. [ ] Implement fix for typing indicator
4. [ ] Test streaming API for early search detection
5. [ ] Design natural search acknowledgments
6. [ ] Review search result formatting options

---

## Detailed Code Analysis

### Issue 2: Typing Indicator After Tapback - Deep Dive

**Code Path Analysis:**

1. `MessageRouter.handleIncomingMessage()` starts typing at line 772-778
2. `InteractionAgentRuntime.processUserMessage()` is called at line 887
3. Agent uses `react_to_message` tool (lines 282-318 in InteractionAgentRuntime.ts)
4. Reaction is sent but NOT added to `messagesSent`
5. Loop continues, Claude returns with no more tools
6. Returns with `messagesSent: []`
7. Back in MessageRouter, line 912-917 should stop typing

**Potential Issue Found:**

The typing indicator stop at line 912-917 is INSIDE the `if (config.dualAgent.enabled)` block. If there's an exception or early return, the `finally` block at line 1024-1035 should catch it.

However, looking at the `finally` block condition:
```typescript
if (typingStarted && typingGuid && config.messaging.typingIndicators) {
```

This should work. The issue might be:
1. **Race condition**: Multiple messages processed simultaneously
2. **BlueBubbles API issue**: DELETE request not working
3. **Cooldown interference**: The cooldown at line 221 might be causing issues

**Recommended Debug Steps:**
1. Add logging to confirm `stopTypingIndicator` is being called
2. Check BlueBubbles server logs for DELETE requests
3. Verify `activeTypingIndicators` Set is being managed correctly

### Issue 3a: Delayed "searching" Message - Root Cause Confirmed

**Problem**: The `web_search` is a **server tool** executed by Anthropic, not a client tool. This means:

1. We call `anthropic.messages.create()` with `web_search` tool enabled
2. Anthropic decides to use `web_search`
3. Anthropic executes the search (takes 2-5 seconds)
4. Anthropic returns the response with `server_tool_use` blocks
5. ONLY THEN do we detect `hasWebSearch` and send "searching..."

**The search has already completed by the time we detect it!**

**Solution Options:**

**Option A: Pre-emptive Detection (Recommended)**
```typescript
// Before calling Claude, check if message looks like a search query
const looksLikeSearch = /\b(what|who|when|where|how|search|find|look up|weather|news|price|stock)\b/i.test(userMessage);
if (looksLikeSearch) {
  await this.iMessageAdapter.sendToUser(getRandomSearchAck(), this.chatGuid, true);
  messagesSent.push('[search acknowledgment]');
}
```

**Option B: Streaming API**
Use streaming to detect `server_tool_use` as soon as Claude decides to search.

**Option C: Two-Phase Approach**
1. First call: Ask Claude if search is needed (no search tool)
2. If yes, send acknowledgment
3. Second call: Execute with search tool

### Issue 3b: Natural Search Acknowledgments

**Current:**
```typescript
await this.iMessageAdapter.sendToUser('🔍 searching...', this.chatGuid, true);
```

**Proposed:**
```typescript
const SEARCH_ACKNOWLEDGMENTS = [
  "let me look that up",
  "searching for that now...",
  "one sec, checking on that",
  "looking into it...",
  "let me find out",
  "checking...",
  "on it, give me a moment",
  "let me search for that",
  "hold on, looking that up",
];

function getRandomSearchAck(): string {
  return SEARCH_ACKNOWLEDGMENTS[Math.floor(Math.random() * SEARCH_ACKNOWLEDGMENTS.length)];
}
```

### Issue 4: Search Result Formatting

**Current Flow:**
1. Claude returns text with search results
2. `stripCitations()` removes citation markup
3. Raw text sent to user

**Problem:** The formatting is whatever Claude decides, which may not be optimal for iMessage.

**Proposed Post-Processing:**
```typescript
function formatSearchResults(text: string): string {
  // Remove excessive newlines
  let formatted = text.replace(/\n{3,}/g, '\n\n');
  
  // Ensure bullet points are consistent
  formatted = formatted.replace(/^[•●○]\s*/gm, '• ');
  
  // Truncate if too long for iMessage
  if (formatted.length > 1000) {
    formatted = formatted.substring(0, 997) + '...';
  }
  
  return formatted;
}
```

---

## Implementation Priority

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 🔴 HIGH | Typing indicator after tapback | Medium | High - UX issue |
| 🔴 HIGH | General action acknowledgment system | High | High - UX issue |
| 🟡 MED | Search result formatting | Medium | Medium - Polish |
| 🟢 LOW | Agent architecture docs | Low | Documentation |

---

## 6. Agent Communication Flow - Detailed Analysis

### Question: Does the primary agent wait for subagents and then respond?

**Answer: YES**

The flow is:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. User Message Arrives                                                      │
│    MessageRouter → InteractionAgentRuntime.processUserMessage()             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. InteractionAgent Decides to Delegate                                      │
│    Uses send_message_to_agent("Reminder Agent", "Create reminder...")       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. ExecutionBatchManager.executeAgent() - ASYNC (not awaited)               │
│    InteractionAgentRuntime returns immediately                               │
│    MessageRouter finishes, typing indicator stops                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │   BACKGROUND EXECUTION        │
                    │                               │
                    │   ExecutionAgentRuntime       │
                    │   runs tools (reminders,      │
                    │   emails, etc.)               │
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. ExecutionBatchManager.completeExecution()                                 │
│    When all agents complete → dispatchToInteractionAgent(payload)           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. InteractionAgentRuntime.handleAgentMessage(payload)                       │
│    InteractionAgent receives results                                         │
│    Decides: send_message_to_user("Done! I'll remind you...")                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. User Sees Response                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Points:**
- ExecutionAgent does NOT send messages to user
- ExecutionAgent returns results to InteractionAgent
- InteractionAgent decides how to communicate results
- There's a GAP between step 3 and step 5 where user sees nothing

---

## 7. General Action Acknowledgment System (NEW DESIGN)

### Problem Statement

When the agent needs to perform ANY action (search, send email, create reminder, etc.), there's a delay before the user sees a response. The user should be notified immediately that something is happening.

### Current Behavior

| Action Type | Current Acknowledgment | Issue |
|-------------|----------------------|-------|
| Web Search | "🔍 searching..." (delayed) | Sent AFTER search completes |
| Send Email | None | User waits with no feedback |
| Create Reminder | None | User waits with no feedback |
| Spawn Subagent | None | User waits with no feedback |

### Proposed Solution: Action Acknowledgment System

**Design Principles:**
1. **Immediate feedback** - User should know something is happening within 1 second
2. **Natural language** - Not robotic, varied responses
3. **Context-aware** - Acknowledgment matches the action type
4. **Non-blocking** - Acknowledgment sent before action starts

### Implementation: Action Acknowledgments

```typescript
// src/utils/actionAcknowledgments.ts

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
    "hold on, looking that up",
  ],
  send_email: [
    "sending that email now",
    "on it, drafting the email",
    "let me send that for you",
    "composing that email",
  ],
  create_reminder: [
    "setting that reminder",
    "got it, creating the reminder",
    "adding that to your reminders",
    "I'll remind you",
  ],
  list_reminders: [
    "let me check your reminders",
    "pulling up your reminders",
    "checking what you have scheduled",
  ],
  create_trigger: [
    "setting that up for you",
    "creating that automation",
    "got it, I'll handle that",
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
    "let me take care of that",
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
```

### Integration Points

**Option A: Pre-emptive Detection (Before Claude Call)**

Detect likely actions from user message and send acknowledgment immediately:

```typescript
// In InteractionAgentRuntime.runInteractionLoop()

// Before calling Claude, detect if this looks like an action request
const likelyAction = detectLikelyAction(content);
if (likelyAction && !this.hasAcknowledged) {
  const ack = getActionAcknowledgment(likelyAction);
  await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
  this.hasAcknowledged = true;
}
```

**Option B: On Tool Use Detection (After Claude Decides)**

Send acknowledgment when Claude decides to use a tool:

```typescript
// In InteractionAgentRuntime.runInteractionLoop()

for (const toolUse of toolUseBlocks) {
  const actionType = detectActionType(toolUse.name);
  
  // Send acknowledgment for first tool use only
  if (!this.hasAcknowledged && actionType !== 'generic_tool') {
    const ack = getActionAcknowledgment(actionType);
    await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
    this.hasAcknowledged = true;
  }
  
  // Execute tool...
}
```

**Option C: Hybrid Approach (Recommended)**

1. For server tools (web_search): Pre-emptive detection (can't intercept)
2. For client tools: On tool use detection (more accurate)

### Recommended Implementation

```typescript
// In InteractionAgentRuntime

private hasAcknowledged = false;

private async runInteractionLoop(...) {
  // ... existing code ...

  // PRE-EMPTIVE: For web search (server tool), detect early
  if (this.looksLikeSearchQuery(content) && !this.hasAcknowledged) {
    const ack = getActionAcknowledgment('web_search');
    await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
    this.hasAcknowledged = true;
  }

  // ... Claude API call ...

  // ON TOOL USE: For client tools, acknowledge when detected
  for (const toolUse of toolUseBlocks) {
    if (!this.hasAcknowledged) {
      const actionType = detectActionType(toolUse.name);
      if (actionType !== 'generic_tool') {
        const ack = getActionAcknowledgment(actionType);
        await this.iMessageAdapter.sendToUser(ack, this.chatGuid, true);
        this.hasAcknowledged = true;
      }
    }
    // ... execute tool ...
  }
}

private looksLikeSearchQuery(text: string): boolean {
  const searchPatterns = [
    /\b(what|who|when|where|how|why)\b.*\?/i,
    /\b(search|find|look up|google|check)\b/i,
    /\b(weather|news|price|stock|score|result)\b/i,
    /\b(happening|events|today|tonight|tomorrow)\b/i,
  ];
  return searchPatterns.some(p => p.test(text));
}
```

### Expected Behavior After Implementation

| User Message | Action | Acknowledgment | Timing |
|-------------|--------|----------------|--------|
| "What's the weather?" | web_search | "let me look that up" | Immediate (pre-emptive) |
| "Send an email to John" | send_email | "sending that email now" | On tool detection |
| "Remind me tomorrow" | create_reminder | "setting that reminder" | On tool detection |
| "What reminders do I have?" | list_reminders | "let me check your reminders" | On tool detection |

### Files to Modify

1. **NEW**: `src/utils/actionAcknowledgments.ts` - Acknowledgment strings and detection
2. **MODIFY**: `src/agents/InteractionAgentRuntime.ts` - Integration logic
3. **REMOVE**: Hardcoded "🔍 searching..." message
