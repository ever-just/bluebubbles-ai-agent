// Core type definitions for BlueBubbles AI Agent

export interface User {
  id: string;
  phoneNumber?: string;
  email?: string;
  googleId?: string;
  createdAt: Date;
  updatedAt: Date;
  preferences: UserPreferences;
  isActive: boolean;
}

export interface UserPreferences {
  timezone?: string;
  language?: string;
  aiPersonality?: 'professional' | 'friendly' | 'casual' | 'concise';
  enableReminders?: boolean;
  reminderChannelPreference?: 'imessage' | 'email' | 'both';
  [key: string]: any;
}

export interface Conversation {
  id: string;
  userId: string;
  channel: 'imessage' | 'email';
  channelConversationId?: string; // BlueBubbles chat ID or email thread ID
  startedAt: Date;
  lastMessageAt?: Date;
  metadata: Record<string, any>;
}

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: MessageMetadata;
  createdAt: Date;
  tokensUsed?: number;
  embedding?: number[];
}

export interface MessageMetadata {
  source?: 'bluebubbles' | 'gmail' | 'system';
  originalMessageId?: string;
  attachments?: Attachment[] | BlueBubblesAttachment[];
  isGroupChat?: boolean;
  chatParticipants?: string[];
  [key: string]: any;
}

export interface Attachment {
  id: string;
  type: string;
  name: string;
  size: number;
  url?: string;
  data?: Buffer;
}

export interface ContextMemory {
  id: string;
  userId: string;
  conversationId?: string;
  memoryType: 'working' | 'session' | 'long_term';
  key: string;
  value: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  embedding?: number[];
}

export interface Reminder {
  id: string;
  userId: string;
  content: string;
  remindAt: Date;
  channel: 'imessage' | 'email' | 'both';
  status: 'pending' | 'sent' | 'snoozed' | 'cancelled';
  metadata: ReminderMetadata;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface ReminderMetadata {
  originalMessage?: string;
  snoozeCount?: number;
  lastSnoozeAt?: Date;
  priority?: 'low' | 'medium' | 'high';
  recurring?: boolean;
  recurringPattern?: string;
  [key: string]: any;
}

// BlueBubbles specific types
export interface BlueBubblesMessage {
  guid: string;
  text: string;
  handle_id: number;
  service: string;
  is_from_me: boolean;
  date: number;
  date_read?: number;
  date_delivered?: number;
  chat_id: string;
  attachments?: BlueBubblesAttachment[];
  handle?: BlueBubblesHandle;
}

export interface BlueBubblesChat {
  guid: string;
  chat_identifier: string;
  display_name?: string;
  participants: BlueBubblesHandle[];
  is_group: boolean;
  last_message?: BlueBubblesMessage;
}

export interface BlueBubblesHandle {
  id: number;
  identifier: string; // phone number or email
  address?: string; // actual phone number/email address
  country?: string;
  service: string;
  uncanonical_id?: string;
}

export interface BlueBubblesAttachment {
  guid: string;
  uti: string;
  mime_type: string;
  transfer_name: string;
  total_bytes: number;
  is_sticker: boolean;
  hide_attachment: boolean;
}

// Claude AI specific types
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeContext {
  messages: ClaudeMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  priority?: number;
  estimatedTokens?: number;
  tags?: string[];
}

export interface ClaudeResponse {
  content: string;
  tokensUsed: number;
  finishReason: string;
  metadata?: Record<string, any>;
}

// Service response types
export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Queue job types
export interface MessageProcessingJob {
  userId: string;
  conversationId: string;
  message: Message;
  channel: 'imessage' | 'email';
  priority: number;
}

export interface ReminderJob {
  reminderId: string;
  userId: string;
  content: string;
  channel: 'imessage' | 'email';
  retryCount?: number;
}

// WebSocket event types
export interface WebSocketEvent {
  type: 'message' | 'status' | 'error' | 'connected' | 'disconnected';
  data: any;
  timestamp: Date;
}

// Configuration types
export interface AppConfig {
  port: number;
  environment: 'development' | 'production' | 'test';
  database: DatabaseConfig;
  redis: RedisConfig;
  bluebubbles: BlueBubblesConfig;
  anthropic: AnthropicConfig;
  logging: LoggingConfig;
  security: SecurityConfig;
}

export interface DatabaseConfig {
  url: string;
  maxConnections: number;
  ssl?: boolean;
}

export interface RedisConfig {
  url: string;
  maxRetriesPerRequest?: number;
}

export interface BlueBubblesConfig {
  url: string;
  password: string;
  pollInterval?: number;
  timeout?: number;
  sendEnabled?: boolean;
}

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  requestLimitPerMinute?: number;
  inputTokenLimitPerMinute?: number;
  outputTokenLimitPerMinute?: number;
  maxConcurrentRequests?: number;
  summaryTriggerTokens?: number;
  contextWindowTokens?: number;
  responseMaxTokens?: number;
  enableWebSearch?: boolean;
  webSearchMaxUses?: number;
  enableWebFetch?: boolean;
  webFetchMaxUses?: number;
  webFetchBetaHeader?: string;
}

export interface LoggingConfig {
  level: 'error' | 'warn' | 'info' | 'debug';
  format: 'json' | 'simple';
  outputPath?: string;
}

export interface SecurityConfig {
  encryptionKey: string;
  sessionSecret: string;
  rateLimitPerMinute?: number;
}
