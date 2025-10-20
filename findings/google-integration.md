# Google Integration Strategy

## Overview
Comprehensive integration with Google Workspace services including Gmail, Google Calendar, and authentication through Auth0.

## Components

### 1. Gmail Integration
- Email monitoring and processing
- Send/receive capabilities
- Thread management
- Attachment handling

### 2. Google Calendar
- Event synchronization
- Reminder scheduling
- Calendar-based triggers
- Meeting summaries

### 3. Auth0 Integration
- User authentication
- OAuth 2.0 flow
- Token management
- Multi-factor authentication

## Gmail API Integration

### Setup & Authentication
```typescript
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

class GmailService {
  private gmail: any;
  private oauth2Client: OAuth2Client;
  
  constructor() {
    this.oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.REDIRECT_URI
    );
    
    this.gmail = google.gmail({
      version: 'v1',
      auth: this.oauth2Client
    });
  }
  
  async authenticate(code: string) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    
    // Store refresh token
    await this.storeRefreshToken(tokens.refresh_token);
  }
}
```

### Email Monitoring Strategy

#### Push Notifications (Recommended)
```typescript
class GmailPushNotifications {
  private pubsubClient: PubSubClient;
  
  async setupWatch(userEmail: string) {
    // Set up Gmail watch
    const watchResponse = await this.gmail.users.watch({
      userId: userEmail,
      requestBody: {
        topicName: `projects/${PROJECT_ID}/topics/gmail-push`,
        labelIds: ['INBOX'],
        labelFilterAction: 'include'
      }
    });
    
    // Store watch expiration
    await this.storeWatchExpiration(
      userEmail,
      watchResponse.data.expiration
    );
    
    // Set up renewal
    this.scheduleWatchRenewal(userEmail, watchResponse.data.expiration);
  }
  
  async handlePushNotification(message: PubSubMessage) {
    const { emailAddress, historyId } = JSON.parse(
      Buffer.from(message.data, 'base64').toString()
    );
    
    // Get changes since last historyId
    const history = await this.gmail.users.history.list({
      userId: emailAddress,
      startHistoryId: await this.getLastHistoryId(emailAddress)
    });
    
    // Process new messages
    for (const change of history.data.history || []) {
      if (change.messagesAdded) {
        for (const msg of change.messagesAdded) {
          await this.processNewEmail(emailAddress, msg.message.id);
        }
      }
    }
    
    // Update last historyId
    await this.updateHistoryId(emailAddress, historyId);
  }
}
```

#### Polling Fallback
```typescript
class GmailPolling {
  private pollingInterval = 30000; // 30 seconds
  
  async startPolling(userEmail: string) {
    setInterval(async () => {
      await this.checkForNewMessages(userEmail);
    }, this.pollingInterval);
  }
  
  async checkForNewMessages(userEmail: string) {
    const lastCheck = await this.getLastCheckTime(userEmail);
    
    const response = await this.gmail.users.messages.list({
      userId: userEmail,
      q: `after:${lastCheck} in:inbox`,
      maxResults: 10
    });
    
    for (const message of response.data.messages || []) {
      await this.processNewEmail(userEmail, message.id);
    }
    
    await this.updateLastCheckTime(userEmail);
  }
}
```

### Email Processing
```typescript
class EmailProcessor {
  async processNewEmail(userEmail: string, messageId: string) {
    // Get full message
    const message = await this.gmail.users.messages.get({
      userId: userEmail,
      id: messageId,
      format: 'full'
    });
    
    // Extract relevant data
    const emailData = {
      id: message.data.id,
      threadId: message.data.threadId,
      from: this.extractEmailAddress(message.data.payload.headers, 'From'),
      to: this.extractEmailAddress(message.data.payload.headers, 'To'),
      subject: this.extractHeader(message.data.payload.headers, 'Subject'),
      body: this.extractBody(message.data.payload),
      attachments: this.extractAttachments(message.data.payload),
      timestamp: new Date(parseInt(message.data.internalDate))
    };
    
    // Check if it's for the AI agent
    if (this.isForAgent(emailData)) {
      await this.routeToAgent(emailData);
    }
  }
  
  private isForAgent(email: EmailData): boolean {
    // Check if sent to agent email
    if (email.to.includes(process.env.AGENT_EMAIL)) {
      return true;
    }
    
    // Check for agent mentions in body
    if (email.body.includes('@agent') || email.body.includes('@assistant')) {
      return true;
    }
    
    // Check if part of existing conversation thread
    if (this.isAgentThread(email.threadId)) {
      return true;
    }
    
    return false;
  }
}
```

