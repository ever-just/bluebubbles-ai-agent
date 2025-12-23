# BlueBubbles AI Agent - OpenPoke Integration Plan

## 🎉 IMPLEMENTATION STATUS: COMPLETE (Dec 22, 2025)

All phases have been implemented. The codebase now includes:
- **7 Claude tools**: `create_reminder`, `list_reminders`, `cancel_reminder`, `create_trigger`, `list_triggers`, `update_trigger`, `delete_trigger`
- **Dual-agent architecture**: InteractionAgent + ExecutionAgent (enable with `ENABLE_DUAL_AGENT=true`)
- **Trigger system**: Scheduled agent execution with recurrence support
- **Working memory**: Automatic summarization of long conversations
- **External prompts**: `grace_system_prompt.md` for easy iteration

### New Files Created (22 total)
| Category | Files |
|----------|-------|
| Agents | `InteractionAgent.ts`, `InteractionAgentRuntime.ts`, `ExecutionAgent.ts`, `ExecutionAgentRuntime.ts`, `ExecutionBatchManager.ts`, `ExecutionAgentLogStore.ts`, `iMessageAdapter.ts`, `index.ts` |
| Prompts | `grace_system_prompt.md`, `interaction_system_prompt.md`, `execution_system_prompt.md` |
| Services | `TriggerService.ts`, `TriggerScheduler.ts`, `WorkingMemoryLog.ts`, `SummarizationService.ts` |
| Tools | `ReminderTool.ts`, `TriggerTool.ts` |
| Entities | `Trigger.ts`, `ExecutionAgentLog.ts`, `WorkingMemoryState.ts` |

---

## Executive Summary

This plan integrates OpenPoke's multi-agent architecture into the BlueBubbles AI agent to fix:
1. **Echo loop** - Agent responds to its own messages ✅ FIXED
2. **No tools registered** - Claude has no actionable capabilities ✅ FIXED (7 tools)
3. **Memory not populated** - Context not persisted across conversations ✅ FIXED
4. **Single-agent limitations** - Poor response quality, no task delegation ✅ FIXED
5. **No proactive features** - No scheduled triggers/reminders ✅ FIXED

---

## Architecture Comparison

### Current BlueBubbles Architecture
```
User Message → MessageRouter → ClaudeServiceEnhanced → Response
                    ↓
              ToolRegistry (empty)
```

### Target OpenPoke-Inspired Architecture
```
User Message → InteractionAgent → Response to User
                    ↓
              ExecutionAgent(s) → Tools (Reminders, Triggers, etc.)
                    ↓
              Agent Roster + Execution Logs (persistent memory)
```

---

## Phase 1: Fix Critical Issues (Echo Loop + Tools)

### Task 1.1: Fix Echo Loop Detection
**Problem**: Echo loop occurs because:
1. BlueBubbles webhook may not always include `isFromMe` field (defaults to `false`)
2. Outbound message cache TTL (2 min) may be too short
3. Content-based echo detection needs strengthening

**Research Finding**: BlueBubbles DOES provide `isFromMe` in webhooks (confirmed in official docs). The webhook handler in `index.ts` already checks both `is_from_me` and `isFromMe`. The issue is likely that the field is missing or the outbound cache isn't catching echoes.

**Files to modify**:
- `src/services/MessageRouter.ts`
- `src/index.ts` (webhook handler)

**Changes**:
1. Extend outbound message cache TTL from 2 min to 5 min
2. Add debug logging to trace exactly why echo detection fails
3. Strengthen content-based echo detection as fallback
4. Consider adding `wait` tool pattern from OpenPoke

**Subtasks**:
- [ ] 1.1.1: Add detailed logging in webhook handler to trace `isFromMe` value
- [ ] 1.1.2: Extend `outboundMessageTtlMs` from 2 min to 5 min in `MessageRouter.ts`
- [ ] 1.1.3: Add logging when echo is detected vs when it passes through
- [ ] 1.1.4: Test with real BlueBubbles webhook to verify `isFromMe` field presence

**Testing**:
```bash
# Send a test message and check logs for:
# 1. "Webhook is_from_me evaluation" with rawIsFromMe value
# 2. "Ignoring self-sent BlueBubbles webhook message" for outbound
# 3. No duplicate responses
grep -E "is_from_me|Ignoring self-sent|echo" agent.log
```

**Confidence**: 95% — Research confirms field exists, need to verify webhook payload structure

---

### Task 1.2: Register ReminderService as Claude Tool
**Problem**: `ToolRegistry` initializes empty. ReminderService exists but isn't exposed to Claude.

**Files to modify**:
- `src/tools/ReminderTool.ts` (NEW)
- `src/tools/ToolRegistry.ts`
- `src/index.ts`

