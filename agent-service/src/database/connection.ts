import { DataSource } from 'typeorm';
import { config } from '../config';
import { logInfo, logError } from '../utils/logger';
import { User } from './entities/User';
import { Conversation } from './entities/Conversation';
import { Message } from './entities/Message';
import { ContextMemory } from './entities/ContextMemory';
import { Reminder } from './entities/Reminder';
import { CalendarEvent } from './entities/CalendarEvent';
import { OAuthToken } from './entities/OAuthToken';
import { Trigger } from './entities/Trigger';
import { ExecutionAgentLog } from './entities/ExecutionAgentLog';
import { WorkingMemoryState } from './entities/WorkingMemoryState';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: config.database.url,
  synchronize: config.environment === 'development', // Auto-sync in dev only
  logging: config.environment === 'development',
  entities: [
    User,
    Conversation,
    Message,
    ContextMemory,
    Reminder,
    CalendarEvent,
    OAuthToken,
    Trigger,
    ExecutionAgentLog,
    WorkingMemoryState
  ],
  migrations: ['src/database/migrations/*.ts'],
  subscribers: ['src/database/subscribers/*.ts'],
  poolSize: config.database.maxConnections,
  ssl: config.database.ssl ? { rejectUnauthorized: false } : false
});

export const initializeDatabase = async (): Promise<void> => {
  try {
    await AppDataSource.initialize();
    logInfo('Database connection established successfully');
    
    // Run pending migrations in production
    if (config.environment === 'production') {
      await AppDataSource.runMigrations();
      logInfo('Database migrations completed');
    }
  } catch (error) {
    logError('Failed to connect to database', error);
    throw error;
  }
};

export const closeDatabase = async (): Promise<void> => {
  try {
    await AppDataSource.destroy();
    logInfo('Database connection closed');
  } catch (error) {
    logError('Error closing database connection', error);
  }
};

export default AppDataSource;
