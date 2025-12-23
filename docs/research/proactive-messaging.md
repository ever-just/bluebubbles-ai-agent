# Proactive Messaging Strategy

## Overview
Implementation strategy for enabling the AI agent to initiate conversations, send reminders, and perform scheduled tasks without user prompts.

## Core Requirements

### 1. Time-based Triggers
- Scheduled reminders
- Calendar event notifications
- Recurring tasks
- Time-zone aware scheduling

### 2. Event-based Triggers
- Email arrivals
- Calendar updates
- System events
- External webhooks

### 3. Condition-based Triggers
- Context-aware notifications
- Threshold monitoring
- Pattern detection
- Predictive alerts

## Architecture

### Scheduler Service
```typescript
class ProactiveScheduler {
  private queue: BullQueue;
  private jobs: Map<string, Job>;
  
  constructor() {
    this.queue = new BullQueue('proactive-messages', {
      redis: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
      }
    });
    
    this.setupWorkers();
  }
  
  async scheduleMessage(options: ScheduleOptions): Promise<string> {
    const job = await this.queue.add('message', {
      userId: options.userId,
      channel: options.channel,
      message: options.message,
      metadata: options.metadata
    }, {
      delay: options.delay,
      repeat: options.repeat,
      jobId: options.jobId
    });
    
    this.jobs.set(job.id, job);
    return job.id;
  }
  
  private setupWorkers() {
    this.queue.process('message', async (job) => {
      await this.executeProactiveMessage(job.data);
    });
  }
}
```

### Message Types

#### 1. Reminders
```typescript
interface Reminder {
  id: string;
  userId: string;
  content: string;
  scheduledFor: Date;
  channel: ChannelType;
  recurring?: RecurrenceRule;
  metadata?: {
    priority: 'high' | 'medium' | 'low';
    category: string;
    snoozeCount: number;
  };
}

class ReminderService {
  async createReminder(
    userId: string,
    reminderText: string,
    time: Date,
    options?: ReminderOptions
  ): Promise<Reminder> {
    const reminder: Reminder = {
      id: uuid(),
      userId,
      content: reminderText,
      scheduledFor: time,
      channel: options?.channel || ChannelType.IMESSAGE,
      recurring: options?.recurring,
      metadata: {
        priority: options?.priority || 'medium',
        category: options?.category || 'general',
        snoozeCount: 0
      }
    };
    
    // Store in database
    await this.db.saveReminder(reminder);
    
    // Schedule job
    await this.scheduler.scheduleMessage({
      userId,
      channel: reminder.channel,
      message: this.formatReminder(reminder),
      delay: time.getTime() - Date.now(),
      jobId: reminder.id,
      repeat: this.parseRecurrence(reminder.recurring)
    });
    
    return reminder;
  }
  
  private formatReminder(reminder: Reminder): string {
    const prefix = this.getPriorityEmoji(reminder.metadata.priority);
    return `${prefix} Reminder: ${reminder.content}`;
  }
}
```

#### 2. Calendar Notifications
```typescript
class CalendarNotificationService {
  private templates = {
    upcoming: 'You have "{event}" starting in {time}',
    daily: 'Today\'s schedule:\n{events}',
    weekly: 'This week\'s highlights:\n{events}'
  };
  
  async scheduleEventNotifications(
    userId: string,
    event: CalendarEvent
  ) {
    // Pre-event reminder (15 minutes before)
    if (event.reminders?.useDefault !== false) {
      await this.scheduler.scheduleMessage({
        userId,
        channel: await this.getUserPreferredChannel(userId),
        message: this.templates.upcoming
          .replace('{event}', event.summary)
          .replace('{time}', '15 minutes'),
        delay: new Date(event.start).getTime() - 15 * 60 * 1000 - Date.now()
      });
    }
    
    // Custom reminders
    for (const reminder of event.reminders?.overrides || []) {
      const reminderTime = this.calculateReminderTime(event.start, reminder);
      
      await this.scheduler.scheduleMessage({
        userId,
        channel: await this.getUserPreferredChannel(userId),
        message: this.formatEventReminder(event, reminder),
        delay: reminderTime.getTime() - Date.now()
      });
    }
  }
  
  async scheduleDailySummary(userId: string) {
    // Schedule for 8 AM every day
    const tomorrow8AM = new Date();
    tomorrow8AM.setDate(tomorrow8AM.getDate() + 1);
    tomorrow8AM.setHours(8, 0, 0, 0);
    
    await this.scheduler.scheduleMessage({
      userId,
      channel: await this.getUserPreferredChannel(userId),
      message: await this.generateDailySummary(userId),
      delay: tomorrow8AM.getTime() - Date.now(),
      repeat: {
        cron: '0 8 * * *'  // Every day at 8 AM
      }
    });
  }
}
```