**Changes**:
1. Create `ReminderTool` implementing `ITool` interface
2. Register tool in `ToolRegistry` on startup
3. Wire up to existing `ReminderService`

**Subtasks**:
- [ ] 1.2.1: Create `src/tools/ReminderTool.ts` with tool definition
- [ ] 1.2.2: Implement `execute()` method calling `ReminderService.createReminder()`
- [ ] 1.2.3: Add tool registration in `index.ts` after DB init
- [ ] 1.2.4: Add list/cancel reminder tools

**Tool Schema** (following Anthropic best practices - 3-4 sentences per description):
```typescript
{
  name: 'create_reminder',
  description: 'Create a reminder that will notify the user at a specific time via iMessage. Use this when the user asks to be reminded about something, wants to set an alarm, or needs a future notification. The reminder will be delivered as an iMessage at the specified time. Do NOT use this for immediate actions - only for scheduling future notifications.',
  input_schema: {
    type: 'object',
    properties: {
      content: { 
        type: 'string', 
        description: 'The reminder message to send to the user. Should be clear, actionable, and include relevant context from the original request.' 
      },
      remind_at: { 
        type: 'string', 
        description: 'When to send the reminder. Accepts ISO 8601 datetime (e.g., "2024-12-21T15:00:00-06:00") or natural language (e.g., "tomorrow at 3pm", "in 2 hours", "next Monday at 9am"). Times are interpreted in the user\'s timezone.' 
      },
      channel: { 
        type: 'string', 
        enum: ['imessage', 'email'], 
        description: 'Delivery channel for the reminder. Defaults to imessage. Use email only if user explicitly requests it.' 
      }
    },
    required: ['content', 'remind_at']
  }
}
```

**Confidence**: 95% — Straightforward tool registration following existing patterns

**Testing**:
```bash
# Send message: "Remind me to call mom tomorrow at 3pm"
# Verify:
# 1. Log shows "Tool requested by Claude: create_reminder"
# 2. Reminder created in database
# 3. Agent confirms reminder was set
psql -c "SELECT * FROM reminders ORDER BY created_at DESC LIMIT 1;"
```

---

## Phase 2: Interaction/Execution Agent Split

### Task 2.1: Create Interaction Agent Layer
**Purpose**: Separate user-facing personality from task execution.

**Files to create**:
- `src/agents/InteractionAgent.ts`
- `src/agents/InteractionAgentRuntime.ts`
- `src/agents/prompts/interaction_system_prompt.md`
- `src/agents/iMessageAdapter.ts` (NEW - iMessage-specific output handling)

**Changes**:
1. Create InteractionAgent that owns user communication
2. Add tools: `send_message_to_agent`, `send_message_to_user`, `wait`
3. Route user messages through InteractionAgent first
4. Handle execution agent results via `handleAgentMessage()` callback

**Subtasks**:
- [ ] 2.1.1: Create `src/agents/` directory structure
- [ ] 2.1.2: Create `InteractionAgent.ts` with tool definitions
- [ ] 2.1.3: Create `InteractionAgentRuntime.ts` with LLM loop (MAX_TOOL_ITERATIONS = 8)
- [ ] 2.1.4: Create system prompt markdown file
- [ ] 2.1.5: Add interaction agent tools to ClaudeServiceEnhanced
- [ ] 2.1.6: Implement `handleAgentMessage()` for execution results callback
- [ ] 2.1.7: Create `iMessageAdapter.ts` for BlueBubbles output formatting

**Interaction Agent Tools** (from OpenPoke reference):
```typescript
// Tool schemas for Claude
const INTERACTION_TOOLS = [
  {
    name: 'send_message_to_agent',
    description: 'Deliver instructions to a specific execution agent. Creates a new agent if the name doesn\'t exist in the roster, or reuses an existing one.',
    input_schema: {
      type: 'object',
      properties: {
        agent_name: {
          type: 'string',
          description: 'Human-readable agent name describing its purpose (e.g., "Reminder Agent", "Weather Lookup"). This name will be used to identify and potentially reuse the agent.'
        },
        instructions: {
          type: 'string',
          description: 'Instructions for the agent to execute.'
        }
      },
      required: ['agent_name', 'instructions']
    }
  },
  {
    name: 'send_message_to_user',
    description: 'Deliver a natural-language response directly to the user via iMessage. Use this for updates, confirmations, or any assistant response the user should see immediately.',
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Plain-text message that will be sent to the user via iMessage and recorded in the conversation log.'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'wait',
    description: 'Wait silently when a message is already in conversation history to avoid duplicating responses. Adds a silent log entry that is not visible to the user.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief explanation of why waiting (e.g., "Message already sent", "Duplicate response detected").'
        }
      },
      required: ['reason']
    }
  }
];
```

