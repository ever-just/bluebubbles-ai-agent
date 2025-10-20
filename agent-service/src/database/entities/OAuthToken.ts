import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from './User';

@Entity('oauth_tokens')
@Index(['userId', 'provider'])
export class OAuthToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 50 })
  provider!: string; // 'google', etc.

  @Column({ name: 'access_token', type: 'text' })
  accessToken!: string;

  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  refreshToken?: string;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'text', array: true, nullable: true })
  scopes?: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => User, user => user.oauthTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
