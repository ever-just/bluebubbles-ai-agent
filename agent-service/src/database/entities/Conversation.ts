import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { User } from './User';
import { Message } from './Message';
import { ContextMemory } from './ContextMemory';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 50 })
  channel!: 'imessage' | 'email';

  @Index()
  @Column({ name: 'channel_conversation_id', type: 'varchar', length: 255, nullable: true })
  channelConversationId?: string; // BlueBubbles chat ID or email thread ID

  @CreateDateColumn({ name: 'started_at' })
  startedAt!: Date;

  @Column({ name: 'last_message_at', type: 'timestamp', nullable: true })
  lastMessageAt?: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;

  // Relations
  @ManyToOne(() => User, user => user.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => Message, message => message.conversation)
  messages!: Message[];

  @OneToMany(() => ContextMemory, memory => memory.conversation)
  memories!: ContextMemory[];
}
