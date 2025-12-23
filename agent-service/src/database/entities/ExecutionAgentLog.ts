import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('execution_agent_logs')
@Index(['agentName', 'createdAt'])
export class ExecutionAgentLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'agent_name', type: 'varchar', length: 255 })
  agentName!: string;

  @Column({ type: 'varchar', length: 50 })
  entryType!: 'request' | 'action' | 'tool_response' | 'response';

  @Column({ type: 'text' })
  content!: string;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;
}