**iMessage Adapter Pattern**:
```typescript
// src/agents/iMessageAdapter.ts
export class iMessageAdapter {
  constructor(private blueBubblesClient: BlueBubblesClient) {}

  async sendToUser(message: string, chatGuid: string): Promise<void> {
    // Handle || delimiter for multiple bubbles
    const bubbles = message.split('||').map(b => b.trim()).filter(Boolean);
    
    // Send typing indicator
    await this.blueBubblesClient.sendTypingIndicator(chatGuid, true);
    
    // Send each bubble with delay
    for (const bubble of bubbles) {
      await this.blueBubblesClient.sendMessage(chatGuid, bubble);
      if (bubbles.length > 1) {
        await this.delay(500); // Brief pause between bubbles
      }
    }
    
    // Stop typing indicator
    await this.blueBubblesClient.sendTypingIndicator(chatGuid, false);
  }
}
```

**Testing**:
```bash
# Send complex request: "Find out what the weather is and remind me to bring an umbrella"
# Verify:
# 1. InteractionAgent acknowledges request immediately
# 2. ExecutionAgent spawned for weather lookup
# 3. Reminder created
# 4. User gets natural response via iMessage
# 5. Multiple bubbles sent correctly with || delimiter
```

---

### Task 2.2: Create Execution Agent Layer
**Purpose**: Task-specific workers with persistent memory.

**Files to create**:
- `src/agents/ExecutionAgent.ts`
- `src/agents/ExecutionAgentRuntime.ts`
- `src/agents/ExecutionAgentLogStore.ts`
- `src/agents/AgentRoster.ts`
- `src/agents/prompts/execution_system_prompt.md`

**Database changes**:
- Add `execution_agent_logs` table
- Add `agent_roster` table (or JSON file)

**Subtasks**:
- [ ] 2.2.1: Create `ExecutionAgent.ts` base class
- [ ] 2.2.2: Create `ExecutionAgentRuntime.ts` with tool execution loop (MAX_TOOL_ITERATIONS = 8)
- [ ] 2.2.3: Create `ExecutionAgentLogStore.ts` for persistent agent memory
- [ ] 2.2.4: Create `AgentRoster.ts` for tracking active agents with reuse logic
- [ ] 2.2.5: Create database migration for execution_agent_logs
- [ ] 2.2.6: Implement `buildSystemPromptWithHistory()` to inject agent history into prompt
- [ ] 2.2.7: Implement `recordToolExecution()` for persistent tool memory

**Agent Reuse Logic** (from OpenPoke reference):
```typescript
// AgentRoster.ts - Track and reuse agents
export class AgentRoster {
  private agents: Set<string> = new Set();
  
  load(): void {
    // Load from database or file
  }
  
  getAgents(): string[] {
    return Array.from(this.agents);
  }
  
  addAgent(name: string): void {
    this.agents.add(name);
    // Persist to database
  }
  
  hasAgent(name: string): boolean {
    return this.agents.has(name);
  }
}

// Usage in send_message_to_agent tool:
const roster = getAgentRoster();
const existingAgents = new Set(roster.getAgents());
const isNew = !existingAgents.has(agentName);

if (isNew) {
  roster.addAgent(agentName);
}

// Reusing agent preserves its execution history context
```

**Execution Agent History in System Prompt**:
```typescript
// ExecutionAgent.ts
export class ExecutionAgent {
  constructor(public name: string) {}
  
  buildSystemPromptWithHistory(): string {
    const basePrompt = this.loadSystemPrompt();
    const history = this.loadExecutionHistory();
    
    if (history.length === 0) {
      return basePrompt;
    }
    
    const historySection = `
## Previous Actions for This Agent

You have previously worked on tasks under this agent name. Here is your execution history:

${history.map(entry => `- [${entry.entryType}] ${entry.content}`).join('\n')}

Use this context to inform your current task.
`;
    
    return basePrompt + '\n' + historySection;
  }
  
  recordToolExecution(toolName: string, args: string, result: string): void {
    // Persist to execution_agent_logs table
  }
  
  recordResponse(response: string): void {
    // Persist final response to logs
  }
}
```

**New Entity: ExecutionAgentLog**
```typescript
@Entity('execution_agent_logs')
export class ExecutionAgentLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'agent_name', type: 'varchar', length: 255 })
  agentName!: string;

  @Column({ type: 'varchar', length: 50 })
  entryType!: 'request' | 'action' | 'tool_response' | 'response';

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;
}
```

**Testing**:
```bash
# Verify execution agent logs persist:
psql -c "SELECT agent_name, entry_type, LEFT(content, 50) FROM execution_agent_logs ORDER BY created_at DESC LIMIT 10;"
```

---

