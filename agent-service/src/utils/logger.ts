import winston from 'winston';
import path from 'path';
import { config } from '../config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  config.logging.format === 'json' 
    ? winston.format.json() 
    : winston.format.printf(({ timestamp, level, message, ...metadata }) => {
        let msg = `${timestamp} [${level}] : ${message} `;
        if (Object.keys(metadata).length > 0) {
          msg += JSON.stringify(metadata);
        }
        return msg;
      })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    level: config.logging.level,
    handleExceptions: true
  })
];

// Add file transport if path is specified
if (config.logging.outputPath) {
  transports.push(
    new winston.transports.File({
      filename: path.join(config.logging.outputPath, 'error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join(config.logging.outputPath, 'combined.log')
    })
  );
}

const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
  exitOnError: false
});

export default logger;

// Utility functions for structured logging
export const logInfo = (message: string, metadata?: any) => {
  logger.info(message, metadata);
};

export const logError = (message: string, error?: Error | any, metadata?: any) => {
  logger.error(message, { 
    error: error?.message || error, 
    stack: error?.stack,
    ...metadata 
  });
};

export const logWarn = (message: string, metadata?: any) => {
  logger.warn(message, metadata);
};

export const logDebug = (message: string, metadata?: any) => {
  logger.debug(message, metadata);
};
