import { Repository } from 'typeorm';
import { AppDataSource } from '../database/connection';
import { User } from '../database/entities/User';
import { Conversation } from '../database/entities/Conversation';
import { Message } from '../database/entities/Message';
import { BlueBubblesClient } from '../integrations/BlueBubblesClient';
import { ClaudeService, getClaudeService } from './ClaudeService';
import { ContextService, getContextService } from './ContextService';
import { ReminderService } from './ReminderService';
import { logInfo, logError, logDebug } from '../utils/logger';
import { ServiceResponse, BlueBubblesMessage, ClaudeMessage } from '../types';

export class MessageRouter {
  private userRepo: Repository<User>;
  private conversationRepo: Repository<Conversation>;
  private messageRepo: Repository<Message>;
  private blueBubblesClient: BlueBubblesClient;
  private claudeService: ClaudeService;
  private contextService: ContextService;
  private reminderService: ReminderService;

  constructor() {
    this.userRepo = AppDataSource.getRepository(User);
    this.conversationRepo = AppDataSource.getRepository(Conversation);
    this.messageRepo = AppDataSource.getRepository(Message);
    this.blueBubblesClient = new BlueBubblesClient();
    this.claudeService = getClaudeService();
    this.contextService = getContextService();
    this.reminderService = new ReminderService();
  }

  async initialize(): Promise<void> {
    // Connect to BlueBubbles
    await this.blueBubblesClient.connect();
    
    // Set up message listeners
    this.blueBubblesClient.on('message', async (message: BlueBubblesMessage) => {
      await this.handleIncomingMessage(message);
    });

    logInfo('Message router initialized');
  }

  async handleIncomingMessage(bbMessage: BlueBubblesMessage): Promise<void> {
    try {
      logInfo('Processing incoming message', { 
        guid: bbMessage.guid,
        chat: bbMessage.chat_id 
      });

      // Skip if message is from the AI (sent by us)
      if (bbMessage.is_from_me) {
        logDebug('Skipping self-sent message');
        return;
      }

      // Get or create user based on chat identifier
      const user = await this.getOrCreateUserFromChat(bbMessage.chat_id);
      if (!user) {
        logError('Failed to identify user from message');
        return;
      }

      // Get or create conversation
      const conversation = await this.getOrCreateConversation(
        user.id,
        'imessage',
        bbMessage.chat_id
      );

      // Save incoming message to database
      const savedMessage = await this.saveMessage(
        user.id,
        conversation.id,
        'user',
        bbMessage.text,
        {
          source: 'bluebubbles',
          originalMessageId: bbMessage.guid,
          attachments: bbMessage.attachments
        }
      );

      // Build conversation context
      const contextResult = await this.contextService.buildConversationContext(
        user.id,
        conversation.id,
        20
      );

      // Check for action items (reminders, tasks, etc.)
      await this.processActionItems(bbMessage.text, user.id);

      // Prepare messages for Claude
      const messages = await this.prepareClaudeMessages(conversation.id);
      
      // Get AI response
      const aiResponse = await this.claudeService.sendMessage(
        messages,
        contextResult.data
      );

      if (aiResponse.success && aiResponse.data) {
        // Save AI response to database
        await this.saveMessage(
          user.id,
          conversation.id,
          'assistant',
          aiResponse.data.content,
          {
            source: 'bluebubbles',
            tokensUsed: aiResponse.data.tokensUsed
          }
        );

        // Send response back through BlueBubbles
        await this.blueBubblesClient.sendMessage(
          bbMessage.chat_id,
          aiResponse.data.content
        );

        // Update conversation context
        await this.updateConversationContext(
          user.id,
          conversation.id,
          bbMessage.text,
          aiResponse.data.content
        );
      } else {
        logError('Failed to get AI response', { error: aiResponse.error });
        
        // Send error message to user
        await this.blueBubblesClient.sendMessage(
          bbMessage.chat_id,
          "I'm having trouble processing your message right now. Please try again later."
        );
      }
    } catch (error) {
      logError('Error handling incoming message', error);
    }
  }

  private async getOrCreateUserFromChat(chatId: string): Promise<User | null> {
    try {
      // Extract phone number from chat ID (usually in format like "SMS;-;+1234567890")
      const phoneMatch = chatId.match(/\+?\d{10,}/);
      if (!phoneMatch) {
        logError('Could not extract phone number from chat ID', { chatId });
        return null;
      }

      const phoneNumber = phoneMatch[0];
      
      // Check if user exists
      let user = await this.userRepo.findOne({
        where: { phoneNumber }
      });

      // Create user if doesn't exist
      if (!user) {
        user = this.userRepo.create({
          phoneNumber,
          preferences: {
            aiPersonality: 'friendly',
            enableReminders: true,
            reminderChannelPreference: 'imessage'
          }
        });
        
        user = await this.userRepo.save(user);
        logInfo('Created new user', { id: user.id, phoneNumber });
      }

      return user;
    } catch (error) {
      logError('Failed to get or create user', error);
      return null;
    }
  }

