# Phase 4 Implementation Plan
## Optimized for Claude Opus in Windsurf

**Purpose**: This plan is structured for an AI assistant to execute systematically with explicit confirmation gates, verification tests, and rollback points.

---

# EXECUTION RULES

1. **Complete one task before moving to the next**
2. **Run verification test after each task**
3. **Mark confirmation checkbox only after test passes**
4. **If test fails, fix before proceeding**
5. **Update this document as you complete each step**

---

# PHASE 4.1: EXTERNALIZE SYSTEM PROMPT

## Estimated Time: 30-45 minutes

### Task 4.1.1: Create Prompt Directory and File
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Create directory `src/agents/prompts/`
2. [ ] Create file `src/agents/prompts/grace_system_prompt.md`
3. [ ] Copy current prompt from `ClaudeServiceEnhanced.buildAgentGracePrompt()` (lines 515-536)
4. [ ] Expand prompt with tool usage guidelines

**Verification**:
```bash
# Check file exists and has content
cat agent-service/src/agents/prompts/grace_system_prompt.md | head -20
```

**Confirmation**: ⬜ Directory and file created with content

---

### Task 4.1.2: Update ClaudeServiceEnhanced to Read External Prompt
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Add imports: `import { readFileSync } from 'fs'` and `import { join } from 'path'`
2. [ ] Add constant at top of file to load prompt:
   ```typescript
   const GRACE_PROMPT_PATH = join(__dirname, '../agents/prompts/grace_system_prompt.md');
   let GRACE_SYSTEM_PROMPT: string;
   try {
     GRACE_SYSTEM_PROMPT = readFileSync(GRACE_PROMPT_PATH, 'utf-8');
   } catch (error) {
     console.warn('Failed to load external prompt, using default');
     GRACE_SYSTEM_PROMPT = 'You are Grace, a helpful AI assistant...'; // fallback
   }
   ```
3. [ ] Update `buildAgentGracePrompt()` to return `GRACE_SYSTEM_PROMPT`
4. [ ] Remove hardcoded prompt string

**Verification**:
```bash
# Compile TypeScript
cd agent-service && npm run build

# Check for errors
echo $?
```

**Confirmation**: ⬜ Code compiles without errors

---

### Task 4.1.3: Update Build Script to Copy Prompts
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Open `agent-service/package.json`
2. [ ] Update build script:
   ```json
   "build": "tsc && cp -r src/agents/prompts dist/agents/"
   ```
3. [ ] Run build to verify copy works

**Verification**:
```bash
cd agent-service && npm run build
ls -la dist/agents/prompts/
```

**Confirmation**: ⬜ Prompt file exists in dist/agents/prompts/

---

### Task 4.1.4: Test Prompt Loading
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Start the service
2. [ ] Send a test message
3. [ ] Verify response uses new prompt (check logs or behavior)

**Verification**:
```bash
# Start service
cd agent-service && npm run dev

# In another terminal, send test message
curl -X POST http://localhost:3000/api/inject-message \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, who are you?", "phoneNumber": "+1234567890"}'
```

**Confirmation**: ⬜ Service responds correctly with externalized prompt

---

## PHASE 4.1 GATE

**All confirmations checked?**
- ⬜ Task 4.1.1 confirmed
- ⬜ Task 4.1.2 confirmed
- ⬜ Task 4.1.3 confirmed
- ⬜ Task 4.1.4 confirmed

**PHASE 4.1 COMPLETE**: ⬜

**Rollback if needed**: `git checkout -- agent-service/src/services/ClaudeServiceEnhanced.ts`

---

# PHASE 4.3: IMPLEMENT WORKING MEMORY LOG

## Estimated Time: 2-3 hours

> **Note**: Implementing 4.3 before 4.2 because XML context needs the summary from working memory.

