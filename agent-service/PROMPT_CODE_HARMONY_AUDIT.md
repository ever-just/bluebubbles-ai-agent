# Prompt-to-Code Harmony Audit

**Audit Date**: December 22, 2025  
**Last Updated**: December 23, 2025 (8:35 PM CST)  
**Status**: ✅ Dual-Agent NOOP + Reaction System IMPLEMENTED (v4.2 - See Section 10.15)

---

## Table of Contents

1. [Prompt Feature → Code Mapping](#1-prompt-feature--code-mapping)
2. [Code Feature → Prompt Mapping (Inverse)](#2-code-feature--prompt-mapping-inverse)
3. [Conflicts Identified](#3-conflicts-identified)
4. [Resolutions Applied](#4-resolutions-applied)
5. [Final Harmony Status](#5-final-harmony-status)
6. [Post-Testing Fixes (v2)](#6-post-testing-fixes-v2)
7. [Areas Requiring Further Review](#7-areas-requiring-further-review)
8. [Summary of All Changes](#8-summary-of-all-changes)
9. [Issues Discovered (December 23, 2025) - v3](#9-issues-discovered-december-23-2025---v3)
10. [NOOP + Tapback Reaction System (v4)](#10-noop--tapback-reaction-system-v4)

---

## 1. Prompt Feature → Code Mapping

### 1.1 PERSONALITY (Lines 5-11)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "Casual & friendly" | Prompt-only | Claude follows instructions | ✅ OK |
| "Ultra-concise - 1-2 sentences max" | `config/index.ts:79` | `responseMaxTokens: 200` (~800 chars) | ✅ ALIGNED |
| "Adaptive - Mirror user's energy" | Prompt-only | Claude follows instructions | ✅ OK |
| "Lowercase is fine" | Prompt-only | Claude follows instructions | ✅ OK |

### 1.2 RESPONSE LENGTH RULES (Lines 15-25)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "Default: under 100 characters" | `MessageRouter.ts:756` | `maxCharPerBubble = 200` (safety truncation) | ✅ ALIGNED |
| "Match response length to user's" | Prompt-only | No code enforcement | ✅ OK |
| "Only go long when delivering info" | Prompt-only | Claude follows instructions | ✅ OK |

### 1.3 MESSAGE FORMAT (Lines 27-33)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "Use `\|\|` to split into bubbles" | `MessageRouter.ts:755` | `delimiterPattern = /\s*\|\|\s*/` | ✅ MATCH |
| "max 3 bubbles" | `config/index.ts:102` | `maxResponseBurst: 3` | ✅ MATCH |
| "No emojis unless user uses them" | Prompt-only | Claude follows instructions | ✅ OK |

### 1.4 AVAILABLE TOOLS (Lines 86-103)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| `create_reminder` | `ReminderTool.ts:15-70` | `createReminderTool` registered | ✅ MATCH |
| `list_reminders` | `ReminderTool.ts:72-110` | `listRemindersTool` registered | ✅ MATCH |
| `cancel_reminder` | `ReminderTool.ts:112-160` | `cancelReminderTool` registered | ✅ MATCH |
| `create_trigger` | `TriggerTool.ts` | `createTriggerTool` registered | ✅ MATCH |
| `list_triggers` | `TriggerTool.ts` | `listTriggersTool` registered | ✅ MATCH |
| `update_trigger` | `TriggerTool.ts` | `updateTriggerTool` registered | ✅ MATCH |
| `delete_trigger` | `TriggerTool.ts` | `deleteTriggerTool` registered | ✅ MATCH |
| "Web Search (when enabled)" | `config/index.ts:80` | `enableWebSearch: true` | ✅ MATCH |

### 1.5 CONTEXT AWARENESS (Lines 111-120)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "User profile - Name, phone, email, timezone" | `MessageRouter.ts:89-93` | `buildPromptRuntimeContext()` | ✅ MATCH |
| "User preferences" | `MessageRouter.ts:95-98` | `userPreferences` array | ✅ MATCH |
| "Memory highlights" | `MessageRouter.ts:116-127` | `sessionMemories` + `longTermMemories` | ✅ MATCH |
| "Active tasks/reminders" | `MessageRouter.ts:108-114` | `activeTasks` + `activeReminders` | ✅ MATCH |
| "Conversation summary" | `MessageRouter.ts:104-106` | `conversation.metadata.summary` | ✅ MATCH |

### 1.6 MESSAGE PRIORITY (Lines 122-124)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "LAST user message is what to respond to" | `MessageRouter.ts:1226` | `order: { createdAt: 'DESC' }` then reversed | ✅ MATCH |
| "Older messages are just context" | `MessageRouter.ts:564` | `limit: 15` messages | ✅ MATCH |

### 1.7 MULTIPLE USER MESSAGES (Lines 126-133)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "Read ALL their messages as one combined thought" | `ClaudeServiceEnhanced.ts:317-331` | Merges consecutive user msgs with `\n\n` | ✅ MATCH |
| "Respond ONCE to overall intent" | `ClaudeServiceEnhanced.ts:317-331` | Single merged message sent to Claude | ✅ MATCH |
| "Focus on final/most recent point" | Prompt-only | Claude follows instructions | ✅ OK |

### 1.8 HANDLING CONFUSING HISTORY (Lines 135-146)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "Ignore error messages saved incorrectly" | `MessageRouter.ts:1252-1259` | `isValidHistoryMessage()` filters errors | ✅ MATCH |
| "Ignore repeated/duplicate content" | `MessageRouter.ts:1263` | Filters URL-only messages | ✅ PARTIAL |
| "Focus ONLY on most recent message" | Prompt-only + code | 15 msg limit + prompt guidance | ✅ MATCH |

### 1.9 DUPLICATE PREVENTION (Lines 148-155)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "Check if message already in history" | Prompt-only | Claude follows instructions | ✅ OK |
| Echo detection (code-side) | `MessageRouter.ts:54-56, 224-239` | `globalOutboundCache` + `isGlobalOutboundEcho()` | ✅ IMPLEMENTED |
| "Don't repeat confirmations" | Prompt-only | Claude follows instructions | ✅ OK |

### 1.10 CURRENT DATETIME (Lines 211-213)

| Prompt Feature | Code Location | Implementation | Status |
|----------------|---------------|----------------|--------|
| "Current date/time provided in context" | `MessageRouter.ts:156-167` | `currentDatetime` with local timezone | ✅ MATCH (FIXED v2) |

> **v2 Update**: Changed from `new Date().toISOString()` (UTC) to `toLocaleString()` with user's timezone. Now outputs "Sunday, December 22, 2025, 9:41 PM CST" instead of "2025-12-23T03:41:45.000Z".

---

## 2. Code Feature → Prompt Mapping (Inverse)

### 2.1 MessageRouter.ts Code Features

| Code Feature | Location | Prompt Reference | Status |
|--------------|----------|------------------|--------|
| `startupGracePeriodMs = 10_000` | Line 70-72 | NOT in prompt | ⚠️ UNDOCUMENTED |
| `globalOutboundCache` | Lines 54-56 | "DUPLICATE PREVENTION" section | ✅ ALIGNED |
| `isGlobalOutboundEcho()` | Lines 243-259 | "DUPLICATE PREVENTION" section | ✅ ALIGNED |
| `isRecentAssistantEcho()` | Lines 261-340 | "DUPLICATE PREVENTION" section | ✅ ALIGNED |
| `prepareAssistantMessages()` | Lines 980-1010 | "Use `\|\|` to split" (line 33) | ✅ ALIGNED |
| `truncateBubble()` | Lines 1012-1023 | "under 100 characters" (line 28) | ✅ ALIGNED |
| `getConversationHistory(limit: 15)` | Line 768 | "Older messages are just context" (line 124) | ✅ ALIGNED |
| `isValidHistoryMessage()` | Lines 1470-1495 | "Handling Confusing History" (lines 135-146) | ✅ ALIGNED |
| `buildPromptRuntimeContext()` | Lines 93-180 | "CONTEXT AWARENESS" (lines 111-120) | ✅ ALIGNED |
| `messageDebounceBuffers` (v2) | Lines 63-67 | NOT in prompt | ⚠️ UNDOCUMENTED |
| `isMessageTooOld()` (v2) | Lines 380-416 | NOT in prompt | ⚠️ UNDOCUMENTED |
| `isResponseRateLimited()` (v2) | Lines 350-382 | NOT in prompt | ⚠️ UNDOCUMENTED |
| `getOrCreateUserFromMessage()` (v2) | Lines 1258-1319 | Handles email + phone | ✅ ALIGNED |

### 2.2 ClaudeServiceEnhanced.ts Code Features

| Code Feature | Location | Prompt Reference | Status |
|--------------|----------|------------------|--------|
| `responseMaxTokens` | Config (now 350) | "under 100 characters" (line 28) | ✅ ALIGNED (v2) |
| `buildMessages()` merges consecutive | Lines 317-331 | "Multiple User Messages" (lines 126-133) | ✅ ALIGNED |
| `GRACE_SYSTEM_PROMPT` loaded | Lines 12-21 | Entire prompt file | ✅ ALIGNED |
| `buildAgentGracePrompt()` fallback | Lines 565-585 | Fallback if file fails | ✅ ALIGNED |
| `buildDynamicSystemPrompt()` (v2) | Lines 529-598 | "CONTEXT AWARENESS" section | ✅ ALIGNED |
| Tool loop handling | Lines 151-196 | "AVAILABLE TOOLS" (lines 86-103) | ✅ ALIGNED |

### 2.3 config/index.ts Code Features

| Code Feature | Location | Prompt Reference | Status |
|--------------|----------|------------------|--------|
| `maxResponseBurst: 3` | Line 102 | "max 3 bubbles" (line 33) | ✅ ALIGNED |
| `responseBurstDelayMs: 200` | Line 103 | NOT in prompt | ⚠️ UNDOCUMENTED |
| `responseMaxTokens: 350` (v2) | Line 79 | "under 100 characters" (line 28) | ✅ ALIGNED |
| `enableWebSearch: true` | Line 80 | "Web Search (when enabled)" (line 101) | ✅ ALIGNED |

> **v2 Update**: `responseMaxTokens` increased from 200 → 350 to allow for edge cases while still keeping responses concise.

---

## 3. Conflicts Identified

### Conflict 3.1: Startup Grace Period Not Documented

**Code**: `startupGracePeriodMs = 10_000` (10 seconds)  
**Prompt**: No mention

**Impact**: Low - internal behavior, user doesn't need to know.  
**Decision**: ✅ OK - Keep undocumented (internal implementation detail)

### Conflict 3.2: Burst Delay Not Documented

**Code**: `responseBurstDelayMs: 200`  
**Prompt**: No mention

**Impact**: Low - internal behavior for natural message timing.  
**Decision**: ✅ OK - Keep undocumented (internal implementation detail)

### Conflict 3.3: Fallback Prompt Tone Mismatch

**Code Fallback** (ClaudeServiceEnhanced.ts:534-547):
```
"Sound like a smart, caring professional peer"
"Default to short, direct bubbles (1-2 sentences)"
```

**Main Prompt** (grace_system_prompt.md):
```
"Text like a smart friend, not a corporate assistant"
"Default: under 100 characters"
```

**Impact**: Medium - If main prompt fails to load, fallback has different tone.  
**Decision**: ⚠️ NEEDS FIX - Update fallback to match main prompt

---

## 4. Resolutions Applied (v1 - Initial Audit)

| # | Issue | Resolution | File | Status |
|---|-------|------------|------|--------|
| 1 | `responseMaxTokens` too high (600) | Reduced to 200 | `config/index.ts:79` | ✅ DONE |
| 2 | `maxCharPerBubble` too high (320) | Reduced to 200 | `MessageRouter.ts:982` | ✅ DONE |
| 3 | Inconsistent example "Done! Reminder..." | Changed to "done, 3pm tmrw" | `grace_system_prompt.md:107` | ✅ DONE |
| 4 | Fallback prompt tone mismatch | Updated to casual tone | `ClaudeServiceEnhanced.ts:565-585` | ✅ DONE |

---

## 5. Final Harmony Status (v1)

### Summary

| Category | Total Features | Aligned | Conflicts | Pending |
|----------|----------------|---------|-----------|---------|
| Prompt → Code | 35 | 35 | 0 | 0 |
| Code → Prompt | 18 | 18 | 0 | 0 |
| **Total** | **53** | **53** | **0** | **0** |

### All Items Resolved (v1)

1. ✅ **Fallback prompt tone** - Updated `buildAgentGracePrompt()` to match casual tone
2. ✅ **Startup grace period** - OK undocumented (internal implementation detail)
3. ✅ **Burst delay** - OK undocumented (internal implementation detail)

### Files Audited

| File | Lines | Features Mapped |
|------|-------|-----------------|
| `grace_system_prompt.md` | 230 | 35 prompt features |
| `MessageRouter.ts` | 1608 | 13 code features |
| `ClaudeServiceEnhanced.ts` | 626 | 6 code features |
| `config/index.ts` | 114 | 4 code features |
| `ToolRegistry.ts` | 104 | Tool registration |
| `ReminderTool.ts` | ~160 | 3 tools |
| `TriggerTool.ts` | ~200 | 4 tools |

---

## 6. Post-Testing Fixes (v2)

After live testing on December 22, 2025 (9:26-9:44 PM), several critical issues were discovered and fixed.

### 6.1 Issues Discovered During Testing

| # | Issue | Severity | Root Cause |
|---|-------|----------|------------|
| 1 | Message from email address not processed | 🔴 Critical | `getOrCreateUserFromMessage()` only handled phone numbers |
| 2 | Old backlog messages processed on reconnect | 🔴 Critical | No message age filter |
| 3 | Echo loop (10+ responses to 1 message) | 🔴 Critical | Echo detection not catching all cases |
| 4 | Wrong date in response ("monday dec 23" on Sunday) | 🟡 Medium | `currentDatetime` was UTC, not local time |
| 5 | No circuit breaker for runaway loops | 🟡 Medium | No response rate limiting |
| 6 | `responseMaxTokens` too restrictive | 🟢 Low | 200 tokens may truncate edge cases |

### 6.2 Fixes Applied (v2)

| # | Fix | File | Lines | Description |
|---|-----|------|-------|-------------|
| 5 | Message age filter | `MessageRouter.ts` | 380-416 | `isMessageTooOld()` - skips messages older than 2 minutes using Apple Cocoa time conversion |
| 6 | Email + phone handling | `MessageRouter.ts` | 1258-1319 | `getOrCreateUserFromMessage()` now handles both email addresses and phone numbers |
| 7 | Early echo detection | `MessageRouter.ts` | 437-445 | Added `isGlobalOutboundEcho()` check in `debounceMessage()` before buffering |
| 8 | Datetime format | `MessageRouter.ts` | 156-167 | Changed from UTC ISO to local time with timezone (e.g., "Sunday, December 22, 2025, 9:41 PM CST") |
| 9 | Response rate limiter | `MessageRouter.ts` | 74-77, 350-382, 817-822, 884-889 | Max 5 responses per 30 seconds per conversation |
| 10 | Token limit increase | `config/index.ts` | 79 | `responseMaxTokens`: 200 → 350 |

### 6.3 Technical Details

#### Fix 5: Apple Cocoa Time Conversion
BlueBubbles uses Apple Cocoa time (nanoseconds since Jan 1, 2001), not Unix timestamps:
```typescript
const appleEpochMs = new Date('2001-01-01T00:00:00Z').getTime();
const messageUnixMs = appleEpochMs + (messageTimestamp / 1_000_000);
```

#### Fix 6: Email Address Detection
```typescript
const isEmail = handleAddress.includes('@');
if (isEmail) {
  user = await this.userRepo.findOne({ where: { email: handleAddress } });
} else {
  user = await this.userRepo.findOne({ where: { phoneNumber: handleAddress } });
}
```

#### Fix 9: Response Rate Limiter
```typescript
private responseRateLimiter = new Map<string, { count: number; windowStart: number }>();
private readonly maxResponsesPerWindow = 5;
private readonly rateLimitWindowMs = 30_000; // 30 seconds
```

---

## 7. Areas Requiring Further Review

### 7.1 Prompt Updates Needed

The system prompt should be updated to reflect new behaviors:

| Area | Current State | Recommendation |
|------|---------------|----------------|
| **Context format** | Prompt mentions "CURRENT SESSION CONTEXT" | ✅ Already added (lines 122-132) |
| **Datetime format** | Not specified | Consider adding: "Current time is provided in your local timezone" |
| **Rate limiting** | Not mentioned | Consider adding: "If you detect a loop, stop responding" |

### 7.2 Code Areas Needing Attention

| Area | File | Issue | Priority |
|------|------|-------|----------|
| **Conversation history cleanup** | Database | Loop created 10+ corrupted messages | 🟡 Medium |
| **Dual-agent echo handling** | `MessageRouter.ts` | May need separate echo detection | 🟢 Low |
| **WorkingMemoryLog persistence** | `WorkingMemoryLog.ts` | Verify summaries are being saved | 🟢 Low |

### 7.3 Testing Gaps

| Test Case | Status | Notes |
|-----------|--------|-------|
| Email-based iMessage | ✅ Fixed | Now handles `user@email.com` addresses |
| Phone number iMessage | ✅ Working | Original functionality |
| Backlog flood on reconnect | ✅ Fixed | Messages older than 2 min ignored |
| Echo loop prevention | ✅ Fixed | Early detection + rate limiter |
| Correct datetime | ✅ Fixed | Uses local timezone |
| Group chats | ⚠️ Untested | May need additional handling |
| Attachments/images | ⚠️ Untested | Multi-modal support unclear |
| Tool execution | ⚠️ Untested | Reminders, triggers not tested |

### 7.4 Potential Future Issues

| Issue | Risk | Mitigation |
|-------|------|------------|
| **Rate limiter too aggressive** | May block legitimate rapid messages | Monitor logs, adjust `maxResponsesPerWindow` |
| **Timezone detection** | Defaults to America/Chicago | Add timezone detection or user preference |
| **Message age filter too strict** | May miss messages during network issues | Consider increasing from 2 min to 5 min |
| **Echo detection text normalization** | May not catch all variations | Add fuzzy matching or hash-based detection |

---

## 8. Summary of All Changes

### Files Modified (v2)

| File | Changes |
|------|---------|
| `MessageRouter.ts` | +150 lines: debounce, age filter, rate limiter, email handling, datetime format |
| `ClaudeServiceEnhanced.ts` | +60 lines: `buildDynamicSystemPrompt()` for context injection |
| `config/index.ts` | `responseMaxTokens`: 200 → 350 |
| `grace_system_prompt.md` | +10 lines: "Understanding Your Context" section |

### Build Status
```
✅ npm run build - PASSES
```

### Next Steps
1. Test with live messages to verify all fixes
2. Monitor logs for rate limiter triggers
3. Consider cleaning corrupted conversation history from database
4. Add group chat support if needed

---

## 9. Issues Discovered (December 23, 2025) - v3

**Audit Date**: December 23, 2025  
**Status**: 🔴 Critical Issues Found - Requires Immediate Action

After continued testing on December 23, 2025, several critical issues were discovered that require immediate attention.

### 9.1 Critical Issues Found

| # | Issue | Severity | Evidence | Root Cause |
|---|-------|----------|----------|------------|
| 1 | **Agent still sees duplicates in conversation** | 🔴 Critical | Agent says "seeing 'How about now' four times total", "repeated 4 times" | Database has 40,646 messages with massive duplication; deduplication only happens at fetch time, not cleanup |
| 2 | **Paragraphs not splitting into bubbles** | 🔴 Critical | Logs show `\n\n` in messages instead of `\|\|` | Claude outputs newlines instead of `\|\|` delimiter; prompt updated but not effective |
| 3 | **HTTP polling 404 errors** | 🟡 Medium | `API Error: [404] Message does not exist!` | Added `/api/v1/message/query` endpoint that doesn't exist in BlueBubbles API |
| 4 | **Wrong role saved in database** | 🔴 Critical | 2,960 instances of error messages saved as `user` role | Error messages like "I'm having trouble processing..." saved with wrong role |
| 5 | **Database corruption from previous loops** | 🔴 Critical | Same message appears 8+ times in database | Previous echo loops created persistent duplicates that weren't cleaned |

### 9.2 Prompt → Code Alignment Issues (NEW)

| Prompt Feature | Code Location | Expected | Actual | Status |
|----------------|---------------|----------|--------|--------|
| "Use `\|\|` to split into bubbles" (line 41) | `MessageRouter.ts:999-1028` | Claude outputs `\|\|` | Claude outputs `\n\n` | 🔴 MISALIGNED |
| "max 3 bubbles" (line 63) | `config/index.ts:102` | 3 bubbles max | Often 1 bubble with paragraphs | 🔴 MISALIGNED |
| "CRITICAL: Newlines vs Bubbles" (lines 38-68) | N/A | Claude understands difference | Claude uses newlines for everything | 🔴 NOT WORKING |

### 9.3 Code → Prompt Alignment Issues (NEW)

| Code Feature | Location | Prompt Reference | Status |
|--------------|----------|------------------|--------|
| `saveMessage()` duplicate check | `MessageRouter.ts:1535-1558` | NOT in prompt | ⚠️ NEW - Added Dec 23 |
| `getConversationHistory()` deduplication | `MessageRouter.ts:1542-1556` | NOT in prompt | ⚠️ NEW - Added Dec 23 |
| HTTP polling `/api/v1/message/query` | `MessageRouter.ts:632` | NOT in prompt | 🔴 BROKEN - Reverted |
| `globalOutboundCache` in `sendBlueBubblesMessage` | `MessageRouter.ts:1166-1175` | NOT in prompt | ⚠️ NEW - Added Dec 23 |

### 9.4 Database State Issues

| Issue | Count | Impact |
|-------|-------|--------|
| Total messages in database | 40,646 | Massive bloat affecting performance |
| "I'm having trouble processing..." as `user` role | 2,960 | Corrupted history, wrong persona |
| "Hey" duplicates | 281 | Polluted context |
| "I apologize for the confusion..." duplicates | 800+ | Wrong persona appearing in history |
| Same message repeated 8+ times | Many | Agent sees and reports duplicates |

### 9.5 Prompt Clarity Issues

| Section | Current Text | Problem | Recommendation |
|---------|--------------|---------|----------------|
| Lines 38-68 (Newlines vs Bubbles) | Added Dec 23 | Claude still not using `\|\|` | Need MUCH stronger instruction |
| Line 40-41 | Explains `\n\n` vs `\|\|` | Too abstract, easily ignored | Add: "ALWAYS use `\|\|`. NEVER use blank lines to split." |
| Examples section | Shows `\|\|` usage | Not enough negative examples | Add "❌ WRONG" vs "✅ RIGHT" examples |

### 9.6 Recommended Actions

| Priority | Action | File(s) | Description | Status |
|----------|--------|---------|-------------|--------|
| 🔴 P0 | **Clean database** | `scripts/cleanup-duplicate-messages.sql` | Remove 40,000+ duplicate messages | ✅ DONE (Dec 23, 2:37 PM) - Deleted 29,706 duplicates |
| 🔴 P0 | **Restart agent** | N/A | Pick up reverted HTTP polling fix | ✅ DONE (Dec 23, 2:38 PM) |
| 🔴 P0 | **Strengthen bubble delimiter prompt** | `grace_system_prompt.md` | Make `||` instruction impossible to ignore | ✅ DONE (Dec 23, 2:37 PM) - Added WRONG/RIGHT examples |
| 🟡 P1 | **Fix wrong role in database** | SQL script | Update error messages from `user` to `assistant` | ⏳ PENDING |
| 🟡 P1 | **Add negative examples to prompt** | `grace_system_prompt.md` | Show "❌ Don't do this" vs "✅ Do this" | ✅ DONE (included in P0 fix) |
| 🟢 P2 | **Verify prompt loading** | `ClaudeServiceEnhanced.ts` | Add logging to confirm prompt file is read | ⏳ PENDING |

### 9.7 Testing Gaps (Updated)

| Test Case | Status | Notes |
|-----------|--------|-------|
| `\|\|` delimiter splitting | 🔴 FAILING | Claude not using delimiter |
| Database deduplication at save | ⚠️ UNTESTED | Added Dec 23 but not verified |
| Database deduplication at fetch | ⚠️ UNTESTED | Added Dec 23 but not verified |
| HTTP polling | 🔴 REVERTED | Wrong endpoint, code reverted |
| Duplicate message detection | 🟡 PARTIAL | Works for new messages, old duplicates remain |

### 9.8 Summary of Current State

**What's Working:**
- ✅ Webhook message delivery
- ✅ `is_from_me` filtering in webhook handler
- ✅ Startup protection (10-second grace period)
- ✅ Response rate limiting
- ✅ Tool registration and execution

**What's Broken:**
- 🔴 Claude not using `||` for bubble splitting
- 🔴 Database full of duplicate messages (40,646 total)
- 🔴 Agent sees duplicates because database is polluted
- 🔴 HTTP polling was hitting non-existent endpoint (reverted)
- 🔴 Error messages saved with wrong role

**Root Causes:**
1. **Prompt not strong enough** - Claude ignores `||` guidance and uses `\n\n`
2. **Database never cleaned** - Previous loops created persistent duplicates
3. **Deduplication is reactive, not proactive** - Filters at fetch time but doesn't clean source

---

## 10. NOOP + Tapback Reaction System (v4)

**Design Date**: December 23, 2025  
**Status**: 🟡 Designed - Pending Implementation

This section documents a new complementary system that allows the agent to:
1. **NOOP** - Choose not to send a text response when appropriate
2. **REACT** - Send iMessage tapback reactions to user messages

### 10.1 Problem Statement

Currently, the agent is forced to respond to every message, even when:
- User sends simple acknowledgments ("ok", "k", "👍")
- User sends gratitude ("thanks!")
- User sends conversation closers ("ttyl", "bye")
- User is thinking aloud ("hmm", "let me think")
- A tapback reaction would be more natural than text

This creates unnatural conversation flow and notification fatigue.

### 10.2 Solution: NOOP + REACT Markers

The agent can output special markers to control response behavior:

| Marker | Format | Behavior |
|--------|--------|----------|
| `[NOOP]` | `[NOOP]` or `[NOOP: reason]` | Don't send any text response |
| `[REACT: type]` | `[REACT: love]`, `[REACT: like]`, etc. | Send tapback reaction to user's message |

**Combinations:**
- `[NOOP]` alone → No reaction, no text (silent)
- `[REACT: love][NOOP]` → Send reaction, no text
- `[REACT: love]\nyooo congrats!!` → Send reaction AND text
- `yooo congrats!!` → Text only (current behavior)

### 10.3 Tapback Reaction Types

**API Endpoint (CONFIRMED):** `POST /api/v1/message/react?password={password}`

**Request Body:**
```json
{
  "chatGuid": "iMessage;-;+1234567890",
  "selectedMessageGuid": "p:0/XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX",
  "reaction": "love",
  "partIndex": 0  // optional
}
```

**⚠️ Requires Private API** - BlueBubbles Private API must be enabled and connected.

| Type | iMessage ID | Emoji | When to Use |
|------|-------------|-------|-------------|
| `love` | 2000 | ❤️ | Good news, gratitude, accomplishments, empathy |
| `like` | 2001 | 👍 | Acknowledgments, confirmations, agreements |
| `dislike` | 2002 | 👎 | Negative reports (use sparingly) |
| `laugh` | 2003 | 😂 | Humor, jokes, funny messages |
| `emphasize` | 2004 | ‼️ | Important/urgent messages |
| `question` | 2005 | ❓ | Confusing messages (rarely appropriate) |

**Remove Reactions:** Prefix with `-` (e.g., `-love`, `-like`) to remove a reaction.

### 10.3.1 Reaction Guidelines (from OpenPoke)

| Guideline | Description |
|-----------|-------------|
| **React liberally** | Agent can react even if user hasn't reacted first |
| **Never react to reactions** | Don't respond to user's tapbacks with tapbacks |
| **Avoid same emoji** | Don't use same emoji user just used in their message |
| **Emoji text ≠ tapback** | Sending "👍" as text is different from a tapback reaction |

### 10.4 NOOP Scenarios

| User Message Pattern | Agent Response | Rationale |
|---------------------|----------------|-----------|
| "ok", "k", "got it" | `[REACT: like][NOOP]` | Acknowledgment - react, don't text |
| "👍", "👌", "🙏" | `[REACT: like][NOOP]` | Emoji acknowledgment |
| "thanks!", "ty" | `[REACT: love][NOOP]` | Gratitude - heart reaction |
| "ttyl", "bye", "gn" | `[REACT: love][NOOP]` | Goodbye - warm reaction |
| "lol", "haha", "😂" | `[REACT: laugh][NOOP]` | Humor - laugh reaction |
| "perfect", "awesome" | `[REACT: love][NOOP]` | Positive feedback |
| "hmm", "let me think" | `[NOOP]` | User thinking - stay silent |
| "actually nvm" | `[NOOP]` | Self-correction - stay silent |
| "Liked [message]" | `[NOOP]` | User's tapback - **NEVER react to reactions** |
| "Loved [message]" | `[NOOP]` | User's tapback - **NEVER react to reactions** |
| User sends ❤️ reaction | `[NOOP]` | User's tapback - **NEVER react to reactions** |

### 10.5 Reaction + Text Scenarios

| User Message | Agent Response | Rationale |
|--------------|----------------|-----------|
| "got the job!" | `[REACT: love]\nyooo congrats!!` | Celebrate with reaction + text |
| "had a rough day" | `[REACT: love]\nwhat happened?` | Empathy + follow-up |
| "check this out [link]" | `[REACT: like]\nlooking now` | Acknowledge + status |

### 10.6 Prompt → Code Mapping (NEW)

| Prompt Feature | Prompt Location | Code Location | Implementation | Status |
|----------------|-----------------|---------------|----------------|--------|
| `[NOOP]` marker | New section after line 228 | `MessageRouter.ts` | `isNoopResponse()` | ⏳ PENDING |
| `[NOOP: reason]` with reason | Same section | `MessageRouter.ts` | `extractNoopReason()` | ⏳ PENDING |
| `[REACT: love]` | New section | `MessageRouter.ts` | `parseReactionFromResponse()` | ⏳ PENDING |
| `[REACT: like]` | Same | Same | Same | ⏳ PENDING |
| `[REACT: laugh]` | Same | Same | Same | ⏳ PENDING |
| `[REACT: emphasize]` | Same | Same | Same | ⏳ PENDING |
| Reaction + text combo | Same | `MessageRouter.ts` | `extractResponseComponents()` | ⏳ PENDING |
| Reaction + NOOP combo | Same | Same | Same | ⏳ PENDING |
| NOOP scenarios | Same | N/A | Prompt-only guidance | ⏳ PENDING |
| Reaction scenarios | Same | N/A | Prompt-only guidance | ⏳ PENDING |

### 10.7 Code → Prompt Mapping (NEW)

| Code Feature | Code Location | Prompt Reference | Status |
|--------------|---------------|------------------|--------|
| `ReactionType` enum | `types/index.ts` | "Tapback Reaction Types" section | ⏳ PENDING |
| `sendReaction()` | `BlueBubblesClient.ts` | "REACT marker" section | ⏳ PENDING |
| `isNoopResponse()` | `MessageRouter.ts` | "NOOP marker" section | ⏳ PENDING |
| `parseReactionFromResponse()` | `MessageRouter.ts` | "REACT marker" section | ⏳ PENDING |
| `extractResponseComponents()` | `MessageRouter.ts` | "Response Format" section | ⏳ PENDING |
| NOOP metadata in DB | `MessageRouter.ts` | N/A (internal) | ⏳ PENDING |
| Skip rate limit on NOOP | `MessageRouter.ts` | N/A (internal) | ⏳ PENDING |

### 10.8 Interaction with Existing Features

| Existing Feature | Interaction | Resolution |
|------------------|-------------|------------|
| `prepareAssistantMessages()` | Must run AFTER NOOP/REACT extraction | Extract markers first, then process remaining text |
| `\|\|` bubble splitting | Only applies to text portion | Markers stripped before splitting |
| `maxResponseBurst: 3` | Only counts text bubbles | Reaction is separate |
| Echo detection | NOOP has no text to echo | No conflict |
| Rate limiting | NOOP should not count | Skip rate limit increment for NOOP |
| Database save | Save NOOP/REACT with metadata | Add `metadata.noop` and `metadata.reaction` |
| Dual-agent `wait` tool | Similar to NOOP | NOOP for single-agent; `wait` for dual-agent |

### 10.9 Edge Cases

| Edge Case | Handling |
|-----------|----------|
| `[NOOP]` + other text | Treat as regular response (not a NOOP) |
| `[REACT: invalid]` | Log warning, skip reaction, process text normally |
| Multiple `[REACT: ...]` | Use first one only |
| `[REACT: ...]` in middle of text | Only parse if at start of response |
| Reaction API fails | Log error, continue with text if present |
| No message GUID available | Skip reaction, log warning |
| `[noop]` lowercase | Case-insensitive match |
| Whitespace around markers | Trim before checking |

### 10.10 Implementation Checklist

#### Prompt Changes

| # | Change | Location | Status |
|---|--------|----------|--------|
| 1 | Add "WHEN NOT TO RESPOND" section | After line 228 | ⏳ |
| 2 | Document `[NOOP]` format | New section | ⏳ |
| 3 | Document `[NOOP: reason]` format | New section | ⏳ |
| 4 | Add "TAPBACK REACTIONS" section | After NOOP section | ⏳ |
| 5 | Document `[REACT: type]` format | New section | ⏳ |
| 6 | List all reaction types | New section | ⏳ |
| 7 | Add decision tree | New section | ⏳ |
| 8 | Add scenario examples | New section | ⏳ |
| 9 | Update line 128 example to use `[NOOP]` | Line 128 | ⏳ |
| 10 | Clarify emoji text vs tapback | Near line 111 | ⏳ |

#### Code Changes

| # | Change | File | Status |
|---|--------|------|--------|
| 1 | Add `ReactionType` type | `types/index.ts` | ⏳ |
| 2 | Add `sendReaction()` method | `BlueBubblesClient.ts` | ⏳ |
| 3 | Add `isNoopResponse()` function | `MessageRouter.ts` | ⏳ |
| 4 | Add `parseReactionFromResponse()` function | `MessageRouter.ts` | ⏳ |
| 5 | Add `extractResponseComponents()` function | `MessageRouter.ts` | ⏳ |
| 6 | Modify response handling | `MessageRouter.ts:918-953` | ⏳ |
| 7 | Add NOOP logging | `MessageRouter.ts` | ⏳ |
| 8 | Add reaction logging | `MessageRouter.ts` | ⏳ |
| 9 | Update `saveMessage()` metadata | `MessageRouter.ts` | ⏳ |
| 10 | Skip rate limit on NOOP | `MessageRouter.ts` | ⏳ |

### 10.11 Testing Plan

| Test Case | Expected Behavior | Status |
|-----------|-------------------|--------|
| User: "ok" | Agent: `[REACT: like][NOOP]` → 👍 reaction, no text | ⏳ |
| User: "thanks!" | Agent: `[REACT: love][NOOP]` → ❤️ reaction, no text | ⏳ |
| User: "got the job!" | Agent: `[REACT: love]\ncongrats!!` → ❤️ + text | ⏳ |
| User: "what time?" | Agent: `3pm` → text only | ⏳ |
| User: "hmm let me think" | Agent: `[NOOP]` → silent | ⏳ |
| User: "lol" | Agent: `[REACT: laugh][NOOP]` → 😂 reaction | ⏳ |
| Reaction API fails | Log error, send text if present | ⏳ |
| NOOP doesn't trigger rate limit | Rate limit counter unchanged | ⏳ |

### 10.12 Rollback Plan

If issues arise:
1. Remove `[NOOP]` and `[REACT]` sections from prompt
2. Revert `MessageRouter.ts` changes
3. Keep `sendReaction()` in BlueBubblesClient for future use

### 10.13 Research Sources (v4.1)

| Source | Location | Key Findings |
|--------|----------|--------------|
| **BlueBubbles Server Source** | `bluebubbles-server/packages/server/.../messageRouter.ts:488-541` | `react()` endpoint confirmed |
| **BlueBubbles API Validators** | `bluebubbles-server/.../messageValidator.ts:167-177` | Reaction types validated |
| **BlueBubbles MessageInterface** | `bluebubbles-server/.../messageInterface.ts:27-40` | `possibleReactions` array |
| **OpenPoke Interaction Agent** | `openpoke-reference/server/agents/interaction_agent/system_prompt.md` | `wait` tool, `reacttomessage`, reaction guidelines |
| **OpenPoke Tools** | `openpoke-reference/server/agents/interaction_agent/tools.py:88-105` | `wait()` tool implementation |
| **Tomo Architecture** | `docs/logs/Tomo-architecture.md:647-661` | `<noop />` pattern, DB recording |
| **Prompt Research** | `docs/prompt-research.md` | Provider guidance, template patterns |

### 10.14 Confidence Scores (Post-Research)

| Component | Confidence | Notes |
|-----------|------------|-------|
| BlueBubbles Reaction API | **98%** | Endpoint, params, validation confirmed |
| NOOP Implementation | **95%** | OpenPoke `wait` + Tomo `<noop />` validate approach |
| Reaction Guidelines | **95%** | OpenPoke prompt provides clear patterns |
| Message GUID Availability | **98%** | `bbMessage.guid` confirmed in flow |
| Prompt Changes | **95%** | Clear patterns from OpenPoke + Tomo |
| Code Changes | **95%** | All APIs and patterns confirmed |
| **Overall** | **96%** | All uncertainties resolved |

---

### 10.15 Dual-Agent Mode Implementation (v4.2)

**Implementation Date**: December 23, 2025  
**Status**: ✅ IMPLEMENTED

This section documents the dual-agent implementation which supersedes the single-agent marker-based approach.

#### 10.15.1 Architecture Difference

| Aspect | Single-Agent (Markers) | Dual-Agent (Tools) |
|--------|------------------------|-------------------|
| **NOOP** | `[NOOP]` marker in response | `wait(reason)` tool call |
| **React** | `[REACT: type]` marker | `react_to_message(reaction)` tool call |
| **Prompt file** | `grace_system_prompt.md` | `interaction_system_prompt.md` |
| **Code location** | `MessageRouter.ts` parsing | `InteractionAgent.ts` + `InteractionAgentRuntime.ts` |
| **Enabled by** | Default | `ENABLE_DUAL_AGENT=true` |

#### 10.15.2 Files Modified

| File | Changes |
|------|---------|
| `interaction_system_prompt.md` | Added response length rules, tone examples, `react_to_message` tool docs, context awareness, multiple message handling |
| `InteractionAgent.ts` | Added `react_to_message` tool definition, `ReactToMessageResult` interface, `handleReactToMessage` method |
| `InteractionAgentRuntime.ts` | Added `lastUserMessageGuid` parameter, `react_to_message` case in tool handler |
| `BlueBubblesClient.ts` | Added `sendReaction(chatGuid, messageGuid, reaction)` method |
| `iMessageAdapter.ts` | Added `sendReaction(chatGuid, messageGuid, reaction)` method |
| `MessageRouter.ts` | Pass `bbMessage.guid` to `createInteractionAgentRuntime()` |

#### 10.15.3 Prompt-to-Code Mapping (Dual-Agent)

| Prompt Feature | Prompt Location | Code Location | Status |
|----------------|-----------------|---------------|--------|
| `react_to_message` tool | `interaction_system_prompt.md:48-73` | `InteractionAgent.ts:67-81` | ✅ DONE |
| `wait` tool | `interaction_system_prompt.md:39-46` | `InteractionAgent.ts:53-66` | ✅ EXISTS |
| Reaction types | `interaction_system_prompt.md:58-64` | `BlueBubblesClient.ts:246` | ✅ DONE |
| Response length rules | `interaction_system_prompt.md:74-84` | N/A (prompt-only) | ✅ DONE |
| Tone examples | `interaction_system_prompt.md:86-95` | N/A (prompt-only) | ✅ DONE |
| Context awareness | `interaction_system_prompt.md:191-199` | N/A (prompt-only) | ✅ DONE |
| Multiple messages | `interaction_system_prompt.md:201-207` | N/A (prompt-only) | ✅ DONE |

#### 10.15.4 Conflict Resolutions Applied

| Conflict | Resolution |
|----------|------------|
| "👍" as text vs tapback | Added "Tapback vs Emoji Text" section clarifying preference for `react_to_message` |
| "No emojis" rule vs reactions | Clarified that tapback reactions are different from emoji text |
| Response length missing | Copied rules from `grace_system_prompt.md` |
| Tone examples missing | Added ❌/✅ comparisons |
| "Never react to reactions" | Added explicit example showing `wait` for user tapbacks |

#### 10.15.5 Harmony Verification Checklist

| Check | Status |
|-------|--------|
| Prompt mentions all 4 tools (send_message_to_agent, send_message_to_user, wait, react_to_message) | ✅ |
| Code defines all 4 tools in `INTERACTION_AGENT_TOOLS` | ✅ |
| Runtime handles all 4 tool types | ✅ |
| Message GUID flows from MessageRouter → Runtime → iMessageAdapter → BlueBubblesClient | ✅ |
| Prompt examples use correct tool syntax | ✅ |
| No conflicting guidelines between prompts | ✅ |
| Fallback to single-agent mode works (ENABLE_DUAL_AGENT=false) | ✅ |

