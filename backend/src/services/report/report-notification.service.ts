/**
 * Report Notification Service
 *
 * Sends admin notifications when new reports are created.
 * Two channels: admin webhook (HTTP POST) and Telegram.
 */

import config from '../../config';
import { hmacSha256 } from '../../security/utils/crypto';
import { telegramService } from '../payment-engine/settlement/telegram.service';
import { Report } from './report.types';

// =============================================================================
// ADMIN WEBHOOK
// =============================================================================

async function sendReportAdminWebhook(report: Report): Promise<void> {
  const webhookUrl = config.reportly?.adminWebhookUrl;
  if (!webhookUrl) return;

  const payload = {
    event: 'report.created',
    timestamp: new Date().toISOString(),
    report: {
      reportId: report.reportId,
      complaintType: report.complaintType,
      name: report.name,
      phoneNumber: report.phoneNumber,
      walletAddress: report.walletAddress,
      fraudsterWalletAddress: report.fraudsterWalletAddress,
      sessionReference: report.sessionReference,
      status: report.status,
      merchantId: report.merchantId,
      createdAt: report.createdAt,
    },
  };

  const payloadString = JSON.stringify(payload);
  const timestamp = payload.timestamp;
  const signature = hmacSha256(config.admin.secret, payloadString);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp,
        'User-Agent': '2Settle-Webhook/1.0',
      },
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    console.log(`[ReportWebhook] Delivered report.created for ${report.reportId}`);
  } catch (error) {
    console.error(
      `[ReportWebhook] Failed to deliver report.created for ${report.reportId}:`,
      error instanceof Error ? error.message : error
    );
  }
}

// =============================================================================
// TELEGRAM
// =============================================================================

const COMPLAINT_LABELS: Record<string, string> = {
  track_transaction: 'Track Transaction',
  stolen_funds: 'Stolen/Disappeared Funds',
  fraud: 'Fraud',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendReportTelegramNotification(report: Report): Promise<void> {
  if (!telegramService.isEnabled()) return;

  const lines = [
    `<b>New Complaint Report</b>`,
    ``,
    `<b>Report ID:</b> ${escapeHtml(report.reportId)}`,
    `<b>Type:</b> ${escapeHtml(COMPLAINT_LABELS[report.complaintType] || report.complaintType)}`,
    `<b>Reporter:</b> ${escapeHtml(report.name)}`,
    `<b>Merchant:</b> ${escapeHtml(report.merchantId)}`,
  ];

  if (report.sessionReference) {
    lines.push(`<b>Session:</b> ${escapeHtml(report.sessionReference)}`);
  }
  if (report.walletAddress) {
    lines.push(`<b>Reporter Wallet:</b> <code>${escapeHtml(report.walletAddress)}</code>`);
  }
  if (report.fraudsterWalletAddress) {
    lines.push(`<b>Accused Wallet:</b> <code>${escapeHtml(report.fraudsterWalletAddress)}</code>`);
  }

  lines.push(``, `<b>Status:</b> Pending`);

  await telegramService.sendMessage(lines.join('\n'));
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Notify admins of a new report. Fire-and-forget — errors are logged, not thrown.
 */
export async function notifyNewReport(report: Report): Promise<void> {
  await Promise.allSettled([
    sendReportAdminWebhook(report),
    sendReportTelegramNotification(report),
  ]);
}