#### 3. Smart Notifications
```typescript
class SmartNotificationService {
  private ml: MachineLearningService;
  
  async analyzeUserPatterns(userId: string) {
    const patterns = await this.ml.analyzeActivity(userId);
    
    // Detect optimal notification times
    const optimalTimes = patterns.preferredInteractionTimes;
    
    // Detect important topics
    const importantTopics = patterns.frequentTopics;
    
    // Schedule contextual notifications
    for (const topic of importantTopics) {
      if (await this.shouldNotifyAbout(topic)) {
        await this.scheduleContextualNotification(userId, topic);
      }
    }
  }
  
  async scheduleContextualNotification(
    userId: string,
    topic: Topic
  ) {
    const notification = await this.generateNotification(topic);
    const optimalTime = await this.getOptimalTime(userId);
    
    await this.scheduler.scheduleMessage({
      userId,
      channel: await this.getUserPreferredChannel(userId),
      message: notification,
      delay: optimalTime.getTime() - Date.now(),
      metadata: {
        type: 'smart',
        topic: topic.name,
        confidence: topic.confidence
      }
    });
  }
}
```

## Natural Language Processing for Scheduling

### Intent Detection
```typescript
class SchedulingNLU {
  private patterns = {
    reminder: /remind me to (.+) (at|in|on|tomorrow|next) (.+)/i,
    recurring: /(every|daily|weekly|monthly) (.+)/i,
    snooze: /snooze for (\d+) (minutes?|hours?|days?)/i,
    cancel: /cancel (reminder|notification) (.+)/i
  };
  
  async processSchedulingRequest(
    message: string,
    userId: string
  ): Promise<SchedulingIntent> {
    // Check for reminder intent
    const reminderMatch = message.match(this.patterns.reminder);
    if (reminderMatch) {
      return {
        type: 'reminder',
        content: reminderMatch[1],
        time: await this.parseTime(reminderMatch[3]),
        recurring: this.detectRecurrence(message)
      };
    }
    
    // Check for snooze
    const snoozeMatch = message.match(this.patterns.snooze);
    if (snoozeMatch) {
      return {
        type: 'snooze',
        duration: this.parseDuration(snoozeMatch[1], snoozeMatch[2])
      };
    }
    
    // Use Claude for complex scheduling
    return await this.claudeSchedulingAnalysis(message);
  }
  
  private async parseTime(timeStr: string): Promise<Date> {
    // Use chrono-node for natural language date parsing
    const results = chrono.parse(timeStr);
    if (results.length > 0) {
      return results[0].start.date();
    }
    
    // Fallback to relative time parsing
    return this.parseRelativeTime(timeStr);
  }
}
```

## Delivery Strategies

### Channel Selection
```typescript
class ChannelSelector {
  async selectChannel(
    userId: string,
    messageType: MessageType
  ): Promise<ChannelType> {
    // Get user preferences
    const preferences = await this.getUserPreferences(userId);
    
    // Check if user has channel preference for this message type
    if (preferences.channelPreferences?.[messageType]) {
      return preferences.channelPreferences[messageType];
    }
    
    // Check user availability
    const availability = await this.checkAvailability(userId);
    
    // Smart selection based on context
    if (messageType === 'urgent' && availability.iMessage) {
      return ChannelType.IMESSAGE;
    }
    
    if (messageType === 'work' && availability.email) {
      return ChannelType.EMAIL;
    }
    
    // Default to most recently used channel
    return await this.getMostRecentChannel(userId);
  }
  
  async checkAvailability(userId: string): Promise<ChannelAvailability> {
    const [imessageActive, emailActive] = await Promise.all([
      this.checkIMessageActivity(userId),
      this.checkEmailActivity(userId)
    ]);
    
    return {
      iMessage: imessageActive,
      email: emailActive,
      preferred: imessageActive ? ChannelType.IMESSAGE : ChannelType.EMAIL
    };
  }
}
```