### Task 4.3.1: Create WorkingMemoryState Entity
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Create file `src/database/entities/WorkingMemoryState.ts`
2. [ ] Define entity:
   ```typescript
   import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn, Index } from 'typeorm';

   @Entity('working_memory_state')
   @Index(['userId', 'conversationId'], { unique: true })
   export class WorkingMemoryState {
     @PrimaryGeneratedColumn('uuid')
     id!: string;

     @Column({ name: 'user_id', type: 'uuid' })
     userId!: string;

     @Column({ name: 'conversation_id', type: 'uuid' })
     conversationId!: string;

     @Column({ name: 'summary_text', type: 'text', default: '' })
     summaryText!: string;

     @Column({ name: 'last_summarized_message_id', type: 'uuid', nullable: true })
     lastSummarizedMessageId?: string;

     @Column({ name: 'unsummarized_count', type: 'integer', default: 0 })
     unsummarizedCount!: number;

     @UpdateDateColumn({ name: 'updated_at' })
     updatedAt!: Date;
   }
   ```
3. [ ] Export from `src/database/entities/index.ts` (if exists) or add to connection

**Verification**:
```bash
cd agent-service && npx tsc --noEmit
```

**Confirmation**: ⬜ Entity compiles without errors

---

### Task 4.3.2: Create Database Migration
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Generate migration:
   ```bash
   cd agent-service && npx typeorm migration:generate -d src/database/connection.ts src/database/migrations/AddWorkingMemoryState
   ```
2. [ ] Review generated migration file
3. [ ] Run migration:
   ```bash
   npx typeorm migration:run -d src/database/connection.ts
   ```

**Verification**:
```bash
# Check table exists in database
psql $DATABASE_URL -c "\d working_memory_state"
```

**Confirmation**: ⬜ Table created in database

---

### Task 4.3.3: Create SummarizationService
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Create file `src/services/SummarizationService.ts`
2. [ ] Implement service with:
   - Constructor: Initialize BullMQ queue (copy pattern from ReminderService)
   - `checkAndTriggerSummarization(conversationId, userId)`: Check threshold, queue job
   - `processSummarizationJob(conversationId, userId)`: Load messages, call summarizer, save state
   - `getSummary(conversationId)`: Return current summary text