### Sending Emails
```typescript
class EmailSender {
  async sendEmail(
    to: string,
    subject: string,
    body: string,
    options?: EmailOptions
  ) {
    const message = this.createMessage({
      to,
      from: process.env.AGENT_EMAIL,
      subject,
      body,
      inReplyTo: options?.inReplyTo,
      threadId: options?.threadId
    });
    
    const response = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: message,
        threadId: options?.threadId
      }
    });
    
    return response.data;
  }
  
  private createMessage(email: EmailData): string {
    const messageParts = [
      `From: ${email.from}`,
      `To: ${email.to}`,
      `Subject: ${email.subject}`,
      email.inReplyTo ? `In-Reply-To: ${email.inReplyTo}` : '',
      'Content-Type: text/plain; charset=utf-8',
      '',
      email.body
    ];
    
    const message = messageParts.filter(Boolean).join('\n');
    return Buffer.from(message).toString('base64url');
  }
}
```

## Google Calendar Integration

### Calendar Service Setup
```typescript
class CalendarService {
  private calendar: any;
  
  constructor(auth: OAuth2Client) {
    this.calendar = google.calendar({
      version: 'v3',
      auth
    });
  }
  
  async syncUserCalendar(userId: string) {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const events = await this.calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: nextWeek.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    return this.processEvents(events.data.items);
  }
  
  private processEvents(events: CalendarEvent[]): ProcessedEvent[] {
    return events.map(event => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start.dateTime || event.start.date,
      end: event.end.dateTime || event.end.date,
      location: event.location,
      attendees: event.attendees?.map(a => a.email),
      reminders: event.reminders
    }));
  }
}
```

### Event Monitoring & Reminders
```typescript
class CalendarReminders {
  private scheduler: SchedulerService;
  
  async setupEventReminders(userId: string, events: ProcessedEvent[]) {
    for (const event of events) {
      // Default reminder 15 minutes before
      const reminderTime = new Date(
        new Date(event.start).getTime() - 15 * 60 * 1000
      );
      
      await this.scheduler.scheduleReminder({
        userId,
        time: reminderTime,
        message: `Upcoming event: ${event.summary} at ${event.start}`,
        metadata: {
          eventId: event.id,
          type: 'calendar-event'
        }
      });
      
      // Custom reminders if specified
      if (event.reminders?.useDefault === false) {
        for (const reminder of event.reminders.overrides || []) {
          const customTime = this.calculateReminderTime(
            event.start,
            reminder
          );
          
          await this.scheduler.scheduleReminder({
            userId,
            time: customTime,
            message: `Reminder: ${event.summary}`,
            metadata: {
              eventId: event.id,
              type: 'custom-reminder'
            }
          });
        }
      }
    }
  }
}
```

### Calendar Watch for Real-time Updates
```typescript
class CalendarWatch {
  async setupCalendarWatch(userId: string, calendarId: string) {
    const channel = {
      id: `calendar-${userId}-${Date.now()}`,
      type: 'web_hook',
      address: `${process.env.WEBHOOK_URL}/calendar/notifications`,
      token: this.generateToken(userId)
    };
    
    const watchResponse = await this.calendar.events.watch({
      calendarId,
      requestBody: channel
    });
    
    // Store watch details
    await this.storeWatchDetails(userId, {
      channelId: channel.id,
      resourceId: watchResponse.data.resourceId,
      expiration: watchResponse.data.expiration
    });
    
    // Schedule renewal
    this.scheduleWatchRenewal(userId, watchResponse.data.expiration);
  }
  
  async handleCalendarNotification(notification: CalendarNotification) {
    const { userId } = this.parseToken(notification.token);
    
    // Get changed events
    const syncToken = await this.getSyncToken(userId);
    const changes = await this.calendar.events.list({
      calendarId: 'primary',
      syncToken
    });
    
    // Process changes
    for (const event of changes.data.items || []) {
      await this.processEventChange(userId, event);
    }
    
    // Update sync token
    await this.updateSyncToken(userId, changes.data.nextSyncToken);
  }
}
```