### Delivery Confirmation
```typescript
class DeliveryManager {
  async sendProactiveMessage(
    userId: string,
    message: string,
    channel: ChannelType,
    options?: DeliveryOptions
  ): Promise<DeliveryResult> {
    try {
      // Send message
      const result = await this.sendViaChannel(channel, userId, message);
      
      // Track delivery
      await this.trackDelivery({
        userId,
        channel,
        messageId: result.messageId,
        status: 'delivered',
        timestamp: new Date()
      });
      
      // Handle read receipts if available
      if (channel === ChannelType.IMESSAGE) {
        this.monitorReadReceipt(result.messageId);
      }
      
      return {
        success: true,
        messageId: result.messageId,
        channel
      };
    } catch (error) {
      // Fallback to alternative channel
      if (options?.fallbackChannel) {
        return this.sendProactiveMessage(
          userId,
          message,
          options.fallbackChannel,
          { ...options, fallbackChannel: undefined }
        );
      }
      
      throw error;
    }
  }
  
  private async monitorReadReceipt(messageId: string) {
    // Set up listener for read receipt
    this.bluebubbles.on('read-receipt', async (receipt) => {
      if (receipt.messageId === messageId) {
        await this.updateDeliveryStatus(messageId, 'read');
      }
    });
  }
}
```

## Conversation Context

### Context-Aware Messaging
```typescript
class ContextualMessaging {
  async generateProactiveMessage(
    userId: string,
    trigger: Trigger
  ): Promise<string> {
    // Load user context
    const context = await this.contextManager.loadContext(userId);
    
    // Get recent conversation topics
    const recentTopics = this.extractRecentTopics(context.conversations);
    
    // Generate contextual message
    const message = await this.claude.generate({
      systemPrompt: `Generate a helpful proactive message based on the trigger.
        Consider recent conversation topics: ${recentTopics.join(', ')}
        Trigger: ${trigger.type} - ${trigger.description}
        Be concise and relevant.`,
      userContext: context,
      trigger
    });
    
    // Add personalization
    return this.personalizeMessage(message, context.userProfile);
  }
  
  private personalizeMessage(
    message: string,
    profile: UserProfile
  ): string {
    // Add user's preferred name
    if (profile.preferredName) {
      message = message.replace('{name}', profile.preferredName);
    }
    
    // Adjust tone based on preferences
    if (profile.communicationStyle === 'formal') {
      message = this.formalizeTone(message);
    } else if (profile.communicationStyle === 'casual') {
      message = this.casualizeTone(message);
    }
    
    return message;
  }
}
```

## Queue Management

### Priority Queue
```typescript
class ProactiveQueue {
  private queues: Map<Priority, BullQueue>;
  
  constructor() {
    this.queues = new Map([
      ['high', new BullQueue('proactive-high')],
      ['medium', new BullQueue('proactive-medium')],
      ['low', new BullQueue('proactive-low')]
    ]);
    
    this.setupProcessors();
  }
  
  async addMessage(
    message: ProactiveMessage,
    priority: Priority = 'medium'
  ) {
    const queue = this.queues.get(priority);
    
    await queue.add('message', message, {
      delay: message.scheduledFor.getTime() - Date.now(),
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: true,
      removeOnFail: false
    });
  }
  
  private setupProcessors() {
    // Process high priority immediately
    this.queues.get('high').process(5, async (job) => {
      await this.processMessage(job.data, 'high');
    });
    
    // Process medium priority with normal concurrency
    this.queues.get('medium').process(3, async (job) => {
      await this.processMessage(job.data, 'medium');
    });
    
    // Process low priority in background
    this.queues.get('low').process(1, async (job) => {
      await this.processMessage(job.data, 'low');
    });
  }
}
```

### Failure Handling
```typescript
class ProactiveFailureHandler {
  async handleFailedMessage(
    job: Job,
    error: Error
  ): Promise<void> {
    const { userId, channel, message } = job.data;
    
    // Log failure
    await this.logger.error('Proactive message failed', {
      jobId: job.id,
      userId,
      channel,
      error: error.message,
      attempt: job.attemptsMade
    });
    
    // Check if we should retry
    if (job.attemptsMade < 3) {
      // Retry with exponential backoff
      await job.retry();
      return;
    }
    
    // Try fallback channel
    const fallbackChannel = this.getFallbackChannel(channel);
    if (fallbackChannel) {
      await this.scheduler.scheduleMessage({
        userId,
        channel: fallbackChannel,
        message: `[Retry] ${message}`,
        delay: 0
      });
      return;
    }
    
    // Store for manual review
    await this.storeFailedMessage(job.data, error);
    
    // Notify admin if critical
    if (this.isCritical(job.data)) {
      await this.notifyAdmin(job.data, error);
    }
  }
}
```

## User Control