**Key implementation details**:
```typescript
import Bull from 'bull';
import { Repository } from 'typeorm';
import { AppDataSource } from '../database/connection';
import { WorkingMemoryState } from '../database/entities/WorkingMemoryState';
import { Message } from '../database/entities/Message';
import { ConversationSummarizer } from './ConversationSummarizer';
import { config } from '../config';
import { logInfo, logError } from '../utils/logger';

const SUMMARIZATION_THRESHOLD = 10; // messages
const SUMMARY_TAIL_SIZE = 3; // keep last 3 unsummarized

export class SummarizationService {
  private stateRepo: Repository<WorkingMemoryState>;
  private messageRepo: Repository<Message>;
  private summarizer: ConversationSummarizer;
  private queue: Bull.Queue;

  constructor() {
    this.stateRepo = AppDataSource.getRepository(WorkingMemoryState);
    this.messageRepo = AppDataSource.getRepository(Message);
    this.summarizer = new ConversationSummarizer();
    
    this.queue = new Bull('summarization', {
      redis: {
        port: 6379,
        host: new URL(config.redis.url).hostname,
        password: new URL(config.redis.url).password
      }
    });
    
    this.setupProcessor();
  }

  private setupProcessor(): void {
    this.queue.process(async (job) => {
      const { conversationId, userId } = job.data;
      await this.processSummarizationJob(conversationId, userId);
    });
  }

  async checkAndTriggerSummarization(conversationId: string, userId: string): Promise<void> {
    // Get or create state
    let state = await this.stateRepo.findOne({ 
      where: { conversationId, userId } 
    });
    
    if (!state) {
      state = this.stateRepo.create({ conversationId, userId, unsummarizedCount: 0 });
    }
    
    state.unsummarizedCount++;
    await this.stateRepo.save(state);
    
    if (state.unsummarizedCount >= SUMMARIZATION_THRESHOLD) {
      // Queue job with deduplication
      await this.queue.add(
        { conversationId, userId },
        { 
          jobId: `summarize-${conversationId}`,
          delay: 1000,
          removeOnComplete: true
        }
      );
    }
  }

  async processSummarizationJob(conversationId: string, userId: string): Promise<void> {
    try {
      const state = await this.stateRepo.findOne({ 
        where: { conversationId, userId } 
      });
      
      if (!state) return;
      
      // Get messages to summarize (all except tail)
      const messages = await this.messageRepo.find({
        where: { conversationId },
        order: { createdAt: 'ASC' }
      });
      
      if (messages.length <= SUMMARY_TAIL_SIZE) return;
      
      const toSummarize = messages.slice(0, -SUMMARY_TAIL_SIZE);
      const lastMessage = toSummarize[toSummarize.length - 1];
      
      // Convert to summarizer format
      const turns = toSummarize.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.createdAt
      }));
      
      // Include existing summary for incremental summarization
      const existingSummary = state.summaryText || '';
      const newSummary = await this.summarizer.summarize(turns, existingSummary);
      
      // Update state
      state.summaryText = newSummary;
      state.lastSummarizedMessageId = lastMessage.id;
      state.unsummarizedCount = SUMMARY_TAIL_SIZE;
      await this.stateRepo.save(state);
      
      logInfo('Summarization completed', { conversationId, messageCount: toSummarize.length });
    } catch (error) {
      logError('Summarization failed', error);
      throw error; // Let BullMQ retry
    }
  }

  async getSummary(conversationId: string): Promise<string | null> {
    const state = await this.stateRepo.findOne({ 
      where: { conversationId } 
    });
    return state?.summaryText || null;
  }
}

// Singleton
let summarizationService: SummarizationService | null = null;

export function getSummarizationService(): SummarizationService {
  if (!summarizationService) {
    summarizationService = new SummarizationService();
  }
  return summarizationService;
}
```

**Verification**:
```bash
cd agent-service && npx tsc --noEmit
```

**Confirmation**: ⬜ Service compiles without errors

---

### Task 4.3.4: Update ConversationSummarizer for Incremental Summarization
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Open `src/services/ConversationSummarizer.ts`
2. [ ] Update `summarize()` method to accept optional existing summary
3. [ ] Update prompt to include existing summary context

**Verification**:
```bash
cd agent-service && npx tsc --noEmit
```

**Confirmation**: ⬜ Summarizer updated and compiles

---

### Task 4.3.5: Integrate with MessageRouter
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Import `getSummarizationService` in MessageRouter
2. [ ] After `saveMessage()` call (around line 823), add:
   ```typescript
   // Trigger summarization check
   const summarizationService = getSummarizationService();
   await summarizationService.checkAndTriggerSummarization(
     conversation.id,
     user.id
   );
   ```

**Verification**:
```bash
cd agent-service && npx tsc --noEmit
```

**Confirmation**: ⬜ Integration compiles without errors

---

### Task 4.3.6: Test Working Memory Flow
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Start the service
2. [ ] Send 12+ messages to trigger summarization
3. [ ] Check database for working_memory_state record
4. [ ] Verify summary_text is populated

**Verification**:
```bash
# Start service
cd agent-service && npm run dev

# Send multiple test messages (run 12+ times)
for i in {1..12}; do
  curl -X POST http://localhost:3000/api/inject-message \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"Test message $i\", \"phoneNumber\": \"+1234567890\"}"
  sleep 2
done

# Check database
psql $DATABASE_URL -c "SELECT conversation_id, unsummarized_count, length(summary_text) as summary_length FROM working_memory_state"
```

**Confirmation**: ⬜ Summary generated after threshold reached

---

## PHASE 4.3 GATE

