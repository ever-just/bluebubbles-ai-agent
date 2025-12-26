import dotenv from 'dotenv';
import path from 'path';
import { AppConfig } from '../types';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Validate required environment variables
const requiredEnvVars = [
  'ANTHROPIC_API_KEY',
  'BLUEBUBBLES_URL',
  'BLUEBUBBLES_PASSWORD',
  'DATABASE_URL',
  'REDIS_URL',
  'ENCRYPTION_KEY',
  'SESSION_SECRET'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  environment: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
  
  database: {
    url: process.env.DATABASE_URL!,
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '10', 10),
    ssl: process.env.DB_SSL === 'true'
  },
  
  redis: {
    url: process.env.REDIS_URL!,
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10)
  },
  
  bluebubbles: {
    url: process.env.BLUEBUBBLES_URL!,
    password: process.env.BLUEBUBBLES_PASSWORD!,
    pollInterval: parseInt(process.env.BLUEBUBBLES_POLL_INTERVAL || '5000', 10),
    timeout: parseInt(process.env.BLUEBUBBLES_TIMEOUT || '30000', 10),
    sendEnabled: process.env.BLUEBUBBLES_SEND_ENABLED !== 'false',
    markChatsRead: parseBoolean(process.env.BLUEBUBBLES_MARK_CHATS_READ, true)
  },
  
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096', 10),
    temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE || '0.7'),
    requestLimitPerMinute: parseInt(process.env.ANTHROPIC_REQUESTS_PER_MINUTE || '50', 10),
    inputTokenLimitPerMinute: parseInt(process.env.ANTHROPIC_INPUT_TOKENS_PER_MINUTE || '50000', 10),
    outputTokenLimitPerMinute: parseInt(process.env.ANTHROPIC_OUTPUT_TOKENS_PER_MINUTE || '10000', 10),
    maxConcurrentRequests: parseInt(process.env.ANTHROPIC_MAX_CONCURRENT_REQUESTS || '2', 10),
    summaryTriggerTokens: parseInt(process.env.ANTHROPIC_SUMMARY_TRIGGER_TOKENS || '4000', 10),
    contextWindowTokens: parseInt(process.env.ANTHROPIC_CONTEXT_WINDOW_TOKENS || '6000', 10),
    responseMaxTokens: parseInt(process.env.ANTHROPIC_RESPONSE_MAX_TOKENS || '350', 10),
    enableWebSearch: parseBoolean(process.env.ANTHROPIC_ENABLE_WEB_SEARCH, true),
    webSearchMaxUses: parseInt(process.env.ANTHROPIC_WEB_SEARCH_MAX_USES || '5', 10),
    enableWebFetch: parseBoolean(process.env.ANTHROPIC_ENABLE_WEB_FETCH, false),
    webFetchMaxUses: parseInt(process.env.ANTHROPIC_WEB_FETCH_MAX_USES || '3', 10),
    webFetchBetaHeader: process.env.ANTHROPIC_WEB_FETCH_BETA_HEADER || 'web-fetch-2025-09-10'
  },
  
  logging: {
    level: (process.env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug',
    format: (process.env.LOG_FORMAT || 'json') as 'json' | 'simple',
    outputPath: process.env.LOG_OUTPUT_PATH
  },
  
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY!,
    sessionSecret: process.env.SESSION_SECRET!,
    rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10)
  },

  messaging: {
    typingIndicators: parseBoolean(process.env.TYPING_INDICATORS_ENABLED, false), // Disabled - causes stuck typing indicator issues
    typingIndicatorDurationMs: parseInt(process.env.TYPING_INDICATOR_DURATION_MS || '5000', 10),
    maxResponseBurst: parseInt(process.env.MAX_RESPONSE_BURST || '3', 10),
    responseBurstDelayMs: parseInt(process.env.RESPONSE_BURST_DELAY_MS || '200', 10)
  },

  agents: {
    enableDualAgent: parseBoolean(process.env.ENABLE_DUAL_AGENT, false),
    executionTimeoutSeconds: parseInt(process.env.AGENT_EXECUTION_TIMEOUT_SECONDS || '90', 10),
    maxToolIterations: parseInt(process.env.AGENT_MAX_TOOL_ITERATIONS || '8', 10)
  },

  agentmail: {
    apiKey: process.env.AGENTMAIL_API_KEY || '',
    enabled: parseBoolean(process.env.AGENTMAIL_ENABLED, false),
    defaultDomain: process.env.AGENTMAIL_DEFAULT_DOMAIN || 'agentmail.to',
    webhookSecret: process.env.AGENTMAIL_WEBHOOK_SECRET
  }
};

export default config;