## Auth0 Integration

### Auth0 Setup
```typescript
import { ManagementClient, AuthenticationClient } from 'auth0';

class Auth0Service {
  private management: ManagementClient;
  private auth: AuthenticationClient;
  
  constructor() {
    this.management = new ManagementClient({
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      scope: 'read:users update:users'
    });
    
    this.auth = new AuthenticationClient({
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID
    });
  }
}
```

### User Authentication Flow
```typescript
class AuthenticationFlow {
  async authenticateUser(code: string): Promise<AuthResult> {
    // Exchange code for tokens
    const tokens = await this.auth.oauth.authorizationCodeGrant({
      code,
      redirect_uri: process.env.REDIRECT_URI
    });
    
    // Get user profile
    const userInfo = await this.auth.getProfile(tokens.access_token);
    
    // Create or update user in database
    const user = await this.createOrUpdateUser({
      auth0Id: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture
    });
    
    // Link Google account if present
    if (userInfo.identities?.find(i => i.provider === 'google-oauth2')) {
      await this.linkGoogleAccount(user.id, userInfo);
    }
    
    return {
      user,
      tokens,
      googleLinked: !!userInfo.identities?.find(
        i => i.provider === 'google-oauth2'
      )
    };
  }
}
```

### Google OAuth through Auth0
```typescript
class GoogleAuth0Integration {
  async setupGoogleConnection(userId: string) {
    // Generate authorization URL with Google scope
    const authUrl = this.auth.buildAuthorizeUrl({
      connection: 'google-oauth2',
      scope: 'openid profile email ' +
        'https://www.googleapis.com/auth/gmail.modify ' +
        'https://www.googleapis.com/auth/calendar',
      redirect_uri: process.env.REDIRECT_URI,
      state: this.generateState(userId)
    });
    
    return authUrl;
  }
  
  async handleCallback(code: string, state: string) {
    const userId = this.parseState(state);
    
    // Exchange code for tokens
    const tokens = await this.auth.oauth.authorizationCodeGrant({
      code,
      redirect_uri: process.env.REDIRECT_URI
    });
    
    // Get Google tokens from Auth0
    const userInfo = await this.management.getUser({
      id: userId
    });
    
    const googleIdentity = userInfo.identities.find(
      i => i.provider === 'google-oauth2'
    );
    
    if (googleIdentity?.access_token) {
      // Store Google tokens
      await this.storeGoogleTokens(userId, {
        access_token: googleIdentity.access_token,
        refresh_token: googleIdentity.refresh_token,
        scope: googleIdentity.scope
      });
      
      // Initialize Google services
      await this.initializeGoogleServices(userId);
    }
  }
}
```

## Unified Google Service Manager
```typescript
class GoogleServicesManager {
  private gmail: GmailService;
  private calendar: CalendarService;
  private auth0: Auth0Service;
  private tokenManager: TokenManager;
  
  async initializeForUser(userId: string) {
    // Get stored tokens
    const tokens = await this.tokenManager.getTokens(userId);
    
    if (!tokens) {
      throw new Error('User not authenticated with Google');
    }
    
    // Create OAuth client
    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    
    oauth2Client.setCredentials(tokens);
    
    // Auto-refresh tokens
    oauth2Client.on('tokens', async (newTokens) => {
      await this.tokenManager.updateTokens(userId, newTokens);
    });
    
    // Initialize services
    this.gmail = new GmailService(oauth2Client);
    this.calendar = new CalendarService(oauth2Client);
    
    // Set up monitoring
    await this.setupMonitoring(userId);
  }
  
  private async setupMonitoring(userId: string) {
    // Gmail push notifications
    await this.gmail.setupWatch(userId);
    
    // Calendar watch
    await this.calendar.setupWatch(userId);
    
    // Initial sync
    await this.syncAll(userId);
  }
  
  async syncAll(userId: string) {
    await Promise.all([
      this.gmail.syncInbox(userId),
      this.calendar.syncEvents(userId)
    ]);
  }
}
```

