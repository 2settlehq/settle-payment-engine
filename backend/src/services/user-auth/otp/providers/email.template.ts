/**
 * HTML template for the OTP login email (table-based layout + inline styles
 * for broad email client compatibility).
 */

export const LOGO_CID = '2settle-logo';

export function buildOtpEmailHtml(code: string, expiresInMinutes: number): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;max-width:480px;width:100%;">
            <tr>
              <td style="height:4px;background:linear-gradient(90deg,#2563eb,#60a5fa);font-size:0;line-height:0;">&nbsp;</td>
            </tr>
            <tr>
              <td align="center" style="padding:32px 24px 8px 24px;">
                <img src="cid:${LOGO_CID}" alt="2Settle" width="220" style="display:block;width:220px;max-width:100%;height:auto;" />
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;font-size:14px;color:#333333;">
                Your verification code is:
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:16px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td align="center" style="background-color:#f4f5f7;border:1px solid #e0e0e0;border-radius:4px;padding:16px;">
                      <span style="font-size:32px;letter-spacing:4px;color:#111111;">${code}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;font-size:13px;color:#555555;">
                This code will expire in ${expiresInMinutes} minutes.
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0 32px;font-size:13px;color:#555555;line-height:1.5;">
                If you didn't request this code, you can safely ignore this email &mdash; no changes will be made to your account.
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 0 32px;font-size:13px;color:#555555;">
                Sincerely, 2Settle
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:32px 24px 16px 24px;font-size:11px;color:#999999;">
                Copyright &copy; ${new Date().getFullYear()} 2Settle. All Rights Reserved.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 24px 24px 24px;">
                <img src="cid:${LOGO_CID}" alt="2Settle" width="140" style="display:block;width:140px;max-width:100%;height:auto;" />
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
