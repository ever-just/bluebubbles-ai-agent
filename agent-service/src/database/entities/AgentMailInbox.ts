import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './User';

/**
 * AgentMailInbox entity - stores user-specific email inbox information.
 * Each user can have their own dedicated email inbox for the agent.
 * This ensures privacy by siloing email data per user.
 */
@Entity('agentmail_inboxes')
export class AgentMailInbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Index({ unique: true })
  @Column({ name: 'inbox_id', type: 'varchar', length: 255 })
  inboxId!: string;

  @Index({ unique: true })
  @Column({ name: 'email_address', type: 'varchar', length: 255 })
  emailAddress!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 255, nullable: true })
  displayName?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;
}
