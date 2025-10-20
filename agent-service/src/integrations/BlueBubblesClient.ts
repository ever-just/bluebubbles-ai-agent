import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';
import winston from 'winston';

interface BlueBubblesConfig {
  url: string;
  password: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

interface Message {
  guid: string;
  text: string;
  chatGuid: string;
  isFromMe: boolean;
  dateCreated: number;
  attachments?: any[];
}

export class BlueBubblesClient extends EventEmitter {
  private socket: Socket | null = null;
  private config: BlueBubblesConfig;
  private logger: winston.Logger;
  private reconnectAttempts = 0;
  private isConnected = false;

  constructor(config: BlueBubblesConfig) {
    super();
    this.config = config;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      defaultMeta: { service: 'bluebubbles-client' },
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.logger.info('Connecting to BlueBubbles server...');
        
        this.socket = io(this.config.url, {
          auth: {
            password: this.config.password
          },
          reconnection: true,
          reconnectionAttempts: this.config.reconnectAttempts || 10,
          reconnectionDelay: this.config.reconnectDelay || 1000,
          reconnectionDelayMax: 5000,
          timeout: 20000
        });

        this.setupListeners();

        this.socket.on('connect', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.logger.info('Connected to BlueBubbles server');
          this.emit('connected');
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          this.logger.error('Connection error:', error.message);
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });
      } catch (error) {
        this.logger.error('Failed to connect:', error);
        reject(error);
      }
    });
  }

  private setupListeners(): void {
    if (!this.socket) return;

    // Message events
    this.socket.on('new-message', (data: Message) => {
      this.logger.info('New message received:', data.guid);
      this.emit('message', data);
    });

    this.socket.on('updated-message', (data: Message) => {
      this.logger.info('Message updated:', data.guid);
      this.emit('message-updated', data);
    });

    // Connection events
    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.logger.warn('Disconnected from BlueBubbles server');
      this.emit('disconnected');
    });

    this.socket.on('reconnect', (attemptNumber: number) => {
      this.reconnectAttempts = attemptNumber;
      this.logger.info(`Reconnected after ${attemptNumber} attempts`);
      this.emit('reconnected');
    });

    this.socket.on('reconnect_attempt', (attemptNumber: number) => {
      this.logger.info(`Reconnection attempt ${attemptNumber}`);
    });

    // Error handling
    this.socket.on('error', (error: Error) => {
      this.logger.error('Socket error:', error);
      this.emit('error', error);
    });
  }

  async sendMessage(chatGuid: string, text: string, attachments?: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to BlueBubbles server'));
        return;
      }

      this.socket.emit('send-message', {
        chatGuid,
        message: text,
        attachments
      }, (response: any) => {
        if (response.error) {
          this.logger.error('Failed to send message:', response.error);
          reject(new Error(response.error));
        } else {
          this.logger.info('Message sent successfully');
          resolve();
        }
      });
    });
  }

  async getChats(limit?: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to BlueBubbles server'));
        return;
      }

      this.socket.emit('get-chats', { limit }, (response: any) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.data);
        }
      });
    });
  }

  async getChatMessages(chatGuid: string, limit = 50): Promise<Message[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to BlueBubbles server'));
        return;
      }

      this.socket.emit('get-chat-messages', {
        chatGuid,
        limit
      }, (response: any) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.data);
        }
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.logger.info('Disconnected from BlueBubbles server');
    }
  }

  isConnectedStatus(): boolean {
    return this.isConnected;
  }
}
