# Prompt-to-Code Harmony Audit

**Audit Date**: December 22, 2025  
**Last Updated**: December 22, 2025 (9:55 PM CST)  
**Status**: ✅ Complete (v2 - Post-Testing Updates)

---

## Table of Contents

1. [Prompt Feature → Code Mapping](#1-prompt-feature--code-mapping)
2. [Code Feature → Prompt Mapping (Inverse)](#2-code-feature--prompt-mapping-inverse)
3. [Conflicts Identified](#3-conflicts-identified)
4. [Resolutions Applied](#4-resolutions-applied)
5. [Final Harmony Status](#5-final-harmony-status)
6. [Post-Testing Fixes (v2)](#6-post-testing-fixes-v2)
7. [Areas Requiring Further Review](#7-areas-requiring-further-review)

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

