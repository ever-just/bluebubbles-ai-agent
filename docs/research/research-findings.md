# Research Findings: BlueBubbles AI Agent Integration

## Summary

Research completed on Dec 20, 2025. Key findings below.

---

## 1. BlueBubbles API & `isFromMe` Field

### Key Finding: `isFromMe` IS Available in Webhooks ✅

From the official BlueBubbles Python webhook example:
```python
# Ignore messages that I sent
if data.get('data').get('isFromMe'):
    return
```

**Source**: [BlueBubbles Python Web Server Example](https://docs.bluebubbles.app/server/developer-guides/simple-web-server-for-webhooks/python-web-server)

### Why Our Code Might Not See It
The field is `isFromMe` (camelCase), not `is_from_me` (snake_case). Our TypeScript interface may be using the wrong property name.

**Action**: Check if we're accessing `bbMessage.isFromMe` vs `bbMessage.is_from_me`.

### Message Structure from BlueBubbles
From GitHub issue #597, a real message payload shows:
```json
{
  "ROWID": 3343,
  "guid": "<guid>",
  "isFromMe": true,
  "dateCreated": "December 11, 2023 9:47:51 AM",
  "dateDelivered": "December 11, 2023 9:42:34 AM",
  ...
}
```

**Confidence Increase**: 90% → The field exists and is reliable. We likely have a property name mismatch.

---

## 2. Claude Tool Calling Best Practices

### Key Findings from Anthropic Docs

1. **Detailed Descriptions Are Critical**
   > "Provide extremely detailed descriptions. This is by far the most important factor in tool performance."
   > "Aim for at least 3-4 sentences per tool description."

2. **Tool Definition Requirements**:
   - What the tool does
   - When it should be used (and when it shouldn't)
   - What each parameter means
   - Important caveats or limitations

3. **Parallel Tool Use**
   - Claude can call multiple tools in one response by default
   - Can disable with `disable_parallel_tool_use=true`
   - Claude 4 models have better parallel tool calling than 3.7

4. **Tool Loop Pattern**
   - Check `stop_reason === 'tool_use'`
   - Execute tools, append results to messages
   - Continue calling Claude until `stop_reason !== 'tool_use'`

**Our Current Implementation**: Already follows this pattern in `ClaudeServiceEnhanced.ts` ✅

### Orchestrator-Workers Pattern (from Anthropic Cookbook)

The pattern we want to implement:
1. **Orchestrator** analyzes task, identifies approaches
2. **Workers** execute specific subtasks in parallel
3. **Results** are collected and synthesized

This maps directly to OpenPoke's Interaction/Execution agent split.

**Confidence Increase**: 85% → Well-documented patterns exist.

---

## 3. TypeScript Async Patterns for Agent Coordination

### Key Patterns

1. **Promise.all() for Parallel Execution**
   ```typescript
   const promises = tasks.map(task => executeAgent(task));
   const results = await Promise.all(promises);
   ```

2. **Timeout Handling**
   ```typescript
   const result = await Promise.race([
     executeAgent(task),
     new Promise((_, reject) => 
       setTimeout(() => reject(new Error('Timeout')), 90000)
     )
   ]);
   ```

3. **Error Handling in Parallel**
   - `Promise.all()` fails fast on first rejection
   - Use `Promise.allSettled()` to get all results regardless of failures

### OpenPoke's Approach (Python → TypeScript Translation)

Python:
```python
result = await asyncio.wait_for(
    runtime.execute(instructions),
    timeout=self.timeout_seconds,
)
```

TypeScript equivalent:
```typescript
const timeoutPromise = new Promise<never>((_, reject) => 
  setTimeout(() => reject(new Error('Timeout')), this.timeoutSeconds * 1000)
);
const result = await Promise.race([
  runtime.execute(instructions),
  timeoutPromise
]);
```

**Confidence Increase**: 85% → Patterns translate cleanly.

---

## 4. Similar Open-Source Implementations

### LangChain.js Agents

Key patterns from LangChain:
- `createAgent()` with tools and model
- ReAct loop (Reasoning + Acting)
- Tool error handling via middleware
- Memory via state schema

```typescript
const agent = createAgent({
  model: "gpt-4o",
  tools: [search, getWeather],
});
```

### Vercel AI SDK

Simple tool definition:
```typescript
const logToConsoleTool = tool({
  description: "Log a message to the console",
  parameters: z.object({
    message: z.string().describe("The message to log"),
  }),
  execute: async ({ message }) => {
    console.log(message);
    return { success: true };
  },
});
```

### BlueBubbles + AI Projects

Found on GitHub:
- **TiM** (Typst for iMessage) - Bot using BlueBubbles
- **ha-bluebubbles** - Home Assistant integration
- Medium article on ChatGPT + BlueBubbles (n8n workflow)

No comprehensive TypeScript AI agent implementations found specifically for BlueBubbles.

**Confidence**: We're building something novel, but patterns from LangChain/Vercel AI SDK apply.

---

## 5. Updated Confidence Assessment

| Area | Before | After | Notes |
|------|--------|-------|-------|
| Echo Detection | 60% | **95%** | `isFromMe` exists, likely property name issue |
| Tool Registration | 90% | **95%** | Well-documented patterns |
| Tool Calling Loop | 75% | **90%** | Already implemented correctly |
| Interaction/Execution Split | 75% | **85%** | Anthropic cookbook validates pattern |
| Async Batch Coordination | 60% | **85%** | Promise.all/race patterns work |
| Trigger Scheduler | 80% | **85%** | Similar to existing Bull queue |
| Working Memory | 60% | **75%** | Need to test summarization integration |

**Overall Confidence: 75-80% → 85-90%**

---

## 6. Immediate Action Items

### High Priority (Do First)

1. **Fix `isFromMe` Property Access**
   - Check `BlueBubblesMessage` type definition
   - Verify webhook payload structure
   - May just need `bbMessage.isFromMe` instead of `bbMessage.is_from_me`

2. **Improve Tool Descriptions**
   - Current tools have minimal descriptions
   - Add 3-4 sentences per tool per Anthropic best practices

### Medium Priority

3. **Create ReminderTool with Detailed Schema**
   ```typescript
   {
     name: 'create_reminder',
     description: 'Create a reminder that will notify the user at a specific time. Use this when the user asks to be reminded about something, wants to set an alarm, or needs a future notification. The reminder will be sent via iMessage at the specified time. Do NOT use this for immediate actions - only for future notifications.',
     input_schema: {
       type: 'object',
       properties: {
         content: { 
           type: 'string', 
           description: 'The reminder message to send to the user. Should be clear and actionable.' 
         },
         remind_at: { 
           type: 'string', 
           description: 'When to send the reminder. Accepts ISO 8601 datetime (e.g., "2024-12-21T15:00:00") or natural language (e.g., "tomorrow at 3pm", "in 2 hours").' 
         }
       },
       required: ['content', 'remind_at']
     }
   }
   ```

4. **Implement Interaction/Execution Agent Split**
   - Follow Anthropic orchestrator-workers pattern
   - Use Promise.all for parallel execution
   - Add timeout handling with Promise.race

---

## 7. Key Code References

### BlueBubbles Webhook Handler (Official Example)
```python
def handle_new_message(self, data):
    if not isinstance(data.get('data'), dict):
        return
    # Ignore messages that I sent
    if data.get('data').get('isFromMe'):
        return
    # Extract the chat guid and message text
    chats = data.get('data').get('chats', [])
    chat_guid = chats[0].get('guid')
    self.send_text(chat_guid, "Hello World!")
```

### LangChain Tool Error Handling
```typescript
const handleToolErrors = createMiddleware({
  name: "HandleToolErrors",
  wrapToolCall: async (request, handler) => {
    try {
      return await handler(request);
    } catch (error) {
      return new ToolMessage({
        content: `Tool error: ${error}`,
        tool_call_id: request.toolCall.id!,
      });
    }
  },
});
```

### Anthropic Tool Best Practice
> "The more context you can give Claude about your tools, the better it will be at deciding when and how to use them."

---

## 8. Risks Remaining

1. **BlueBubbles Webhook Reliability** - Issue #758 mentions "Webhook trigger doesn't work properly" (open issue)
2. **Message Ordering** - Issue #597 shows messages can arrive out of order
3. **macOS 16 Compatibility** - Issue #761 shows crashes on Tahoe (if upgrading)

---

## Conclusion

Research significantly increased confidence. The main blocker (echo detection) is likely a simple property name fix. The multi-agent architecture has well-documented patterns from Anthropic and LangChain that we can follow.

**Recommendation**: Proceed with Phase 1 implementation immediately.