## Security Considerations

### Token Storage
```typescript
class SecureTokenStorage {
  private encryption: EncryptionService;
  
  async storeTokens(userId: string, tokens: TokenSet) {
    // Encrypt sensitive tokens
    const encrypted = {
      access_token: await this.encryption.encrypt(tokens.access_token),
      refresh_token: await this.encryption.encrypt(tokens.refresh_token),
      expiry_date: tokens.expiry_date,
      scope: tokens.scope
    };
    
    // Store in database
    await this.db.upsert('user_tokens', {
      user_id: userId,
      provider: 'google',
      tokens: encrypted,
      updated_at: new Date()
    });
  }
  
  async getTokens(userId: string): Promise<TokenSet> {
    const stored = await this.db.query(
      'SELECT tokens FROM user_tokens WHERE user_id = $1 AND provider = $2',
      [userId, 'google']
    );
    
    if (!stored) return null;
    
    // Decrypt tokens
    return {
      access_token: await this.encryption.decrypt(stored.tokens.access_token),
      refresh_token: await this.encryption.decrypt(stored.tokens.refresh_token),
      expiry_date: stored.tokens.expiry_date,
      scope: stored.tokens.scope
    };
  }
}
```

### Scope Management
```typescript
const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

class ScopeValidator {
  validateScopes(grantedScopes: string[]): boolean {
    const granted = new Set(grantedScopes.split(' '));
    return REQUIRED_SCOPES.every(scope => granted.has(scope));
  }
  
  getMissingScopes(grantedScopes: string[]): string[] {
    const granted = new Set(grantedScopes.split(' '));
    return REQUIRED_SCOPES.filter(scope => !granted.has(scope));
  }
}
```

## Rate Limiting & Quotas

### Gmail API Limits
- 250 quota units per user per second
- 1,000,000,000 quota units per day
- Message send: 100 quota units
- Message list: 5 quota units

### Calendar API Limits
- 500 requests per 100 seconds per user
- 1,000,000 requests per day

### Rate Limiter Implementation
```typescript
class GoogleAPIRateLimiter {
  private limits = {
    gmail: { perSecond: 250, perDay: 1000000000 },
    calendar: { perSecond: 5, perDay: 1000000 }
  };
  
  async checkLimit(service: string, units: number): Promise<boolean> {
    const usage = await this.getUsage(service);
    
    if (usage.perSecond + units > this.limits[service].perSecond) {
      await this.delay(1000);
      return this.checkLimit(service, units);
    }
    
    if (usage.perDay + units > this.limits[service].perDay) {
      throw new Error(`Daily quota exceeded for ${service}`);
    }
    
    await this.recordUsage(service, units);
    return true;
  }
}
```

## Error Handling

### Retry Strategy
```typescript
class GoogleAPIRetry {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3
  ): Promise<T> {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Check if retryable
        if (this.isRetryable(error)) {
          const delay = this.getRetryDelay(error, i);
          await this.sleep(delay);
        } else {
          throw error;
        }
      }
    }
    
    throw lastError;
  }
  
  private isRetryable(error: any): boolean {
    // Rate limit errors
    if (error.code === 429) return true;
    
    // Temporary server errors
    if (error.code >= 500) return true;
    
    // Network errors
    if (error.code === 'ECONNRESET') return true;
    
    return false;
  }
  
  private getRetryDelay(error: any, attempt: number): number {
    // Exponential backoff with jitter
    const baseDelay = Math.pow(2, attempt) * 1000;
    const jitter = Math.random() * 1000;
    
    // Check for Retry-After header
    if (error.response?.headers?.['retry-after']) {
      return parseInt(error.response.headers['retry-after']) * 1000;
    }
    
    return baseDelay + jitter;
  }
}
```
