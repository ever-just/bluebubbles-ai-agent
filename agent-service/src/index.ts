import dotenv from 'dotenv';
import express from 'express';
import { BlueBubblesClient } from './integrations/BlueBubblesClient';
import winston from 'winston';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'agent-service' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Initialize Express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      bluebubbles: blueBubbles?.isConnectedStatus() || false
    }
  });
});

// Initialize BlueBubbles client
let blueBubbles: BlueBubblesClient | null = null;

async function initializeBlueBubbles() {
  try {
    blueBubbles = new BlueBubblesClient({
      url: process.env.BLUEBUBBLES_URL || 'http://localhost:1234',
      password: process.env.BLUEBUBBLES_PASSWORD || ''
    });

    // Set up message handler
    blueBubbles.on('message', async (message) => {
      logger.info('Received message:', {
        guid: message.guid,
        text: message.text,
        chatGuid: message.chatGuid,
        isFromMe: message.isFromMe
      });

      // TODO: Process message with Claude Agent SDK
      if (!message.isFromMe) {
        // This is where you'll integrate Claude
        await handleIncomingMessage(message);
      }
    });

    blueBubbles.on('connected', () => {
      logger.info('BlueBubbles connected successfully');
    });

    blueBubbles.on('disconnected', () => {
      logger.warn('BlueBubbles disconnected');
    });

    blueBubbles.on('error', (error) => {
      logger.error('BlueBubbles error:', error);
    });

    await blueBubbles.connect();
  } catch (error) {
    logger.error('Failed to initialize BlueBubbles:', error);
    // Continue running even if BlueBubbles fails initially
  }
}

async function handleIncomingMessage(message: any) {
  try {
    logger.info('Processing incoming message...');
    
    // TODO: Implement these steps
    // 1. Load user context
    // 2. Process with Claude Agent SDK
    // 3. Send response back
    
    // For now, just echo back
    if (blueBubbles) {
      await blueBubbles.sendMessage(
        message.chatGuid,
        `Echo: ${message.text}`
      );
    }
  } catch (error) {
    logger.error('Failed to handle message:', error);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Initialize BlueBubbles connection
    await initializeBlueBubbles();

    // Start Express server
    app.listen(PORT, () => {
      logger.info(`Agent service running on port ${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.error('Failed to start agent service:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing connections');
  if (blueBubbles) {
    blueBubbles.disconnect();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing connections');
  if (blueBubbles) {
    blueBubbles.disconnect();
  }
  process.exit(0);
});

// Start the application
start();
