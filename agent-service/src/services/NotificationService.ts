import { BlueBubblesClient } from '../integrations/BlueBubblesClient';
import { getSecurityManager } from '../middleware/security';
import { logWarn, logError, logInfo } from '../utils/logger';

const IMESSAGE_CHAT_PREFIX = 'iMessage;-;';

const normalizeHandle = (handle: string): string => {
  const digits = handle.replace(/\D/g, '');
  if (!digits) {
    return handle;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length > 10) {
    return `+${digits}`;
  }

  return handle.startsWith('+') ? handle : `+${handle}`;
};

class NotificationService {
  private readonly blueBubblesClient = new BlueBubblesClient();
  private readonly securityManager = getSecurityManager();

  async sendAdminAlert(message: string): Promise<void> {
    const adminHandles = this.securityManager.getAdminHandles();

    if (adminHandles.length === 0) {
      logWarn('No admin handles configured for notifications');
      return;
    }

    const results = await Promise.allSettled(
      adminHandles.map(handle => this.sendMessageToHandle(handle, message))
    );

    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      logError('Failed to dispatch admin alert to some recipients', {
        failureCount: failures.length
      });
    } else {
      logInfo('Admin alert dispatched', { recipients: adminHandles.length });
    }
  }

  private async sendMessageToHandle(handle: string, message: string): Promise<void> {
    const normalized = normalizeHandle(handle);
    const chatGuid = `${IMESSAGE_CHAT_PREFIX}${normalized}`;

    await this.blueBubblesClient.sendMessage(chatGuid, message);
  }
}

let notificationServiceInstance: NotificationService | null = null;

export const getNotificationService = (): NotificationService => {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService();
  }

  return notificationServiceInstance;
};

export default NotificationService;
