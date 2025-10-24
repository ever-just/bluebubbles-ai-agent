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
        
        this.socket = io(`${this.apiUrl}?password=${encodeURIComponent(this.password)}`, {
          auth: undefined,
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
          
          // Subscribe to message events after connection
          this.subscribeToMessages(); // Re-enabled for testing
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

    // Debug: Listen for ALL events
    this.socket.onAny((eventName, ...args) => {
      logDebug(`WebSocket event received: ${eventName}`, { args: JSON.stringify(args, null, 2) });
    });

    // Message events
    this.socket.on('new-message', (data: BlueBubblesMessage) => {
      logInfo('New message received (new-message event)', { guid: data.guid });
      this.emit('message', data);
    });

    this.socket.on('message', (data: BlueBubblesMessage) => {
      logInfo('New message received (message event)', { guid: data.guid });
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

    // Test event emission
    setTimeout(() => {
      if (this.socket && this.isConnected) {
        logInfo('Testing WebSocket event emission...');
        this.socket.emit('ping', { timestamp: Date.now() }, (response: any) => {
          logInfo('Ping response received', { response });
        });
      }
    }, 2000);
  }

  private subscribeToMessages(): void {
    if (!this.socket || !this.isConnected) {
      logWarn('Cannot subscribe to messages - not connected');
      return;
    }

    logInfo('Testing post-connection authentication for message subscription...');

    // Only try post-connection authentication first
    setTimeout(() => {
      if (this.socket && this.isConnected) {
        logInfo('Sending post-connection authentication...');
        this.socket.emit('authenticate', { password: this.password }, (response: any) => {
          logInfo('Post-connection authentication response', { response });
        });
      }
    }, 2000);

    logInfo('Post-connection authentication scheduled');
  }

  async sendMessage(chatGuid: string, text: string, attachments?: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to BlueBubbles server'));
        return;
      }

      // Try sending without callback first
      console.log('📤 SENDING MESSAGE:', {
        chatGuid,
        textLength: text.length,
        textPreview: text.substring(0, 100),
        hasAttachments: attachments ? attachments.length : 0
      });
      logInfo('Sending message (no callback expected)', { chatGuid, textLength: text.length });
      this.socket.emit('send-message', {
        chatGuid,
        message: text,
        attachments
      });

      // Assume success after a short delay
      setTimeout(() => {
        logInfo('Message sent successfully (no callback)');
        resolve();
      }, 500);

    });
  }

  async getChats(limit?: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to BlueBubbles server'));
        return;
      }

      logDebug('Getting chats with limit', { limit });
      this.socket.emit('get-chats', { limit }, (response: any) => {
        logDebug('Get chats raw response', { response, type: typeof response });
        if (response && response.error) {
          logError('Failed to get chats', new Error(response.error));
          reject(new Error(response.error));
        } else if (response && typeof response === 'object' && response.data) {
          logInfo('Got chats successfully', { count: response.data.length });
          resolve(response.data);
        } else if (Array.isArray(response)) {
          logInfo('Got chats as array', { count: response.length });
          resolve(response);
        } else {
          logWarn('Unexpected get-chats response format', { response });
          // Assume response is the data array
          resolve(Array.isArray(response) ? response : []);
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

      logDebug('Getting chat messages', { chatGuid, limit });
      this.socket.emit('get-chat-messages', {
        chatGuid,
        limit
      }, (response: any) => {
        logInfo('Get chat messages raw response', {
          response,
          responseType: typeof response,
          responseKeys: response ? Object.keys(response) : 'null',
          responseString: JSON.stringify(response, null, 2)
        });
        if (response && response.error) {
          logError('Failed to get chat messages', new Error(response.error));
          reject(new Error(response.error));
        } else if (response && typeof response === 'object' && response.data) {
          logInfo('Got chat messages successfully', { count: response.data.length });
          resolve(response.data);
        } else if (Array.isArray(response)) {
          logInfo('Got chat messages as array', { count: response.length });
          resolve(response);
        } else {
          logWarn('Unexpected get-chat-messages response format', { response });
          // Assume response is the data array
          resolve(Array.isArray(response) ? response : []);
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
