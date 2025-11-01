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
  private chatGuidCache = new Map<string, { guid: string; cachedAt: number }>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

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
    if (!chatGuid) {
      throw new Error('Chat GUID is required to send a message');
    }

    if (this.socket && this.isConnected) {
      try {
        await this.sendMessageViaSocket(chatGuid, text, attachments);
        return;
      } catch (error) {
        logWarn('Socket send failed; attempting REST fallback', {
          chatGuid,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    await this.sendMessageViaRest(chatGuid, text, attachments);
  }

  async getChats(limit?: number, includeParticipants = true): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to BlueBubbles server'));
        return;
      }

      logDebug('Getting chats with limit', { limit, includeParticipants });
      this.socket.emit('get-chats', { limit, withParticipants: includeParticipants }, (response: any) => {
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

  private normalizeHandle(address: string): string {
    if (!address) {
      return '';
    }

    return address.replace(/\D+/g, '');
  }

  async findChatGuidByHandle(handleAddress: string): Promise<string | null> {
    if (!handleAddress) {
      return null;
    }

    const normalized = this.normalizeHandle(handleAddress);
    if (!normalized) {
      return null;
    }

    const cached = this.chatGuidCache.get(normalized);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      logDebug('Resolved chat guid from cache', { handleAddress, guid: cached.guid });
      return cached.guid;
    }

    if (!this.isConnected) {
      logWarn('Cannot resolve chat guid - BlueBubbles socket not connected');
      return null;
    }

    try {
      const chats = await this.getChats(undefined, true);
      for (const chat of chats) {
        const guid: string | undefined = chat?.guid || chat?.chat_guid;
        if (!guid) {
          continue;
        }

        const chatIdentifier: string | undefined = chat?.chatIdentifier || chat?.chat_identifier;
        if (chatIdentifier) {
          const identifierDigits = this.normalizeHandle(chatIdentifier.includes(';-;') ? chatIdentifier.split(';-;').pop() ?? chatIdentifier : chatIdentifier);
          if (identifierDigits && identifierDigits === normalized) {
            this.chatGuidCache.set(normalized, { guid, cachedAt: Date.now() });
            return guid;
          }
        }

        const chatGuidDigits = this.normalizeHandle(guid.includes(';-;') ? guid.split(';-;').pop() ?? guid : guid);
        if (chatGuidDigits && chatGuidDigits === normalized) {
          this.chatGuidCache.set(normalized, { guid, cachedAt: Date.now() });
          return guid;
        }

        const participants = Array.isArray(chat?.participants)
          ? chat.participants
          : (Array.isArray(chat?.handles) ? chat.handles : null);

        if (participants) {
          for (const participant of participants) {
            const participantAddress: string | undefined = participant?.address
              || participant?.contact
              || participant?.identifier;

            const participantDigits = this.normalizeHandle(String(participantAddress));
            if (participantDigits && participantDigits === normalized) {
              this.chatGuidCache.set(normalized, { guid, cachedAt: Date.now() });
              return guid;
            }
          }
        }
      }

      logWarn('Unable to resolve chat guid from BlueBubbles chats', { handleAddress });
      return null;
    } catch (error) {
      logWarn('Failed to fetch chats for guid resolution', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private async sendMessageViaSocket(chatGuid: string, text: string, attachments?: any[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.isConnected) {
        reject(new Error('Not connected to BlueBubbles server'));
        return;
      }

      logInfo('Sending message via WebSocket', {
        chatGuid,
        textLength: text.length,
        hasAttachments: attachments?.length ?? 0
      });

      let completed = false;

      const finalize = (error?: Error | string) => {
        if (completed) {
          return;
        }
        completed = true;
        if (error) {
          reject(typeof error === 'string' ? new Error(error) : error);
        } else {
          logInfo('Message sent successfully via WebSocket', { chatGuid });
          resolve();
        }
      };

      this.socket.emit(
        'send-message',
        {
          chatGuid,
          message: text,
          attachments
        },
        (response: any) => {
          if (response?.error) {
            logWarn('BlueBubbles socket send reported error', { chatGuid, response });
            finalize(typeof response.error === 'string' ? response.error : 'Socket send failed');
          } else {
            finalize();
          }
        }
      );

      setTimeout(() => finalize(), 750);
    });
  }

  private async sendMessageViaRest(chatGuid: string, text: string, attachments?: any[]): Promise<void> {
    const url = `${this.apiUrl}/api/v1/message/text?password=${encodeURIComponent(this.password)}`;

    const attemptSend = async (method: 'private-api' | 'apple-script') => {
      logInfo('Sending message via REST API', {
        chatGuid,
        textLength: text.length,
        hasAttachments: attachments?.length ?? 0,
        method
      });

      const payload: Record<string, unknown> = {
        chatGuid,
        message: text,
        method,
        tempGuid: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      };

      if (attachments && attachments.length > 0) {
        payload.attachments = attachments;
      }

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.status === 200) {
        logInfo('Message sent successfully via REST API', {
          chatGuid,
          response: response.data.message,
          method
        });
        return true;
      }

      throw new Error(`Failed to send message: ${response.data?.message || 'Unknown error'}`);
    };

    try {
      await attemptSend('private-api');
    } catch (privateApiError: any) {
      logWarn('Private API REST send failed; attempting AppleScript fallback', {
        chatGuid,
        error: privateApiError instanceof Error ? privateApiError.message : String(privateApiError)
      });

      try {
        await attemptSend('apple-script');
      } catch (appleScriptError: any) {
        logError('Failed to send message via REST API (all methods)', appleScriptError, {
          chatGuid
        });
        throw appleScriptError instanceof Error ? appleScriptError : new Error(String(appleScriptError));
      }
    }
  }
}
