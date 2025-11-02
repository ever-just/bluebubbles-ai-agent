import { BaseMessageHandler, ProcessedMessage } from './MessageHandler';
import { BlueBubblesMessage } from '../types';
import { logDebug, logWarn } from '../utils/logger';

/**
 * Handler for messages with audio attachments. Currently acts as a placeholder
 * until transcription support is implemented, but preserves structure used by
 * the compiled runtime.
 */
export class AudioMessageHandler extends BaseMessageHandler {
  private readonly audioExtensions = ['m4a', 'mp3', 'wav', 'aac', 'ogg', 'caf'];

  canHandle(message: BlueBubblesMessage): boolean {
    if (!message.attachments || message.attachments.length === 0) {
      return false;
    }

    return message.attachments.some(att => this.isAudioAttachment(att.mime_type || att.transfer_name || ''));
  }

  async process(message: BlueBubblesMessage): Promise<ProcessedMessage | null> {
    logDebug('Processing audio message', {
      guid: message.guid,
      attachmentCount: message.attachments?.length
    });

    const processed = this.createBaseProcessedMessage(message);
    processed.text = message.text || 'Audio message';
    processed.metadata.originalType = 'audio';

    for (const attachment of message.attachments || []) {
      if (this.isAudioAttachment(attachment.mime_type || attachment.transfer_name || '')) {
        try {
          const transcription = await this.transcribeAudio(attachment.guid);
          if (transcription) {
            processed.audio = {
              transcription,
              duration: attachment.total_bytes
            };
            processed.text = `${processed.text}\n\n[Audio transcription]: ${transcription}`;
          }
        } catch (error: any) {
          logWarn('Failed to transcribe audio', {
            guid: attachment.guid,
            error: error.message
          });
          processed.text = `${processed.text}\n\n[Audio message - transcription unavailable]`;
        }
      }
    }

    return processed;
  }

  getPriority(): number {
    return 12;
  }

  private isAudioAttachment(identifier: string): boolean {
    const lower = identifier.toLowerCase();
    return this.audioExtensions.some(ext => lower.includes(ext)) || lower.includes('audio/');
  }

  // TODO: Implement real transcription service (e.g. Whisper, AssemblyAI).
  private async transcribeAudio(_attachmentGuid: string): Promise<string | null> {
    logWarn('Audio transcription not yet implemented');
    return null;
  }
}
