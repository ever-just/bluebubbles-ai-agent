import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './User';

@Entity('calendar_events')
@Index(['userId', 'startTime', 'endTime'])
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index({ unique: true })
  @Column({ name: 'google_event_id', type: 'varchar', length: 255, nullable: true })
  googleEventId?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  title?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Index()
  @Column({ name: 'start_time', type: 'timestamp' })
  startTime!: Date;

  @Index()
  @Column({ name: 'end_time', type: 'timestamp' })
  endTime!: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  location?: string;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;

  @CreateDateColumn({ name: 'synced_at' })
  syncedAt!: Date;

  // Relations
  @ManyToOne(() => User, user => user.calendarEvents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
