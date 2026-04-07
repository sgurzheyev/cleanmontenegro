export async function sendTelegramAlert(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    console.warn('Telegram env vars missing; skipping alert.');
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!res.ok) {
      console.error('Telegram alert failed with status', res.status);
    }
  } catch (err) {
    console.error('Telegram alert error:', (err as Error)?.message ?? err);
  }
}

