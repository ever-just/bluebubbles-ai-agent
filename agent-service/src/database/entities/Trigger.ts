import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './User';

export interface TriggerMetadata {
  lastError?: string;
  lastExecutionAt?: Date;
  executionCount?: number;
  createdBy?: string;
  [key: string]: any;
}

@Entity('triggers')
@Index(['userId', 'status'])
@Index(['nextTrigger', 'status'])
export class Trigger {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'agent_name', type: 'varchar', length: 255 })
  agentName!: string;

  @Column({ type: 'text' })
  payload!: string;

  @Column({ name: 'start_time', type: 'timestamp', nullable: true })
  startTime?: Date;

  @Index()
  @Column({ name: 'next_trigger', type: 'timestamp', nullable: true })
  nextTrigger?: Date;

  @Column({ name: 'recurrence_rule', type: 'varchar', length: 255, nullable: true })
  recurrenceRule?: string;

  @Column({ type: 'varchar', length: 50, default: 'America/Chicago' })
  timezone!: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'paused' | 'completed';

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string;

  @Column({ type: 'jsonb', default: {} })
  metadata!: TriggerMetadata;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
