import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('working_memory_state')
@Index(['userId', 'conversationId'], { unique: true })
export class WorkingMemoryState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string;

  @Column({ name: 'summary_text', type: 'text', nullable: true })
  summaryText?: string;

  @Column({ name: 'last_entry_index', type: 'integer', default: -1 })
  lastEntryIndex!: number;

  @Column({ name: 'entry_count', type: 'integer', default: 0 })
  entryCount!: number;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
