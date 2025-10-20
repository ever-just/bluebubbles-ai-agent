# Context Persistence Strategy

## Overview
Managing conversation context across multiple channels (iMessage and email) while maintaining coherent AI responses and user experience.

## Key Challenges

### 1. Cross-Channel Identity
- Linking phone numbers to email addresses
- Maintaining unified user profiles
- Handling multiple devices per user

### 2. Context Synchronization
- Real-time sync between channels
- Handling concurrent conversations
- Conflict resolution

### 3. Memory Management
- Token limit optimization
- Relevant context selection
- Long-term memory vs working memory

### 4. Data Consistency
- Transaction management
- Cache invalidation
- Eventual consistency handling

## Context Architecture

### Three-Layer Memory Model

#### 1. Working Memory (Short-term)
```typescript
interface WorkingMemory {
  currentConversation: Message[];
  activeChannel: ChannelType;
  lastInteraction: Date;
  pendingTasks: Task[];
  tempVariables: Map<string, any>;
}

// Stored in Redis with TTL
// Fast access for active conversations
// Limited to recent messages (last 20-30)
// Expires after 1 hour of inactivity
```

#### 2. Session Memory (Medium-term)
```typescript
interface SessionMemory {
  userId: string;
  conversations: {
    [channel: string]: Message[];
  };
  userPreferences: Preferences;
  recentTopics: string[];
  contextSummary: string;
  reminders: Reminder[];
}

// Stored in PostgreSQL
// Persists across sessions
// Contains last 7 days of conversations
// Summarized older conversations
```

#### 3. Long-term Memory (Persistent)
```typescript
interface LongTermMemory {
  userId: string;
  profile: UserProfile;
  importantFacts: Fact[];
  relationships: Relationship[];
  preferences: DetailedPreferences;
  historicalSummaries: Summary[];
  learnings: Learning[];
}

// Stored in PostgreSQL with indexing
// Never expires
// Carefully curated information
// Used for personalization
```

## Implementation Strategy

### 1. Context Manager Service
```typescript
class ContextPersistenceManager {
  private workingMemory: RedisCache;
  private sessionDb: PostgreSQL;
  private vectorStore: PineconeDB;
  
  async getFullContext(userId: string): Promise<FullContext> {
    // Get working memory (most recent)
    const working = await this.workingMemory.get(userId);
    
    // Get session memory
    const session = await this.sessionDb.getSession(userId);
    
    // Get relevant long-term memory
    const longTerm = await this.vectorStore.searchRelevant(
      userId,
      working?.currentTopic
    );
    
    // Merge intelligently
    return this.mergeContextLayers(working, session, longTerm);
  }
  
  private mergeContextLayers(
    working: WorkingMemory,
    session: SessionMemory,
    longTerm: LongTermMemory
  ): FullContext {
    return {
      // Most recent messages from working memory
      recentMessages: working?.currentConversation || [],
      
      // Session context
      conversationHistory: this.summarizeHistory(session.conversations),
      userPreferences: session.userPreferences,
      
      // Long-term context
      userProfile: longTerm.profile,
      relevantFacts: longTerm.importantFacts,
      
      // Computed context
      contextWindow: this.optimizeForTokens({
        working,
        session,
        longTerm
      })
    };
  }
}
```

### 2. Cross-Channel Synchronization
```typescript
class ChannelSyncService {
  private eventBus: EventEmitter;
  private contextManager: ContextPersistenceManager;
  
  async syncMessage(
    userId: string,
    channel: ChannelType,
    message: Message
  ) {
    // Update working memory immediately
    await this.updateWorkingMemory(userId, message);
    
    // Emit sync event for other channels
    this.eventBus.emit('context-update', {
      userId,
      channel,
      message
    });
    
    // Async update to session memory
    this.updateSessionMemory(userId, channel, message);
    
    // Check for important information to persist
    if (this.isImportant(message)) {
      await this.updateLongTermMemory(userId, message);
    }
  }
  
  private isImportant(message: Message): boolean {
    // Check for user preferences
    if (message.content.includes("prefer") || 
        message.content.includes("like") ||
        message.content.includes("remember")) {
      return true;
    }
    
    // Check for personal information
    if (this.containsPersonalInfo(message)) {
      return true;
    }
    
    // Check for tasks/reminders
    if (this.containsActionItems(message)) {
      return true;
    }
    
    return false;
  }
}
```