### Preference Management
```typescript
interface ProactivePreferences {
  enabled: boolean;
  channels: {
    [key in ChannelType]: {
      enabled: boolean;
      quietHours?: {
        start: string; // "22:00"
        end: string;   // "08:00"
      };
      maxPerDay?: number;
    };
  };
  messageTypes: {
    reminders: boolean;
    calendar: boolean;
    suggestions: boolean;
    summaries: boolean;
  };
  timezone: string;
}

class PreferenceManager {
  async updatePreferences(
    userId: string,
    preferences: Partial<ProactivePreferences>
  ) {
    const current = await this.getPreferences(userId);
    const updated = { ...current, ...preferences };
    
    await this.db.savePreferences(userId, updated);
    
    // Update scheduled jobs
    await this.updateScheduledJobs(userId, updated);
  }
  
  async shouldSendMessage(
    userId: string,
    messageType: string,
    channel: ChannelType
  ): Promise<boolean> {
    const prefs = await this.getPreferences(userId);
    
    // Check if proactive messaging is enabled
    if (!prefs.enabled) return false;
    
    // Check if channel is enabled
    if (!prefs.channels[channel]?.enabled) return false;
    
    // Check message type
    if (!prefs.messageTypes[messageType]) return false;
    
    // Check quiet hours
    if (this.isQuietHours(prefs.channels[channel].quietHours)) {
      return false;
    }
    
    // Check daily limit
    const todayCount = await this.getTodayMessageCount(userId, channel);
    if (todayCount >= prefs.channels[channel].maxPerDay) {
      return false;
    }
    
    return true;
  }
}
```

### Snooze and Dismissal
```typescript
class SnoozeService {
  async snoozeReminder(
    reminderId: string,
    duration: number,
    unit: TimeUnit
  ): Promise<void> {
    const reminder = await this.db.getReminder(reminderId);
    
    // Cancel current job
    await this.scheduler.cancelJob(reminderId);
    
    // Calculate new time
    const newTime = this.calculateSnoozeTime(duration, unit);
    
    // Reschedule
    await this.scheduler.scheduleMessage({
      userId: reminder.userId,
      channel: reminder.channel,
      message: `[Snoozed] ${reminder.content}`,
      delay: newTime.getTime() - Date.now(),
      jobId: reminderId
    });
    
    // Update reminder
    await this.db.updateReminder(reminderId, {
      scheduledFor: newTime,
      'metadata.snoozeCount': reminder.metadata.snoozeCount + 1
    });
  }
  
  async dismissReminder(reminderId: string): Promise<void> {
    // Cancel job
    await this.scheduler.cancelJob(reminderId);
    
    // Mark as dismissed
    await this.db.updateReminder(reminderId, {
      status: 'dismissed',
      dismissedAt: new Date()
    });
  }
}
```

## Monitoring & Analytics

### Metrics Collection
```typescript
class ProactiveMetrics {
  async trackMessage(event: ProactiveEvent) {
    await this.metrics.increment('proactive.messages.sent', {
      channel: event.channel,
      type: event.messageType,
      userId: event.userId
    });
    
    // Track timing
    if (event.scheduledFor) {
      const delay = Date.now() - event.scheduledFor.getTime();
      await this.metrics.gauge('proactive.delivery.delay', delay);
    }
    
    // Track success rate
    if (event.delivered) {
      await this.metrics.increment('proactive.delivery.success');
    } else {
      await this.metrics.increment('proactive.delivery.failure');
    }
  }
  
  async generateReport(userId?: string): Promise<ProactiveReport> {
    const metrics = await this.metrics.query({
      metric: 'proactive.*',
      userId,
      timeRange: '7d'
    });
    
    return {
      totalSent: metrics['proactive.messages.sent'],
      byChannel: this.groupByChannel(metrics),
      byType: this.groupByType(metrics),
      successRate: this.calculateSuccessRate(metrics),
      averageDelay: metrics['proactive.delivery.delay'],
      peakHours: this.identifyPeakHours(metrics)
    };
  }
}
```

## Implementation Checklist

### Phase 1: Basic Reminders
- [ ] Implement job queue with Redis/Bull
- [ ] Create reminder parsing from natural language
- [ ] Build basic scheduler service
- [ ] Add database schema for reminders
- [ ] Implement delivery to single channel

### Phase 2: Calendar Integration
- [ ] Connect Google Calendar API
- [ ] Implement event monitoring
- [ ] Create event notification templates
- [ ] Add pre-event reminders
- [ ] Build daily/weekly summaries

### Phase 3: Smart Features
- [ ] Implement pattern detection
- [ ] Add context-aware messaging
- [ ] Build channel selection logic
- [ ] Create personalization engine
- [ ] Add ML-based timing optimization

### Phase 4: User Control
- [ ] Build preference management UI
- [ ] Implement quiet hours
- [ ] Add snooze functionality
- [ ] Create message type controls
- [ ] Build notification history

### Phase 5: Reliability
- [ ] Implement retry logic
- [ ] Add fallback channels
- [ ] Build monitoring dashboard
- [ ] Create alerting system
- [ ] Add manual intervention tools