**All confirmations checked?**
- ⬜ Task 4.3.1 confirmed
- ⬜ Task 4.3.2 confirmed
- ⬜ Task 4.3.3 confirmed
- ⬜ Task 4.3.4 confirmed
- ⬜ Task 4.3.5 confirmed
- ⬜ Task 4.3.6 confirmed

**PHASE 4.3 COMPLETE**: ⬜

**Rollback if needed**: 
```bash
git checkout -- agent-service/src/services/
npx typeorm migration:revert -d src/database/connection.ts
```

---

# PHASE 4.2: ADD STRUCTURED XML CONTEXT

## Estimated Time: 1-2 hours

### Task 4.2.1: Create XML Context Builder
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Create file `src/utils/xmlContextBuilder.ts`
2. [ ] Implement:
   ```typescript
   export function escapeXml(text: string): string {
     return text
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;');
   }

   export interface XmlContextOptions {
     summary?: string;
     recentMessages: Array<{ role: string; content: string }>;
     userContext?: string;
     newMessage: string;
     images?: any[];
   }

   export function buildXmlContext(options: XmlContextOptions): string {
     const parts: string[] = [];
     
     if (options.summary) {
       parts.push(`<conversation_summary>\n${escapeXml(options.summary)}\n</conversation_summary>`);
     }
     
     if (options.recentMessages.length > 0) {
       const recentParts = options.recentMessages.map(m => 
         `<${m.role}_message>${escapeXml(m.content)}</${m.role}_message>`
       );
       parts.push(`<recent_messages>\n${recentParts.join('\n')}\n</recent_messages>`);
     }
     
     if (options.userContext) {
       parts.push(`<user_context>\n${escapeXml(options.userContext)}\n</user_context>`);
     }
     
     parts.push(`<new_user_message>\n${escapeXml(options.newMessage)}\n</new_user_message>`);
     
     return parts.join('\n\n');
   }
   ```

**Verification**:
```bash
cd agent-service && npx tsc --noEmit
```

**Confirmation**: ⬜ XML builder compiles

---

### Task 4.2.2: Update ClaudeServiceEnhanced.buildMessages()
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Import `buildXmlContext` and `getSummarizationService`
2. [ ] Update `buildMessages()` signature to accept summary parameter
3. [ ] Refactor to build structured XML context instead of flat messages
4. [ ] Keep image handling for multi-modal content

**Key changes**:
```typescript
private async buildMessages(
  processedMessages: ProcessedMessage[],
  conversationHistory: Array<{role: string; content: string}>,
  conversationId?: string
): Promise<any[]> {
  // Get summary if available
  let summary: string | undefined;
  if (conversationId) {
    const summarizationService = getSummarizationService();
    summary = await summarizationService.getSummary(conversationId) || undefined;
  }
  
  // Get recent messages (last 5)
  const recentMessages = conversationHistory.slice(-5);
  
  // Get new message text
  const newMessageText = processedMessages[0]?.text || '';
  
  // Build structured context
  const xmlContext = buildXmlContext({
    summary,
    recentMessages,
    newMessage: newMessageText
  });
  
  // Handle images
  const content: any[] = [];
  
  // Add images first if present
  const images = processedMessages[0]?.images;
  if (images && images.length > 0) {
    for (const image of images) {
      content.push({
        type: 'image',
        source: {
          type: image.type,
          media_type: image.mediaType,
          [image.type === 'base64' ? 'data' : 'url']: image.data
        }
      });
    }
  }
  
  // Add XML context as text
  content.push({ type: 'text', text: xmlContext });
  
  return [{
    role: 'user',
    content: content.length === 1 ? content[0].text : content
  }];
}
```

**Verification**:
```bash
cd agent-service && npx tsc --noEmit
```

**Confirmation**: ⬜ Updated buildMessages compiles

---

### Task 4.2.3: Update sendMessage() to Pass conversationId
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Update `sendMessage()` signature to accept `conversationId`
2. [ ] Pass `conversationId` to `buildMessages()`
3. [ ] Update all callers in MessageRouter