### 3. User Identity Management
```typescript
class UserIdentityService {
  private userDb: Database;
  
  async linkIdentities(
    phoneNumber: string,
    email: string
  ): Promise<string> {
    // Check if either identity exists
    const existingUser = await this.userDb.findByPhoneOrEmail(
      phoneNumber,
      email
    );
    
    if (existingUser) {
      // Update with new identity
      await this.userDb.updateUser(existingUser.id, {
        phoneNumber,
        email
      });
      return existingUser.id;
    }
    
    // Create new user
    const newUser = await this.userDb.createUser({
      id: uuid(),
      phoneNumber,
      email,
      createdAt: new Date()
    });
    
    return newUser.id;
  }
  
  async getUserIdFromChannel(
    channel: ChannelType,
    identifier: string
  ): Promise<string> {
    switch (channel) {
      case ChannelType.IMESSAGE:
        return this.userDb.findByPhone(identifier);
      case ChannelType.EMAIL:
        return this.userDb.findByEmail(identifier);
      default:
        throw new Error(`Unknown channel: ${channel}`);
    }
  }
}
```

## Database Schemas

### Working Memory (Redis)
```typescript
// Key structure: context:working:{userId}
{
  "messages": [
    {
      "id": "msg_123",
      "content": "Hello",
      "channel": "imessage",
      "timestamp": "2024-01-01T12:00:00Z",
      "role": "user"
    }
  ],
  "activeChannel": "imessage",
  "lastActivity": "2024-01-01T12:00:00Z",
  "tempVars": {
    "currentTopic": "weather",
    "pendingQuestion": "What's the weather?"
  }
}
```

### Session Memory (PostgreSQL)
```sql
-- Conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  channel VARCHAR(50) NOT NULL,
  message_id VARCHAR(255) UNIQUE,
  content TEXT NOT NULL,
  role VARCHAR(20) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  INDEX idx_user_channel_time (user_id, channel, created_at DESC)
);

-- Session context table
CREATE TABLE session_context (
  user_id UUID PRIMARY KEY,
  context_summary TEXT,
  recent_topics TEXT[],
  preferences JSONB,
  last_updated TIMESTAMP DEFAULT NOW()
);
```

### Long-term Memory (PostgreSQL + Vector)
```sql
-- User facts table
CREATE TABLE user_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  fact_type VARCHAR(50),
  fact_content TEXT,
  confidence FLOAT,
  source VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  embedding VECTOR(1536), -- For similarity search
  INDEX idx_user_facts (user_id, fact_type)
);

-- Conversation summaries
CREATE TABLE conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  period_start TIMESTAMP,
  period_end TIMESTAMP,
  summary TEXT,
  key_points TEXT[],
  topics TEXT[],
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Context Optimization Strategies

### 1. Smart Summarization
```typescript
class ContextSummarizer {
  async summarizeOldConversations(
    conversations: Conversation[]
  ): Promise<string> {
    // Group by topic
    const byTopic = this.groupByTopic(conversations);
    
    // Summarize each topic
    const summaries = await Promise.all(
      Object.entries(byTopic).map(([topic, msgs]) => 
        this.summarizeTopic(topic, msgs)
      )
    );
    
    return summaries.join('\n\n');
  }
  
