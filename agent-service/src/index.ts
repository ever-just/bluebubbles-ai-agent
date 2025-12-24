import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import Bull from 'bull';
import { initializeDatabase, closeDatabase } from './database/connection';
import { BlueBubblesMessage } from './types';
import { getMessageRouter, MessageRouter } from './services/MessageRouter';
import { getReminderService } from './services/ReminderService';
import { getContextService } from './services/ContextService';
import { startTriggerScheduler, stopTriggerScheduler } from './services/TriggerScheduler';
import { logInfo, logError, logWarn, logDebug } from './utils/logger';
import { config } from './config';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

// Global reference to message router for health checks
let globalMessageRouter: MessageRouter | null = null;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logInfo(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// ==================== API ENDPOINTS ====================

// Enhanced manual message injection for testing
app.post('/api/inject-message', async (req, res) => {
  try {
    const { text, phoneNumber, chatId } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    // Create a realistic BlueBubbles message
    const bbMessage: BlueBubblesMessage = {
      guid: `manual-${Date.now()}`,
      text: text,
      handle_id: 1,
      service: 'iMessage',
      is_from_me: false,
      date: Date.now(),
      chat_id: chatId || `manual-chat-${Date.now()}`,
      attachments: [],
      handle: {
        id: 1,
        identifier: phoneNumber || '+16518959089',
        address: phoneNumber || '+16518959089',
        service: 'iMessage'
      }
    };

    console.log('📨 INJECTING MANUAL MESSAGE:', {
      text: bbMessage.text,
      phone: bbMessage.handle?.address,
      chatId: bbMessage.chat_id
    });

    if (globalMessageRouter) {
      await globalMessageRouter.handleIncomingMessage(bbMessage);
      return res.json({
        success: true,
        message: 'Message processed through full AI pipeline',
        data: {
          text: bbMessage.text,
          phoneNumber: bbMessage.handle?.address,
          chatId: bbMessage.chat_id,
          aiProcessing: 'complete'
        }
      });
    }

    return res.status(500).json({ error: 'Message router not available' });
  } catch (error) {
    logError('Manual message injection failed', error);
    res.status(500).json({ error: 'Failed to inject message' });
    return;
  }
});

// Test endpoint for manual message processing
app.post('/api/test-message', async (req, res) => {
  try {
    const { text, chatId } = req.body;
    const testMessage: BlueBubblesMessage = {
      guid: `test-${Date.now()}`,
      text: text || 'Test message from API',
      handle_id: 1,
      service: 'iMessage',
      is_from_me: false,
      date: Date.now(),
      chat_id: chatId || 'test-chat',
      attachments: [],
      handle: {
        id: 1,
        identifier: '+16518959089',
        address: '+16518959089',
        service: 'iMessage'
      }
    };

    if (globalMessageRouter) {
      await globalMessageRouter.handleIncomingMessage(testMessage);
      res.json({ success: true, message: 'Test message processed' });
    } else {
      res.status(500).json({ error: 'Message router not initialized' });
    }
  } catch (error) {
    logError('Test message processing failed', error);
    res.status(500).json({ error: 'Failed to process test message' });
  }
});

// Webhook endpoint for BlueBubbles message events
app.post('/webhook/messages', async (req, res) => {
  console.log('🔔 WEBHOOK HIT: /webhook/messages endpoint called');
  console.log('🔔 REQUEST BODY KEYS:', Object.keys(req.body || {}));
  console.log('🔔 REQUEST BODY TYPE:', typeof req.body);
  console.log('🔗 WEBHOOK RECEIVED:', JSON.stringify(req.body, null, 2));
  try {
    const { data, type } = req.body;

    if (type === 'new-message' && data) {
      // Log ALL fields to debug is_from_me detection
      logInfo('Received webhook message', {
        guid: data.guid,
        text: data.text?.substring(0, 120),
        chatId: data.chat_id || data.chat_guid || data.chatGuid,
        rawKeys: Object.keys(data),
        // Explicitly log all possible isFromMe field variations
        is_from_me_raw: data.is_from_me,
        isFromMe_raw: data.isFromMe,
        sender_isFromMe: data.sender?.isFromMe,
        handle_address: data.handle?.address
      });

      const rawIsFromMe =
        data.is_from_me ??
        data.isFromMe ??
        data.is_me ??
        data.isMe ??
        data.sender?.is_from_me ??
        data.sender?.isFromMe;

      const isFromMe = (() => {
        if (typeof rawIsFromMe === 'boolean') return rawIsFromMe;
        if (typeof rawIsFromMe === 'number') return rawIsFromMe !== 0;
        if (typeof rawIsFromMe === 'string') {
          const normalized = rawIsFromMe.trim().toLowerCase();
          return normalized === 'true' || normalized === '1' || normalized === 'yes';
        }
        return false;
      })();

      logInfo('Webhook is_from_me evaluation', {
        guid: data.guid,
        rawIsFromMe,
        rawType: typeof rawIsFromMe,
        interpreted: isFromMe,
        textPreview: data.text?.substring(0, 60)
      });

      if (isFromMe) {
        logInfo('✅ FILTERED: Ignoring self-sent BlueBubbles webhook message', {
          guid: data.guid,
          textPreview: data.text?.substring(0, 60),
          is_from_me: isFromMe
        });
        return res.json({ success: true, message: 'Ignored self-sent message' });
      }

      const chatGuidCandidates: Array<string | null | undefined> = [
        data.chat_id,
        data.chat_guid,
        data.chatGuid,
        data.chat?.guid
      ];

      if (Array.isArray(data.chats)) {
        for (const chat of data.chats) {
          if (!chat) continue;
          chatGuidCandidates.push(chat.guid, chat.chat_guid, chat.chatGuid);
        }
      }

      const resolvedChatId = chatGuidCandidates.find(candidate => typeof candidate === 'string' && candidate.trim().length > 0) || undefined;

      if (!resolvedChatId) {
        logWarn('Webhook message missing chat guid - downstream reply may fail', {
          guid: data.guid,
          chatGuidCandidates: chatGuidCandidates.filter(candidate => candidate != null)
        });
      }

      // Convert webhook message format to BlueBubblesMessage format
      const bbMessage: BlueBubblesMessage = {
        guid: data.guid,
        text: data.text,
        handle_id: data.handle_id ?? data.handleId ?? data.handle?.id,
        service: data.service || 'iMessage',
        is_from_me: isFromMe,
        date: data.date,
        chat_id: resolvedChatId,
        attachments: data.attachments || [],
        handle: data.handle ? {
          id: data.handle.id,
          identifier: data.handle.identifier,
          address: data.handle.address,
          service: data.handle.service || 'iMessage'
        } : data.sender ? {
          id: data.sender.id,
          identifier: data.sender.identifier,
          address: data.sender.address,
          service: data.sender.service || 'iMessage'
        } : undefined
      };

      console.log('🔗 CONVERTED MESSAGE:', {
        guid: bbMessage.guid,
        text: bbMessage.text,
        chat_id: bbMessage.chat_id,
        handle_address: bbMessage.handle?.address
      });

      if (globalMessageRouter) {
        await globalMessageRouter.handleIncomingMessage(bbMessage);
        return res.json({ success: true, message: 'Message processed' });
      } else {
        logError('Message router not initialized for webhook');
        return res.status(500).json({ error: 'Message router not available' });
      }
    } else {
      console.log('🔗 WEBHOOK IGNORED: not a new-message event');
      return res.json({ success: true, message: 'Ignored non-message event' });
    }
  } catch (error) {
    logError('Webhook processing failed', error);
    return res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const dbHealthy = await checkDatabaseHealth();
    const redisHealthy = await checkRedisHealth();
    const bluebubblesHealthy = await checkBlueBubblesHealth();
    
    const status = {
      status: dbHealthy && redisHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'connected' : 'disconnected',
        redis: redisHealthy ? 'connected' : 'disconnected',
        bluebubbles: bluebubblesHealthy ? 'connected' : 'disconnected',
      }
    };
    
    res.status(status.status === 'healthy' ? 200 : 503).json(status);
  } catch (error: any) {
    res.status(503).json({ 
      status: 'error', 
      error: error.message 
    });
  }
});

