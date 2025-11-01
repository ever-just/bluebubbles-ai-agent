import { logInfo, logWarn, logError } from '../utils/logger';

/**
 * Security configuration for Agent Grace
 */
export interface SecurityConfig {
  adminHandles: string[];
  enableAuditLog: boolean;
  rateLimitPerMinute: number;
}

/**
 * Permission levels for different operations
 */
export enum PermissionLevel {
  PUBLIC = 'public',
  USER = 'user',
  ADMIN = 'admin'
}

/**
 * Security manager for authorization and audit logging
 */
export class SecurityManager {
  private config: SecurityConfig;
  private rateLimitMap: Map<string, number[]> = new Map();
  private auditLogEntries: Array<{
    timestamp: Date;
    handle: string;
    action: string;
    details: any;
  }> = [];

  constructor(config?: Partial<SecurityConfig>) {
    this.config = {
      adminHandles: config?.adminHandles || ['+19522779595'], // Weldon's number
      enableAuditLog: config?.enableAuditLog ?? true,
      rateLimitPerMinute: config?.rateLimitPerMinute || 999999 // Effectively disabled
    };

    logInfo('Security manager initialized', {
      adminCount: this.config.adminHandles.length,
      auditEnabled: this.config.enableAuditLog,
      rateLimitDisabled: true
    });
  }

  /**
   * Check if a handle has admin privileges
   */
  isAdmin(handle: string): boolean {
    const normalized = this.normalizeHandle(handle);
    const isAdmin = this.config.adminHandles.some(
      adminHandle => this.normalizeHandle(adminHandle) === normalized
    );

    if (isAdmin) {
      logInfo('Admin access verified', { handle: this.maskHandle(handle) });
    }

    return isAdmin;
  }

  getAdminHandles(): string[] {
    return [...this.config.adminHandles];
  }

  /**
   * Check if a handle has permission for a specific operation
   */
  hasPermission(handle: string, requiredLevel: PermissionLevel): boolean {
    switch (requiredLevel) {
      case PermissionLevel.PUBLIC:
        return true;
      case PermissionLevel.USER:
        return true; // All authenticated users
      case PermissionLevel.ADMIN:
        return this.isAdmin(handle);
      default:
        return false;
    }
  }

  /**
   * Check rate limit for a handle
   */
  checkRateLimit(handle: string): boolean {
    const now = Date.now();
    const normalized = this.normalizeHandle(handle);
    
    // Get or create timestamp array for this handle
    let timestamps = this.rateLimitMap.get(normalized) || [];
    
    // Remove timestamps older than 1 minute
    timestamps = timestamps.filter(ts => now - ts < 60000);
    
    // Check if limit exceeded
    if (timestamps.length >= this.config.rateLimitPerMinute) {
      logWarn('Rate limit exceeded', {
        handle: this.maskHandle(handle),
        count: timestamps.length,
        limit: this.config.rateLimitPerMinute
      });
      return false;
    }
    
    // Add current timestamp
    timestamps.push(now);
    this.rateLimitMap.set(normalized, timestamps);
    
    return true;
  }

  /**
   * Log an action for audit trail
   */
  logAudit(handle: string, action: string, details?: any): void {
    if (!this.config.enableAuditLog) return;

    const entry = {
      timestamp: new Date(),
      handle: this.maskHandle(handle),
      action,
      details
    };

    this.auditLogEntries.push(entry);

    // Keep only last 1000 entries
    if (this.auditLogEntries.length > 1000) {
      this.auditLogEntries.shift();
    }

    logInfo('Audit log entry', entry);
  }

  /**
   * Get recent audit log entries
   */
  getAuditLog(limit: number = 100): Array<any> {
    return this.auditLogEntries.slice(-limit);
  }

  /**
   * Normalize phone number format
   */
  private normalizeHandle(handle: string): string {
    // Remove all non-digit characters
    const digits = handle.replace(/\D/g, '');
    
    // If it's a US number without country code, add +1
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    
    // If it already has country code
    if (digits.length > 10) {
      return `+${digits}`;
    }
    
    return handle;
  }

  /**
   * Mask handle for logging (show last 4 digits only)
   */
  private maskHandle(handle: string): string {
    if (handle.length <= 4) return '****';
    return '****' + handle.slice(-4);
  }

  /**
   * Add admin handle (admin-only operation)
   */
  addAdminHandle(requestingHandle: string, newAdminHandle: string): boolean {
    if (!this.isAdmin(requestingHandle)) {
      logWarn('Unauthorized admin handle addition attempt', {
        requester: this.maskHandle(requestingHandle)
      });
      return false;
    }

    const normalized = this.normalizeHandle(newAdminHandle);
    if (!this.config.adminHandles.includes(normalized)) {
      this.config.adminHandles.push(normalized);
      this.logAudit(requestingHandle, 'ADD_ADMIN', { newAdmin: this.maskHandle(newAdminHandle) });
      logInfo('Admin handle added', {
        by: this.maskHandle(requestingHandle),
        newAdmin: this.maskHandle(newAdminHandle)
      });
      return true;
    }

    return false;
  }

  /**
   * Remove admin handle (admin-only operation)
   */
  removeAdminHandle(requestingHandle: string, adminHandleToRemove: string): boolean {
    if (!this.isAdmin(requestingHandle)) {
      logWarn('Unauthorized admin handle removal attempt', {
        requester: this.maskHandle(requestingHandle)
      });
      return false;
    }

    const normalized = this.normalizeHandle(adminHandleToRemove);
    const index = this.config.adminHandles.indexOf(normalized);
    
    if (index > -1) {
      // Prevent removing the last admin
      if (this.config.adminHandles.length === 1) {
        logWarn('Cannot remove last admin handle');
        return false;
      }

      this.config.adminHandles.splice(index, 1);
      this.logAudit(requestingHandle, 'REMOVE_ADMIN', { removedAdmin: this.maskHandle(adminHandleToRemove) });
      logInfo('Admin handle removed', {
        by: this.maskHandle(requestingHandle),
        removed: this.maskHandle(adminHandleToRemove)
      });
      return true;
    }

    return false;
  }
}

// Singleton instance
let securityManagerInstance: SecurityManager | null = null;

export const getSecurityManager = (): SecurityManager => {
  if (!securityManagerInstance) {
    securityManagerInstance = new SecurityManager();
  }
  return securityManagerInstance;
};

export default SecurityManager;
