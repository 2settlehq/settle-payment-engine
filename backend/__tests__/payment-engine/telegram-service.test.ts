import { describe, expect, it, vi } from 'vitest';
import { TelegramService } from '../../src/services/payment-engine/settlement/telegram.service';

describe('TelegramService', () => {
  const service = new TelegramService({
    enabled: true,
    botToken: '123:test-token',
    chatId: '456',
    webhookSecret: '',
  });

  const session = {
    reference: 'sess<&>1',
    fiatAmount: 12500,
    fiatCurrency: 'NGN<&>',
  };

  const receiver = {
    accountNumber: '012<345&678',
    bankCode: '044',
    bankName: 'Access & Diamond <Bank>',
    accountName: 'Ada & Co <Ops>',
  };

  it('escapes dynamic values in settlement failure HTML messages', () => {
    const message = service.formatSettlementFailure(
      session,
      receiver,
      'Provider returned <invalid> & retry failed'
    );

    expect(message).toContain('sess&lt;&amp;&gt;1');
    expect(message).toContain('<b>Amount (NGN&lt;&amp;&gt;):</b> <code>12500</code>');
    expect(message).toContain('<code>012&lt;345&amp;678</code>');
    expect(message).toContain('<code>Access &amp; Diamond &lt;Bank&gt;</code>');
    expect(message).toContain('Ada &amp; Co &lt;Ops&gt;');
    expect(message).toContain('Provider returned &lt;invalid&gt; &amp; retry failed');
    expect(message).not.toContain('Provider returned <invalid> & retry failed');
  });

  it('adds a copy button per payout field with raw (unescaped) values', () => {
    const keyboard = service.manualSettlementKeyboard(session, receiver);

    expect(keyboard.inline_keyboard).toEqual([
      [
        { text: 'Copy amount', copy_text: { text: '12500' } },
        { text: 'Copy account', copy_text: { text: '012<345&678' } },
      ],
      [{ text: 'Copy bank', copy_text: { text: 'Access & Diamond <Bank>' } }],
      [{ text: 'Settlement completed', callback_data: 'settle:sess<&>1' }],
    ]);
  });

  it('falls back to bank code for the copy bank button', () => {
    const keyboard = service.manualSettlementKeyboard(session, { ...receiver, bankName: undefined });

    expect(keyboard.inline_keyboard[1]).toEqual([
      { text: 'Copy bank', copy_text: { text: '044' } },
    ]);
  });

  it('escapes dynamic values in settlement reversal HTML messages', () => {
    const message = service.formatSettlementReversal(
      session,
      'trf<&>1',
      'Bank said <reversed> & refunded'
    );

    expect(message).toContain('sess&lt;&amp;&gt;1');
    expect(message).toContain('NGN&lt;&amp;&gt; 12,500');
    expect(message).toContain('trf&lt;&amp;&gt;1');
    expect(message).toContain('Bank said &lt;reversed&gt; &amp; refunded');
  });

});