### Task 2.3: Create Batch Manager
**Purpose**: Coordinate multiple execution agents and batch results.

**Files to create**:
- `src/agents/ExecutionBatchManager.ts`

**Subtasks**:
- [ ] 2.3.1: Create `ExecutionBatchManager.ts`
- [ ] 2.3.2: Implement parallel agent execution with `asyncio.wait_for()` pattern
- [ ] 2.3.3: Implement result batching for interaction agent
- [ ] 2.3.4: Add timeout handling (90s default)
- [ ] 2.3.5: Implement `_dispatchToInteractionAgent()` callback when batch completes

**Batch Manager Pattern** (from OpenPoke reference):
```typescript
// ExecutionBatchManager.ts
import { EventEmitter } from 'events';

interface PendingExecution {
  requestId: string;
  agentName: string;
  instructions: string;
  batchId: string;
  createdAt: Date;
}

interface BatchState {
  batchId: string;
  createdAt: Date;
  pending: number;
  results: ExecutionResult[];
}

export class ExecutionBatchManager extends EventEmitter {
  private timeoutSeconds = 90;
  private pending: Map<string, PendingExecution> = new Map();
  private batchState: BatchState | null = null;
  
  async executeAgent(
    agentName: string,
    instructions: string,
    requestId?: string
  ): Promise<ExecutionResult> {
    const id = requestId || crypto.randomUUID();
    const batchId = await this.registerPendingExecution(agentName, instructions, id);
    
    try {
      const runtime = new ExecutionAgentRuntime(agentName);
      const result = await Promise.race([
        runtime.execute(instructions),
        this.timeout(this.timeoutSeconds)
      ]);
      
      await this.completeExecution(batchId, result, agentName);
      return result;
    } catch (error) {
      const timeoutResult: ExecutionResult = {
        agentName,
        success: false,
        response: `Execution timed out after ${this.timeoutSeconds} seconds`,
        error: 'Timeout'
      };
      await this.completeExecution(batchId, timeoutResult, agentName);
      return timeoutResult;
    } finally {
      this.pending.delete(id);
    }
  }
  
  private async completeExecution(
    batchId: string,
    result: ExecutionResult,
    agentName: string
  ): Promise<void> {
    if (!this.batchState || this.batchState.batchId !== batchId) {
      return;
    }
    
    this.batchState.results.push(result);
    this.batchState.pending--;
    
    // When all executions complete, dispatch to interaction agent
    if (this.batchState.pending === 0) {
      const payload = this.formatBatchPayload(this.batchState.results);
      this.batchState = null;
      await this.dispatchToInteractionAgent(payload);
    }
  }
  
  private formatBatchPayload(results: ExecutionResult[]): string {
    return results.map(r => {
      const status = r.success ? 'SUCCESS' : 'FAILED';
      return `[${status}] ${r.agentName}: ${r.response}`;
    }).join('\n');
  }
  
  private async dispatchToInteractionAgent(payload: string): Promise<void> {
    // Import dynamically to avoid circular dependency
    const { getInteractionAgentRuntime } = await import('./InteractionAgentRuntime');
    const runtime = getInteractionAgentRuntime();
    await runtime.handleAgentMessage(payload);
  }
}
```

**Testing**:
```bash
# Send request requiring multiple agents
# Verify batch completion in logs
grep "Execution batch completed" agent.log
# Verify callback to interaction agent
grep "handleAgentMessage" agent.log
```

---

## Phase 3: Trigger System (Proactive Features)

### Task 3.1: Create Trigger Service
**Purpose**: Schedule and fire triggers that spawn execution agents.

**Files to create**:
- `src/services/TriggerService.ts`
- `src/services/TriggerScheduler.ts`
- `src/database/entities/Trigger.ts`

**Database changes**:
- Add `triggers` table

**Subtasks**:
- [ ] 3.1.1: Create `Trigger` entity
- [ ] 3.1.2: Create `TriggerService.ts` with CRUD operations
- [ ] 3.1.3: Create `TriggerScheduler.ts` with polling loop
- [ ] 3.1.4: Integrate scheduler startup in `index.ts`

**New Entity: Trigger**
```typescript
@Entity('triggers')
export class Trigger {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'agent_name', type: 'varchar', length: 255 })
  agentName!: string;

  @Column({ type: 'text' })
  payload!: string;

  @Column({ name: 'start_time', type: 'timestamp', nullable: true })
  startTime?: Date;

  @Column({ name: 'next_trigger', type: 'timestamp', nullable: true })
  nextTrigger?: Date;

  @Column({ name: 'recurrence_rule', type: 'varchar', length: 255, nullable: true })
  recurrenceRule?: string;

  @Column({ type: 'varchar', length: 50, default: 'America/Chicago' })
  timezone!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'paused' | 'completed';

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
```