**Verification**:
```bash
cd agent-service && npx tsc --noEmit
```

**Confirmation**: ⬜ All callers updated and compile

---

### Task 4.2.4: Test XML Context Flow
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Start the service with debug logging
2. [ ] Send a test message
3. [ ] Verify XML structure in logs or by inspecting request

**Verification**:
```bash
# Start service with debug logging
LOG_LEVEL=debug npm run dev

# Send test message
curl -X POST http://localhost:3000/api/inject-message \
  -H "Content-Type: application/json" \
  -d '{"text": "What did we talk about earlier?", "phoneNumber": "+1234567890"}'

# Check logs for XML structure
```

**Confirmation**: ⬜ XML context appears in Claude request

---

### Task 4.2.5: Test with Images
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Send a message with an image attachment
2. [ ] Verify image is included in content blocks
3. [ ] Verify XML text follows image

**Verification**: Manual test with image attachment

**Confirmation**: ⬜ Images work with XML context

---

## PHASE 4.2 GATE

**All confirmations checked?**
- ⬜ Task 4.2.1 confirmed
- ⬜ Task 4.2.2 confirmed
- ⬜ Task 4.2.3 confirmed
- ⬜ Task 4.2.4 confirmed
- ⬜ Task 4.2.5 confirmed

**PHASE 4.2 COMPLETE**: ⬜

**Rollback if needed**: `git checkout -- agent-service/src/services/ClaudeServiceEnhanced.ts`

---

# FINAL PHASE 4 GATE

## All Phases Complete?
- ⬜ Phase 4.1 (Externalize Prompt) COMPLETE
- ⬜ Phase 4.3 (Working Memory) COMPLETE
- ⬜ Phase 4.2 (XML Context) COMPLETE

## Integration Test
**Status**: ⬜ Not Started

**Steps**:
1. [ ] Start fresh service
2. [ ] Have a 15+ message conversation
3. [ ] Verify:
   - [ ] External prompt is loaded
   - [ ] Summary is generated after threshold
   - [ ] XML context includes summary
   - [ ] Claude responses are contextually aware

**Verification**:
```bash
# Full integration test
cd agent-service && npm run dev

# Send 15 messages
for i in {1..15}; do
  curl -X POST http://localhost:3000/api/inject-message \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"Message $i: Tell me something interesting about the number $i\", \"phoneNumber\": \"+1234567890\"}"
  sleep 3
done

# Ask about earlier conversation
curl -X POST http://localhost:3000/api/inject-message \
  -H "Content-Type: application/json" \
  -d '{"text": "What numbers did we discuss earlier?", "phoneNumber": "+1234567890"}'
```

**Confirmation**: ⬜ Full integration test passes

---

## PHASE 4 COMPLETE: ⬜

**Commit message**:
```
feat(phase4): Add working memory, XML context, and external prompts

- Externalize system prompt to markdown file
- Implement working memory log with background summarization
- Add structured XML context for Claude messages
- Integrate summarization with message flow
```

---

# APPENDIX: QUICK REFERENCE

## File Locations
- Prompt: `src/agents/prompts/grace_system_prompt.md`
- Entity: `src/database/entities/WorkingMemoryState.ts`
- Service: `src/services/SummarizationService.ts`
- XML Builder: `src/utils/xmlContextBuilder.ts`

## Config Values
- `SUMMARIZATION_THRESHOLD = 10` (messages)
- `SUMMARY_TAIL_SIZE = 3` (keep unsummarized)
- Token budgets: Summary 500, Recent 1000, Context 200

## Commands
```bash
# Build
npm run build

# Type check only
npx tsc --noEmit

# Run migrations
npx typeorm migration:run -d src/database/connection.ts

# Start dev
npm run dev

# Test message
curl -X POST http://localhost:3000/api/inject-message \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello", "phoneNumber": "+1234567890"}'
```