// BlueBubbles webhook endpoint
app.post('/webhook/bluebubbles', async (req, res) => {
  try {
    logInfo('Received BlueBubbles webhook', { body: req.body });
    
    const messageRouter = await getMessageRouter();
    // Process the webhook message
    if (req.body.message) {
      await messageRouter.handleIncomingMessage(req.body.message);
    }
    
    res.json({ success: true });
  } catch (error) {
    logError('Error processing BlueBubbles webhook', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ==================== HELPER FUNCTIONS ====================

async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const { AppDataSource } = await import('./database/connection');
    return AppDataSource.isInitialized;
  } catch (error) {
    return false;
  }
}

async function checkRedisHealth(): Promise<boolean> {
  try {
    const queue = new Bull('health-check', {
      redis: {
        port: 6379,
        host: new URL(config.redis.url).hostname,
        password: new URL(config.redis.url).password
      }
    });
    await queue.isReady();
    await queue.close();
    return true;
  } catch (error) {
    return false;
  }
}

async function checkBlueBubblesHealth(): Promise<boolean> {
  try {
    if (!globalMessageRouter) {
      return false;
    }
    // Check if the BlueBubbles client is connected
    return globalMessageRouter.isBlueBubblesConnected();
  } catch (error) {
    return false;
  }
}

// ==================== SERVER INITIALIZATION ====================

async function startServer() {
  try {
    // Connect to database
    await initializeDatabase();
    logInfo('Database connected successfully');
    
    // Initialize MessageRouter (which handles BlueBubbles)
    const messageRouter = await getMessageRouter();
    globalMessageRouter = messageRouter;
    try {
      await messageRouter.initialize();
    } catch (error) {
      logWarn('BlueBubbles connection failed - server will run without iMessage support', error);
      // Continue without BlueBubbles - the server can still handle API requests
    }
    
    // Initialize context service
    const contextService = getContextService();
    
    // Schedule periodic cleanup of expired memories
    setInterval(async () => {
      await contextService.cleanupExpiredMemories();
    }, 60 * 60 * 1000); // Every hour

    // Start trigger scheduler for proactive agent execution
    startTriggerScheduler();
    logInfo('Trigger scheduler started');
    
    // Start HTTP server
    const PORT = config.port;
    httpServer.listen(PORT, () => {
      logInfo(`🚀 Server running on port ${PORT}`);
      logInfo(`📝 Environment: ${config.environment}`);
      logInfo(`🔗 BlueBubbles URL: ${config.bluebubbles.url}`);
    });
  } catch (error) {
    logError('Failed to start server', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logWarn('Shutting down gracefully...');
  
  // Stop trigger scheduler
  stopTriggerScheduler();
  
  httpServer.close(() => {
    logInfo('HTTP server closed');
  });
  
  await closeDatabase();
  
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  logError('Unhandled Rejection at:', { promise, reason });
});

// Start the server
startServer();

// Export for testing
export { app, io };
