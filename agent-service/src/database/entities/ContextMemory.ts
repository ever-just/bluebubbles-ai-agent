import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './User';
import { Conversation } from './Conversation';

@Entity('context_memory')
@Index(['userId', 'memoryType'])
@Index(['conversationId', 'memoryType'])
export class ContextMemory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string;

  @Index()
  @Column({ name: 'memory_type', type: 'varchar', length: 50 })
  memoryType!: 'working' | 'session' | 'long_term';

  @Column({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column('jsonb', { nullable: true })
  embedding?: any;

  // Relations
  @ManyToOne(() => User, user => user.memories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Conversation, conversation => conversation.memories, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: Conversation;
}