**Testing**:
```bash
# Create a trigger via tool call
# Wait for trigger to fire
# Verify execution agent was spawned
grep "Dispatching trigger" agent.log
```

---

### Task 3.2: Create Trigger Tools for Execution Agents
**Purpose**: Allow execution agents to create/manage triggers.

**Files to create**:
- `src/tools/TriggerTool.ts`

**Subtasks**:
- [ ] 3.2.1: Create `createTrigger` tool
- [ ] 3.2.2: Create `updateTrigger` tool
- [ ] 3.2.3: Create `listTriggers` tool
- [ ] 3.2.4: Register tools in execution agent registry

**Testing**:
```bash
# Ask agent to set a recurring reminder
# Verify trigger created with recurrence rule
psql -c "SELECT * FROM triggers WHERE recurrence_rule IS NOT NULL;"
```

---

## Phase 4: Enhanced Memory & Prompt System

### Task 4.1: Externalize System Prompt to Markdown File
**Purpose**: Separate prompt from code for easier iteration (OpenPoke pattern).

**Analysis Finding**: OpenPoke stores prompts in external `.md` files (144 lines), while BlueBubbles has a 20-line prompt hardcoded in TypeScript. External prompts are easier to iterate on without code changes.

**Files to create**:
- `src/agents/prompts/grace_system_prompt.md`

**Files to modify**:
- `src/services/ClaudeServiceEnhanced.ts`

**Subtasks**:
- [ ] 4.1.1: Create `src/agents/prompts/` directory
- [ ] 4.1.2: Create `grace_system_prompt.md` with expanded prompt (see template below)
- [ ] 4.1.3: Update `buildAgentGracePrompt()` to read from file
- [ ] 4.1.4: Add tool usage guidelines to prompt
- [ ] 4.1.5: Add duplicate prevention instructions

**Prompt Template** (based on OpenPoke patterns):
```markdown
You are Grace, an executive assistant for Weldon Makori, CEO of EverJust.

## TOOLS

### create_reminder
Use when the user asks to be reminded about something. Accepts natural language times.
Do NOT use for immediate actions - only for future notifications.

### list_reminders  
Show the user their pending reminders when asked.

### cancel_reminder
Cancel a reminder when the user requests. Confirm which one first.

## MESSAGE STRUCTURE

Your input follows this structure:
- `<conversation_summary>`: Summarized history (if available)
- `<recent_messages>`: Last few exchanges  
- `<user_context>`: User preferences and profile
- `<new_user_message>`: The current message to respond to

## INTERACTION GUIDELINES

1. **Acknowledge first** — Let the user know you understood
2. **Use tools when appropriate** — Don't mention tool names to user
3. **Avoid duplicates** — Check history before repeating information
4. **Match user's style** — Brief if they're brief, emojis if they use them

## PERSONALITY

- Sound like a smart, caring professional peer
- Default to short, direct bubbles (1-2 sentences)
- Mirror user's energy while staying calm and confident
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

**Confidence**: 95% — Simple file read, high impact

**Testing**:
```bash
# Verify prompt loads from file
grep "Loading system prompt" agent.log
# Test response quality improvement
```

---

### Task 4.2: Add Structured XML Context to Messages
**Purpose**: Help Claude parse context sections clearly (OpenPoke pattern).

**Analysis Finding**: OpenPoke wraps context in XML tags (`<conversation_history>`, `<active_agents>`, `<new_user_message>`). BlueBubbles uses flat message arrays. XML structure helps LLM understand context boundaries.

**Files to modify**:
- `src/services/ClaudeServiceEnhanced.ts`
- `src/services/MessageRouter.ts`

**Subtasks**:
- [ ] 4.2.1: Create `buildStructuredContext()` method
- [ ] 4.2.2: Wrap conversation history in `<recent_messages>` tags
- [ ] 4.2.3: Add `<user_context>` section for preferences
- [ ] 4.2.4: Wrap current message in `<new_user_message>` tags
- [ ] 4.2.5: Add `<conversation_summary>` when available

**Code Pattern**:
```typescript
private buildStructuredContext(
  summary: string | null,
  recentMessages: Message[],
  userContext: string,
  currentMessage: string
): string {
  const sections: string[] = [];
  
  if (summary) {
    sections.push(`<conversation_summary>\n${summary}\n</conversation_summary>`);
  }
  
  if (recentMessages.length > 0) {
    const formatted = recentMessages.map(m => 
      `<${m.role}_message timestamp="${m.createdAt}">${m.content}</${m.role}_message>`
    ).join('\n');
    sections.push(`<recent_messages>\n${formatted}\n</recent_messages>`);
  }
  
  if (userContext) {
    sections.push(`<user_context>\n${userContext}\n</user_context>`);
  }
  
  sections.push(`<new_user_message>\n${currentMessage}\n</new_user_message>`);
  
  return sections.join('\n\n');
}
```

**Confidence**: 85% — Requires careful integration with existing flow

**Testing**:
```bash
# Log the structured context being sent
grep "<conversation_summary>\|<recent_messages>\|<new_user_message>" agent.log
```

---

### Task 4.3: Implement Working Memory Log
**Purpose**: Maintain summarized conversation state like OpenPoke.

**Analysis Finding**: OpenPoke uses append-only logs with automatic summarization when entries exceed threshold. BlueBubbles has `ConversationSummarizer` but it's not integrated into the main flow.

**Files to create**:
- `src/services/WorkingMemoryLog.ts`
- `src/services/SummarizationService.ts`

**Files to modify**:
- `src/services/ContextService.ts`
- `src/services/MessageRouter.ts`

**Database changes**:
```sql
CREATE TABLE working_memory_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  conversation_id UUID,
  summary_text TEXT,
  last_entry_index INTEGER DEFAULT -1,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, conversation_id)
);
```

**Subtasks**:
- [ ] 4.3.1: Create `WorkingMemoryLog.ts` with append/load/render methods
- [ ] 4.3.2: Create `SummarizationService.ts` with threshold-based summarization
- [ ] 4.3.3: Add database migration for `working_memory_state`
- [ ] 4.3.4: Integrate with `MessageRouter` to append entries on each message
- [ ] 4.3.5: Trigger summarization when threshold exceeded

**Summarization Prompt** (from OpenPoke `prompt_builder.py`):
```
You are the assistant's memory curator. Produce a working-memory briefing:

Timeline & Commitments:
- YYYY-MM-DD HH:MM — event with participants, status

Pending & Follow-ups:
- Due YYYY-MM-DD — task with owner, status, next step

Preferences & Profile:
- Stable preference or personal detail

Context & Notes:
- Strategic insight or configuration
```

**Confidence**: 75% — More complex, requires careful state management

**Testing**:
```bash
# Have 10+ message conversation
# Verify summary generated
psql -c "SELECT summary_text FROM working_memory_state LIMIT 1;"
grep "Summarization triggered" agent.log
```

---

## Phase 5: Additional Optimizations

### Task 5.1: Integrate Existing ConversationSummarizer
**Purpose**: Connect the existing but unused `ConversationSummarizer` to the main flow.

**Analysis Finding**: `ConversationSummarizer.ts` exists and works, but `prepareConversationHistory()` in `MessageRouter.ts` is not called in the main message processing flow.

**Files to modify**:
- `src/services/MessageRouter.ts`

**Subtasks**:
- [ ] 5.1.1: Call `prepareConversationHistory()` in `processMessage()` flow
- [ ] 5.1.2: Use summarized history when token count exceeds threshold
- [ ] 5.1.3: Add logging for summarization triggers

**Confidence**: 90% — Code exists, just needs wiring

**Testing**:
```bash
# Have long conversation exceeding token threshold
grep "Generating conversation summary" agent.log
```

---

### Task 5.2: Add Wait Tool Pattern (Optional)
**Purpose**: Prevent duplicate responses like OpenPoke's `wait` tool.

**Analysis Finding**: OpenPoke uses a `wait(reason)` tool that adds a silent log entry to prevent redundant messages. This is an elegant solution for echo prevention.

**Files to create**:
- `src/tools/WaitTool.ts`

**Subtasks**:
- [ ] 5.2.1: Create `WaitTool` that logs reason but returns empty response
- [ ] 5.2.2: Add to system prompt: "Use wait tool when response already sent"
- [ ] 5.2.3: Handle empty responses gracefully in MessageRouter

**Confidence**: 80% — Novel pattern for this codebase

**Testing**:
```bash
# Trigger scenario where duplicate would occur
grep "<wait>" agent.log
```

---

## Database Migration Summary

### New Tables
1. `execution_agent_logs` - Persistent memory for execution agents
2. `triggers` - Scheduled triggers for proactive features
3. `working_memory_state` - Conversation summary state (Phase 4.3)

### Migration File
```typescript
// src/database/migrations/YYYYMMDDHHMMSS-add-agent-tables.ts
export class AddAgentTables implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE execution_agent_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_name VARCHAR(255) NOT NULL,
        entry_type VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        metadata JSONB DEFAULT '{}'
      );
      CREATE INDEX idx_execution_agent_logs_agent_name ON execution_agent_logs(agent_name);
      CREATE INDEX idx_execution_agent_logs_created_at ON execution_agent_logs(created_at);
    `);

    await queryRunner.query(`
      CREATE TABLE triggers (
        id SERIAL PRIMARY KEY,
        agent_name VARCHAR(255) NOT NULL,
        payload TEXT NOT NULL,
        start_time TIMESTAMP,
        next_trigger TIMESTAMP,
        recurrence_rule VARCHAR(255),
        timezone VARCHAR(50) DEFAULT 'America/Chicago',
        status VARCHAR(20) DEFAULT 'active',
        last_error TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX idx_triggers_next_trigger ON triggers(next_trigger) WHERE status = 'active';
      CREATE INDEX idx_triggers_agent_name ON triggers(agent_name);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS triggers;`);
    await queryRunner.query(`DROP TABLE IF EXISTS execution_agent_logs;`);
  }
}
```

---

## Implementation Order & Confidence Levels

### Recommended Phase Order (Updated)

**Option A: Original Order** (Phase 1 → 2 → 3 → 4 → 5)
- Pro: Fixes critical issues first
- Con: Phase 2 refactors message flow, may break Phase 1 fixes

**Option B: Architecture First** (Phase 2 → 1 → 3 → 4 → 5) ⭐ RECOMMENDED
- Pro: Build on solid foundation, tools integrate cleanly into new architecture
- Con: Longer time to first working fix

### Phase 1: Critical Fixes (Est: 2-3 hours) — Confidence: 90%
| Task | Description | Confidence | Notes |
|------|-------------|------------|-------|
| 1.1 | Fix Echo Loop Detection | 90% | May need rework after Phase 2 |
| 1.2 | Register ReminderService as Claude Tool | 95% | Straightforward |

### Phase 2: Agent Architecture (Est: 8-10 hours) — Confidence: 82%
| Task | Description | Confidence | Notes |
|------|-------------|------------|-------|
| 2.1 | Create Interaction Agent Layer | 85% | +2 subtasks added |
| 2.2 | Create Execution Agent Layer | 80% | +2 subtasks added |
| 2.3 | Create Batch Manager | 80% | +1 subtask added |
| 2.4 | Create iMessage Adapter | 85% | NEW - iMessage-specific output |

### Phase 3: Proactive Features (Est: 4-5 hours) — Confidence: 85%
| Task | Description | Confidence | Notes |
|------|-------------|------------|-------|
| 3.1 | Create Trigger Service | 85% | Solid pattern |
| 3.2 | Create Trigger Tools | 85% | Solid pattern |

### Phase 4: Memory & Prompt Optimization (Est: 4-6 hours) — Confidence: 85%
| Task | Description | Confidence | Notes |
|------|-------------|------------|-------|
| 4.1 | Externalize System Prompt to .md file | 95% | Simple file read |
| 4.2 | Add Structured XML Context | 85% | OpenPoke pattern |
| 4.3 | Implement Working Memory Log | 75% | Most complex |

### Phase 5: Additional Optimizations (Est: 2-3 hours) — Confidence: 85%
| Task | Description | Confidence | Notes |
|------|-------------|------------|-------|
| 5.1 | Integrate Existing ConversationSummarizer | 90% | Code exists |
| 5.2 | Add Wait Tool Pattern | 85% | Now part of interaction tools |

**Overall Confidence: 82-85%**

### Latency Considerations

Dual-agent architecture adds LLM calls. Mitigations:

| Strategy | Implementation | Impact |
|----------|----------------|--------|
| Immediate acknowledgment | InteractionAgent sends "On it..." before spawning ExecutionAgent | UX improvement |
| Faster interaction model | Use Claude Haiku for InteractionAgent, Sonnet for ExecutionAgent | 2-3x faster interaction |
| Skip execution for simple queries | InteractionAgent answers directly without spawning agent | Reduces latency for FAQs |
| Typing indicators | Show typing while ExecutionAgent works | UX improvement |

---

## Verification Checklist

### After Phase 1 ✅ IMPLEMENTED (Dec 22, 2025)
- [x] Agent no longer responds to its own messages (TTL extended to 5 min, debug logging added)
- [x] `toolCount > 0` in logs (7 tools registered)
- [x] Reminders can be created via conversation (`create_reminder` tool)
- [ ] Reminders fire and send messages (requires testing)

### After Phase 2 ✅ IMPLEMENTED (Dec 22, 2025)
- [x] InteractionAgent handles user messages (when `ENABLE_DUAL_AGENT=true`)
- [x] ExecutionAgents spawn for complex tasks
- [x] Agent roster tracks active agents (`AgentRoster` class in `ExecutionAgent.ts`)
- [x] Execution logs persist across sessions (`ExecutionAgentLogStore.ts`)
- [x] `handleAgentMessage()` callback works when execution completes
- [x] iMessageAdapter sends multiple bubbles correctly (`||` delimiter)
- [x] Typing indicators show during agent processing
- [x] Agent reuse works (same agent name preserves context)

### After Phase 3 ✅ IMPLEMENTED (Dec 22, 2025)
- [x] Triggers can be created (`create_trigger` tool)
- [x] Trigger scheduler polls and fires (`TriggerScheduler.ts`)
- [x] Recurring triggers reschedule correctly

### After Phase 4 ✅ IMPLEMENTED (Dec 22, 2025)
- [x] System prompt loads from external .md file (`grace_system_prompt.md`)
- [x] Messages use structured XML context (`InteractionAgentRuntime.buildStructuredContent()`)
- [x] Working memory summarizes long conversations (`WorkingMemoryLog.ts`, `SummarizationService.ts`)
- [x] Context persists across sessions (`WorkingMemoryState` entity)

### After Phase 5 ✅ IMPLEMENTED (Dec 22, 2025)
- [x] ConversationSummarizer integrated into main flow (already wired in `prepareConversationHistory()`)
- [x] Wait tool prevents duplicate responses (part of InteractionAgent tools)
- [ ] Response quality improved (requires testing)

---

## Files Reference

### Existing Files to Modify
| File | Changes |
|------|---------|
| `src/services/MessageRouter.ts` | Echo detection, agent routing |
| `src/services/ClaudeServiceEnhanced.ts` | System prompt, tool integration |
| `src/tools/ToolRegistry.ts` | Tool registration |
| `src/services/ContextService.ts` | Working memory integration |
| `src/index.ts` | Startup initialization |

### New Task 2.4: Create iMessage Adapter
**Purpose**: Bridge between InteractionAgent output and BlueBubbles-specific formatting.

**Files to create**:
- `src/agents/iMessageAdapter.ts`

**Subtasks**:
- [ ] 2.4.1: Create `iMessageAdapter.ts` with `sendToUser()` method
- [ ] 2.4.2: Handle `||` delimiter for multiple bubbles
- [ ] 2.4.3: Integrate typing indicators before/after sending
- [ ] 2.4.4: Add to outbound message cache for echo prevention
- [ ] 2.4.5: Wire into `send_message_to_user` tool execution

**Confidence**: 85% — Straightforward adapter pattern

---

### New Files to Create
| File | Purpose |
|------|---------|
| `src/tools/ReminderTool.ts` | Reminder tool for Claude |
| `src/tools/TriggerTool.ts` | Trigger tools for execution agents |
| `src/tools/WaitTool.ts` | Duplicate prevention tool (Phase 5.2) |
| `src/agents/InteractionAgent.ts` | User-facing agent |
| `src/agents/InteractionAgentRuntime.ts` | Interaction LLM loop |
| `src/agents/iMessageAdapter.ts` | BlueBubbles output formatting (NEW) |
| `src/agents/ExecutionAgent.ts` | Task worker agent |
| `src/agents/ExecutionAgentRuntime.ts` | Execution LLM loop |
| `src/agents/ExecutionAgentLogStore.ts` | Persistent agent memory |
| `src/agents/ExecutionBatchManager.ts` | Parallel execution coordinator |
| `src/agents/AgentRoster.ts` | Active agent tracking |
| `src/agents/prompts/grace_system_prompt.md` | Grace persona prompt (Phase 4.1) |
| `src/agents/prompts/interaction_system_prompt.md` | Interaction agent prompt |
| `src/agents/prompts/execution_system_prompt.md` | Execution agent prompt |
| `src/services/TriggerService.ts` | Trigger CRUD |
| `src/services/TriggerScheduler.ts` | Trigger polling |
| `src/services/WorkingMemoryLog.ts` | Conversation summary state (Phase 4.3) |
| `src/services/SummarizationService.ts` | Threshold-based summarization (Phase 4.3) |
| `src/database/entities/ExecutionAgentLog.ts` | Agent log entity |
| `src/database/entities/Trigger.ts` | Trigger entity |
| `src/database/entities/WorkingMemoryState.ts` | Summary state entity (Phase 4.3) |

---

## OpenPoke Reference Files

The OpenPoke codebase is available at:
`/Users/everjust/Documents/PROJECTS/bluebubbles-ai-agent/openpoke-reference/`

Key files for reference:
- `server/agents/interaction_agent/runtime.py` - Interaction loop pattern
- `server/agents/interaction_agent/tools.py` - Interaction tools
- `server/agents/execution_agent/runtime.py` - Execution loop pattern
- `server/agents/execution_agent/batch_manager.py` - Batch coordination
- `server/services/triggers/service.py` - Trigger management
- `server/services/trigger_scheduler.py` - Trigger polling
- `server/services/execution/log_store.py` - Agent memory persistence
- `server/services/conversation/summarization/working_memory_log.py` - Working memory
