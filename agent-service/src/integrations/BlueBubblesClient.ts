import { io, Socket } from 'socket.io-client';
import { EventEmitter } from 'events';
import axios from 'axios';
import { logInfo, logError, logWarn, logDebug } from '../utils/logger';
import { BlueBubblesMessage, BlueBubblesChat, BlueBubblesHandle, ServiceResponse } from '../types';
import { config } from '../config';

export class BlueBubblesClient extends EventEmitter {
  private socket: Socket | null = null;
  private apiUrl: string;
  private password: string;
  private reconnectAttempts = 0;
  private isConnected = false;
  private reconnectMaxAttempts: number;
  private reconnectDelay: number;

  constructor() {
    super();
    this.apiUrl = config.bluebubbles.url;
    this.password = config.bluebubbles.password;
    this.reconnectMaxAttempts = 10;
    this.reconnectDelay = 1000;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logInfo('Connecting to BlueBubbles server...', { url: this.apiUrl });
        
        this.socket = io(this.apiUrl, {
          auth: {
            password: this.password
          },
          reconnection: true,
          reconnectionAttempts: this.reconnectMaxAttempts,
          reconnectionDelay: this.reconnectDelay,
          reconnectionDelayMax: 5000,
          timeout: 20000
        });

        this.setupListeners();

        this.socket.on('connect', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          logInfo('Connected to BlueBubbles server');
          this.emit('connected');
          resolve();
        });

        this.socket.on('connect_error', (error) => {
          logError('BlueBubbles connection error', error);
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });
      } catch (error) {
        logError('Failed to connect to BlueBubbles', error);
        reject(error);
      }
    });
  }

  private setupListeners(): void {
    if (!this.socket) return;

    // Message events
    this.socket.on('new-message', (data: BlueBubblesMessage) => {
      logInfo('New message received', { guid: data.guid });
      this.emit('message', data);
    });

    this.socket.on('updated-message', (data: BlueBubblesMessage) => {
      logInfo('Message updated', { guid: data.guid });
      this.emit('message-updated', data);
    });

    // Connection events
    this.socket.on('disconnect', () => {
      this.isConnected = false;
      logWarn('Disconnected from BlueBubbles server');
      this.emit('disconnected');
    });

    this.socket.on('reconnect', (attemptNumber: number) => {
      this.reconnectAttempts = attemptNumber;
      logInfo(`Reconnected after ${attemptNumber} attempts`);
      this.emit('reconnected');
    });

    this.socket.on('reconnect_attempt', (attemptNumber: number) => {
      logDebug(`Reconnection attempt ${attemptNumber}`);
    });

    // Error handling
    this.socket.on('error', (error: Error) => {
      logError('Socket error', error);
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
          logError('Failed to send message', new Error(response.error));
          reject(new Error(response.error));
        } else {
          logInfo('Message sent successfully');
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

  async getChatMessages(chatGuid: string, limit = 50): Promise<BlueBubblesMessage[]> {
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
      logInfo('Disconnected from BlueBubbles server');
    }
  }

  isConnectedStatus(): boolean {
    return this.isConnected;
  }
}
