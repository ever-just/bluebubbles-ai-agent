import { Repository } from 'typeorm';
import { AppDataSource } from '../database/connection';
import { ContextMemory } from '../database/entities/ContextMemory';
import { User } from '../database/entities/User';
import { Message } from '../database/entities/Message';
import { logInfo, logError, logDebug } from '../utils/logger';
import { ServiceResponse, ContextMemory as IContextMemory } from '../types';
import { getClaudeService } from './ClaudeService';

export class ContextService {
  private contextRepo: Repository<ContextMemory>;
  private messageRepo: Repository<Message>;
  private claudeService: ReturnType<typeof getClaudeService>;
  
  constructor() {
    this.contextRepo = AppDataSource.getRepository(ContextMemory);
    this.messageRepo = AppDataSource.getRepository(Message);
    this.claudeService = getClaudeService();
  }

  async saveMemory(
    userId: string,
    key: string,
    value: string,
    memoryType: 'working' | 'session' | 'long_term' = 'session',
    conversationId?: string,
    metadata?: Record<string, any>
  ): Promise<ServiceResponse<IContextMemory>> {
    try {
      logDebug('Saving memory', { userId, key, memoryType });
      
      // Check if memory exists
      const existingMemory = await this.contextRepo.findOne({
        where: {
          userId,
          key,
          memoryType,
          conversationId: conversationId || undefined
        }
      });

      // Generate embedding for semantic search
      const embeddingResponse = await this.claudeService.generateEmbedding(value);
      const embedding = embeddingResponse.success ? embeddingResponse.data : undefined;

      let memory: ContextMemory;
      
      if (existingMemory) {
        // Update existing memory
        existingMemory.value = value;
        existingMemory.metadata = { ...existingMemory.metadata, ...metadata };
        existingMemory.embedding = embedding;
        existingMemory.updatedAt = new Date();
        
        if (memoryType === 'working') {
          // Working memory expires in 1 hour
          existingMemory.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        } else if (memoryType === 'session') {
          // Session memory expires in 24 hours
          existingMemory.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
        
        memory = await this.contextRepo.save(existingMemory);
      } else {
        // Create new memory
        const newMemory = this.contextRepo.create({
          userId,
          conversationId,
          memoryType,
          key,
          value,
          metadata: metadata || {},
          embedding,
          expiresAt: memoryType === 'working' 
            ? new Date(Date.now() + 60 * 60 * 1000)  // 1 hour
            : memoryType === 'session'
            ? new Date(Date.now() + 24 * 60 * 60 * 1000)  // 24 hours
            : undefined  // long_term doesn't expire
        });
        
        memory = await this.contextRepo.save(newMemory);
      }

      logInfo('Memory saved successfully', { id: memory.id, key });
      
      return {
        success: true,
        data: this.mapToInterface(memory)
      };
    } catch (error: any) {
      logError('Failed to save memory', error);
      return {
        success: false,
        error: error.message || 'Failed to save memory'
      };
    }
  }

  async getMemory(
    userId: string,
    key: string,
    memoryType?: 'working' | 'session' | 'long_term',
    conversationId?: string
  ): Promise<ServiceResponse<IContextMemory | null>> {
    try {
      const where: any = { userId, key };
      
      if (memoryType) {
        where.memoryType = memoryType;
      }
      
      if (conversationId) {
        where.conversationId = conversationId;
      }

      const memory = await this.contextRepo.findOne({ where });
      
      if (!memory) {
        return {
          success: true,
          data: null
        };
      }

      // Check if memory has expired
      if (memory.expiresAt && memory.expiresAt < new Date()) {
        await this.contextRepo.remove(memory);
        return {
          success: true,
          data: null
        };
      }

      return {
        success: true,
        data: this.mapToInterface(memory)
      };
    } catch (error: any) {
      logError('Failed to get memory', error);
      return {
        success: false,
        error: error.message || 'Failed to get memory'
      };
    }
  }

  async getUserMemories(
    userId: string,
    memoryType?: 'working' | 'session' | 'long_term',
    conversationId?: string
  ): Promise<ServiceResponse<IContextMemory[]>> {
    try {
      const where: any = { userId };
      
      if (memoryType) {
        where.memoryType = memoryType;
      }
      
      if (conversationId) {
        where.conversationId = conversationId;
      }

      const memories = await this.contextRepo.find({ 
        where,
        order: { updatedAt: 'DESC' }
      });

      // Filter out expired memories
      const validMemories = memories.filter(memory => {
        if (memory.expiresAt && memory.expiresAt < new Date()) {
          this.contextRepo.remove(memory); // Clean up expired memories
          return false;
        }
        return true;
      });

      return {
        success: true,
        data: validMemories.map(m => this.mapToInterface(m))
      };
    } catch (error: any) {
      logError('Failed to get user memories', error);
      return {
        success: false,
        error: error.message || 'Failed to get user memories'
      };
    }
  }

  async searchMemories(
    userId: string,
    query: string,
    limit: number = 10
  ): Promise<ServiceResponse<IContextMemory[]>> {
    try {
      logDebug('Searching memories', { userId, query, limit });
      
      // For now, do a simple text search
      // In production, use vector similarity search with embeddings
      const memories = await this.contextRepo
        .createQueryBuilder('memory')
        .where('memory.userId = :userId', { userId })
        .andWhere('(memory.key ILIKE :query OR memory.value ILIKE :query)', {
          query: `%${query}%`
        })
        .orderBy('memory.updatedAt', 'DESC')
        .limit(limit)
        .getMany();

      return {
        success: true,
        data: memories.map(m => this.mapToInterface(m))
      };
    } catch (error: any) {
      logError('Failed to search memories', error);
      return {
        success: false,
        error: error.message || 'Failed to search memories'
      };
    }
  }

  async buildConversationContext(
    userId: string,
    conversationId: string,
    messageLimit: number = 20
  ): Promise<ServiceResponse<string>> {
    try {
      // Get recent messages
      const messages = await this.messageRepo.find({
        where: { userId, conversationId },
        order: { createdAt: 'DESC' },
        take: messageLimit
      });

      // Get relevant memories
      const workingMemories = await this.getUserMemories(userId, 'working', conversationId);
      const sessionMemories = await this.getUserMemories(userId, 'session', conversationId);
      const longTermMemories = await this.getUserMemories(userId, 'long_term');

      // Build context string
      let context = '';
      
      // Add long-term memories
      if (longTermMemories.success && longTermMemories.data?.length > 0) {
        context += 'Long-term context:\n';
        longTermMemories.data.forEach(memory => {
          context += `- ${memory.key}: ${memory.value}\n`;
        });
        context += '\n';
      }

      // Add session memories
      if (sessionMemories.success && sessionMemories.data?.length > 0) {
        context += 'Session context:\n';
        sessionMemories.data.forEach(memory => {
          context += `- ${memory.key}: ${memory.value}\n`;
        });
        context += '\n';
      }

      // Add working memories
      if (workingMemories.success && workingMemories.data?.length > 0) {
        context += 'Current context:\n';
        workingMemories.data.forEach(memory => {
          context += `- ${memory.key}: ${memory.value}\n`;
        });
        context += '\n';
      }

      // Add recent messages
      if (messages.length > 0) {
        context += 'Recent conversation:\n';
        messages.reverse().forEach(msg => {
          context += `${msg.role}: ${msg.content}\n`;
        });
      }

      return {
        success: true,
        data: context
      };
    } catch (error: any) {
      logError('Failed to build conversation context', error);
      return {
        success: false,
        error: error.message || 'Failed to build conversation context'
      };
    }
  }

  async cleanupExpiredMemories(): Promise<void> {
    try {
      const result = await this.contextRepo
        .createQueryBuilder()
        .delete()
        .where('expiresAt < :now', { now: new Date() })
        .execute();
      
      if (result.affected && result.affected > 0) {
        logInfo(`Cleaned up ${result.affected} expired memories`);
      }
    } catch (error) {
      logError('Failed to cleanup expired memories', error);
    }
  }

  async promoteMemory(
    memoryId: string,
    newType: 'session' | 'long_term'
  ): Promise<ServiceResponse<IContextMemory>> {
    try {
      const memory = await this.contextRepo.findOne({
        where: { id: memoryId }
      });

      if (!memory) {
        return {
          success: false,
          error: 'Memory not found'
        };
      }

      memory.memoryType = newType;
      
      // Update expiration based on new type
      if (newType === 'session') {
        memory.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      } else if (newType === 'long_term') {
        memory.expiresAt = undefined; // No expiration
      }

      const updatedMemory = await this.contextRepo.save(memory);
      
      logInfo('Memory promoted', { id: memoryId, newType });
      
      return {
        success: true,
        data: this.mapToInterface(updatedMemory)
      };
    } catch (error: any) {
      logError('Failed to promote memory', error);
      return {
        success: false,
        error: error.message || 'Failed to promote memory'
      };
    }
  }

  private mapToInterface(memory: ContextMemory): IContextMemory {
    return {
      id: memory.id,
      userId: memory.userId,
      conversationId: memory.conversationId,
      memoryType: memory.memoryType,
      key: memory.key,
      value: memory.value,
      metadata: memory.metadata,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
      expiresAt: memory.expiresAt,
      embedding: memory.embedding
    };
  }
}

// Singleton instance
let contextServiceInstance: ContextService | null = null;

export const getContextService = (): ContextService => {
  if (!contextServiceInstance) {
    contextServiceInstance = new ContextService();
  }
  return contextServiceInstance;
};

export default ContextService;
