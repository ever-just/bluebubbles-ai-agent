import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { Conversation } from './Conversation';
import { Message } from './Message';
import { ContextMemory } from './ContextMemory';
import { Reminder } from './Reminder';
import { CalendarEvent } from './CalendarEvent';
import { OAuthToken } from './OAuthToken';
import { UserPreferences } from '../../types';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'phone_number', type: 'varchar', length: 20, nullable: true })
  phoneNumber?: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string;

  @Index({ unique: true })
  @Column({ name: 'google_id', type: 'varchar', length: 255, nullable: true })
  googleId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'jsonb', default: {} })
  preferences!: UserPreferences;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  // Relations
  @OneToMany(() => Conversation, conversation => conversation.user)
  conversations!: Conversation[];

  @OneToMany(() => Message, message => message.user)
  messages!: Message[];

  @OneToMany(() => ContextMemory, memory => memory.user)
  memories!: ContextMemory[];

  @OneToMany(() => Reminder, reminder => reminder.user)
  reminders!: Reminder[];

  @OneToMany(() => CalendarEvent, event => event.user)
  calendarEvents!: CalendarEvent[];

  @OneToMany(() => OAuthToken, token => token.user)
  oauthTokens!: OAuthToken[];
}