  private async summarizeTopic(
    topic: string,
    messages: Message[]
  ): Promise<string> {
    // Use Claude to generate concise summary
    return await this.claude.summarize({
      topic,
      messages,
      maxTokens: 100
    });
  }
}
```

### 2. Relevance Scoring
```typescript
class RelevanceScorer {
  scoreMessage(
    message: Message,
    currentContext: Context
  ): number {
    let score = 0;
    
    // Recency score (exponential decay)
    const ageHours = (Date.now() - message.timestamp) / 3600000;
    score += Math.exp(-ageHours / 24); // Decay over 24 hours
    
    // Topic relevance
    if (this.isTopicRelated(message, currentContext.topic)) {
      score += 2;
    }
    
    // User mentioned importance
    if (message.metadata?.important) {
      score += 3;
    }
    
    // Contains action items
    if (this.hasActionItems(message)) {
      score += 1.5;
    }
    
    return score;
  }
}
```

### 3. Token Management
```typescript
class TokenOptimizer {
  private readonly MAX_TOKENS = 8000;
  private readonly RESERVED_OUTPUT = 2000;
  
  optimizeContext(fullContext: FullContext): OptimizedContext {
    const available = this.MAX_TOKENS - this.RESERVED_OUTPUT;
    
    // Priority order
    const priorities = [
      { data: fullContext.currentMessages, weight: 0.4 },
      { data: fullContext.recentSummary, weight: 0.3 },
      { data: fullContext.userFacts, weight: 0.2 },
      { data: fullContext.historicalSummary, weight: 0.1 }
    ];
    
    const optimized = {};
    let tokensUsed = 0;
    
    for (const { data, weight } of priorities) {
      const allocation = Math.floor(available * weight);
      const truncated = this.truncateToTokens(data, allocation);
      
      optimized[data.type] = truncated;
      tokensUsed += this.countTokens(truncated);
      
      if (tokensUsed >= available) break;
    }
    
    return optimized;
  }
}
```

## Sync Protocols

### Real-time Sync
```typescript
class RealtimeSync {
  private pubsub: RedisPubSub;
  
  async publishContextUpdate(
    userId: string,
    update: ContextUpdate
  ) {
    await this.pubsub.publish(`context:${userId}`, {
      type: 'context-update',
      timestamp: Date.now(),
      update
    });
  }
  
  subscribeToUserContext(
    userId: string,
    callback: (update: ContextUpdate) => void
  ) {
    this.pubsub.subscribe(`context:${userId}`, callback);
  }
}
```

### Conflict Resolution
```typescript
class ConflictResolver {
  resolveContextConflict(
    local: Context,
    remote: Context
  ): Context {
    // Last-write-wins for simple fields
    const resolved = {
      ...local,
      ...remote,
      timestamp: Math.max(local.timestamp, remote.timestamp)
    };
    
    // Merge arrays (messages)
    resolved.messages = this.mergeMessages(
      local.messages,
      remote.messages
    );
    
    // Merge preferences (union)
    resolved.preferences = {
      ...local.preferences,
      ...remote.preferences
    };
    
    return resolved;
  }
  
  private mergeMessages(
    local: Message[],
    remote: Message[]
  ): Message[] {
    const messageMap = new Map();
    
    // Add all messages, deduped by ID
    [...local, ...remote].forEach(msg => {
      messageMap.set(msg.id, msg);
    });
    
    // Sort by timestamp
    return Array.from(messageMap.values())
      .sort((a, b) => a.timestamp - b.timestamp);
  }
}
```

## Performance Considerations

### Caching Strategy
1. **L1 Cache**: In-memory cache for hot data (10MB)
2. **L2 Cache**: Redis for working memory (100MB per user)
3. **L3 Storage**: PostgreSQL for persistent data

### Query Optimization
1. Indexed searches on user_id, timestamp
2. Partial indexes for active conversations
3. Materialized views for summaries
4. Vector indexes for semantic search

### Batch Processing
1. Batch context updates every 100ms
2. Bulk inserts for conversation history
3. Async summary generation
4. Background vector embedding

## Privacy & Security

### Data Encryption
- Encrypt sensitive data at rest
- Use field-level encryption for PII
- Secure key management with AWS KMS

### Data Retention
- Working memory: 1 hour
- Session memory: 7 days
- Long-term memory: User-controlled
- Right to deletion (GDPR compliance)

### Access Control
- User-scoped data access
- Channel verification
- Rate limiting per user
- Audit logging
