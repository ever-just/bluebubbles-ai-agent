import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import Bull from 'bull';
import { initializeDatabase, closeDatabase } from './database/connection';
import { getMessageRouter } from './services/MessageRouter';
import { getReminderService } from './services/ReminderService';
import { getContextService } from './services/ContextService';
import { logInfo, logError, logWarn } from './utils/logger';
import { config } from './config';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

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

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const dbHealthy = await checkDatabaseHealth();
    const redisHealthy = await checkRedisHealth();
    
    const status = {
      status: dbHealthy && redisHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'connected' : 'disconnected',
        redis: redisHealthy ? 'connected' : 'disconnected',
        bluebubbles: 'pending'
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

// ==================== SERVER INITIALIZATION ====================

async function startServer() {
  try {
    // Connect to database
    await initializeDatabase();
    logInfo('Database connected successfully');
    
    // Initialize message router (which connects to BlueBubbles)
    const messageRouter = await getMessageRouter();
    logInfo('Message router initialized');
    
    // Initialize context service
    const contextService = getContextService();
    
    // Schedule periodic cleanup of expired memories
    setInterval(async () => {
      await contextService.cleanupExpiredMemories();
    }, 60 * 60 * 1000); // Every hour
    
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