  private async getOrCreateConversation(
    userId: string,
    channel: 'imessage' | 'email',
    channelConversationId: string
  ): Promise<Conversation> {
    let conversation = await this.conversationRepo.findOne({
      where: {
        userId,
        channel,
        channelConversationId
      }
    });

    if (!conversation) {
      conversation = this.conversationRepo.create({
        userId,
        channel,
        channelConversationId,
        metadata: {}
      });
      
      conversation = await this.conversationRepo.save(conversation);
      logInfo('Created new conversation', { id: conversation.id });
    }

    // Update last message timestamp
    conversation.lastMessageAt = new Date();
    await this.conversationRepo.save(conversation);

    return conversation;
  }

  private async saveMessage(
    userId: string,
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    metadata: any = {}
  ): Promise<Message> {
    const message = this.messageRepo.create({
      userId,
      conversationId,
      role,
      content,
      metadata,
      tokensUsed: metadata.tokensUsed
    });

    const savedMessage = await this.messageRepo.save(message);
    logDebug('Message saved', { id: savedMessage.id, role });
    
    return savedMessage;
  }

  private async prepareClaudeMessages(conversationId: string): Promise<ClaudeMessage[]> {
    // Get recent messages from this conversation
    const messages = await this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 20 // Last 20 messages for context
    });

    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  private async processActionItems(text: string, userId: string): Promise<void> {
    try {
      // Extract potential action items from the message
      const actionResult = await this.claudeService.extractActionItems(text);
      
      if (actionResult.success && actionResult.data && actionResult.data.length > 0) {
        for (const item of actionResult.data) {
          // Check if it's a reminder request
          if (item.toLowerCase().includes('remind') || item.toLowerCase().includes('reminder')) {
            await this.reminderService.createReminderFromText(userId, item, 'imessage');
            logInfo('Created reminder from message', { userId, reminder: item });
          }
        }
      }
    } catch (error) {
      logError('Failed to process action items', error);
    }
  }

  private async updateConversationContext(
    userId: string,
    conversationId: string,
    userMessage: string,
    aiResponse: string
  ): Promise<void> {
    try {
      // Save the last user intent as working memory
      await this.contextService.saveMemory(
        userId,
        'last_user_message',
        userMessage,
        'working',
        conversationId
      );

      // Save the last AI response as working memory
      await this.contextService.saveMemory(
        userId,
        'last_ai_response',
        aiResponse,
        'working',
        conversationId
      );

      // Extract and save any important information as session memory
      if (userMessage.toLowerCase().includes('my name is')) {
        const nameMatch = userMessage.match(/my name is (\w+)/i);
        if (nameMatch) {
          await this.contextService.saveMemory(
            userId,
            'user_name',
            nameMatch[1],
            'long_term'
          );
        }
      }

      // Save topic if it seems important
      if (userMessage.length > 50) {
        const summaryResult = await this.claudeService.summarizeConversation([
          { role: 'user', content: userMessage },
          { role: 'assistant', content: aiResponse }
        ]);
        
        if (summaryResult.success && summaryResult.data) {
          await this.contextService.saveMemory(
            userId,
            `topic_${Date.now()}`,
            summaryResult.data,
            'session',
            conversationId
          );
        }
      }
    } catch (error) {
      logError('Failed to update conversation context', error);
    }
  }

  async sendProactiveMessage(
    userId: string,
    message: string,
    channel: 'imessage' | 'email' = 'imessage'
  ): Promise<ServiceResponse<boolean>> {
    try {
      if (channel === 'imessage') {
        // Get user's phone number
        const user = await this.userRepo.findOne({
          where: { id: userId }
        });

        if (!user || !user.phoneNumber) {
          return {
            success: false,
            error: 'User phone number not found'
          };
        }

        // Find the chat ID for this user
        const conversation = await this.conversationRepo.findOne({
          where: {
            userId,
            channel: 'imessage'
          },
          order: { lastMessageAt: 'DESC' }
        });

        if (!conversation || !conversation.channelConversationId) {
          return {
            success: false,
            error: 'No iMessage conversation found for user'
          };
        }

        // Send the message
        await this.blueBubblesClient.sendMessage(
          conversation.channelConversationId,
          message
        );

        // Save the message to database
        await this.saveMessage(
          userId,
          conversation.id,
          'assistant',
          message,
          { source: 'system', type: 'proactive' }
        );

        return { success: true, data: true };
      }
      
      // Email sending would be implemented here when we add email support
      return {
        success: false,
        error: 'Email channel not yet implemented'
      };
    } catch (error: any) {
      logError('Failed to send proactive message', error);
      return {
        success: false,
        error: error.message || 'Failed to send message'
      };
    }
  }
}

// Singleton instance
let messageRouterInstance: MessageRouter | null = null;

export const getMessageRouter = async (): Promise<MessageRouter> => {
  if (!messageRouterInstance) {
    messageRouterInstance = new MessageRouter();
    await messageRouterInstance.initialize();
  }
  return messageRouterInstance;
};

export default MessageRouter;
