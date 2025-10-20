import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './User';
import { ReminderMetadata } from '../../types';

@Entity('reminders')
@Index(['userId', 'status'])
@Index(['remindAt', 'status'])
export class Reminder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'text' })
  content!: string;

  @Index()
  @Column({ name: 'remind_at', type: 'timestamp' })
  remindAt!: Date;

  @Column({ type: 'varchar', length: 50 })
  channel!: 'imessage' | 'email' | 'both';

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status!: 'pending' | 'sent' | 'snoozed' | 'cancelled';

  @Column({ type: 'jsonb', default: {} })
  metadata!: ReminderMetadata;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt?: Date;

  // Relations
  @ManyToOne(() => User, user => user.reminders, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
