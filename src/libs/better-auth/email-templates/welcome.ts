interface WelcomeEmailParams {
  appUrl?: string;
  userName?: string | null;
}

const DEFAULT_APP_URL = 'https://ask.gptweb.ru';

export const getWelcomeEmailTemplate = ({ appUrl = DEFAULT_APP_URL, userName }: WelcomeEmailParams = {}) => {
  const safeAppUrl = appUrl.replace(/\/$/, '');
  const chatUrl = `${safeAppUrl}/`;
  const plansUrl = `${safeAppUrl}/settings/plans`;
  const greeting = userName ? `${userName}, добро пожаловать в WebGPT!` : 'Добро пожаловать в WebGPT!';

  return {
    html: `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Добро пожаловать в WebGPT</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f4f6fb;color:#111827;">
  <div style="max-width:640px;margin:0 auto;padding:32px 18px;">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="display:inline-block;background:#111827;color:#fff;border-radius:14px;padding:10px 18px;font-size:20px;font-weight:800;">🤯 WebGPT</span>
    </div>
    <div style="background:#fff;border-radius:24px;padding:34px;box-shadow:0 10px 35px rgba(17,24,39,.08);">
      <h1 style="font-size:28px;line-height:1.2;margin:0 0 12px 0;">${greeting}</h1>
      <p style="font-size:17px;line-height:1.6;color:#374151;margin:0 0 20px 0;">
        У тебя уже есть бесплатные кредиты, чтобы попробовать Claude, GPT, Gemini и другие модели в одном окне.
      </p>
      <div style="background:#eef6ff;border:1px solid #bfdbfe;border-radius:18px;padding:18px;margin:24px 0;">
        <p style="margin:0 0 10px 0;font-weight:700;color:#1d4ed8;">Начни с одного из быстрых сценариев:</p>
        <ul style="margin:0;padding-left:20px;color:#1f2937;line-height:1.6;">
          <li>Сравни Claude, GPT и Gemini на одной задаче</li>
          <li>Загрузи файл и попроси краткий вывод</li>
          <li>Сделай поиск по интернету и попроси готовый ответ</li>
        </ul>
      </div>
      <div style="text-align:center;margin:30px 0;">
        <a href="${chatUrl}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;border-radius:14px;padding:16px 28px;font-weight:800;font-size:16px;">Открыть WebGPT</a>
      </div>
      <p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0 0 18px 0;">
        Если бесплатных кредитов не хватит, тарифы начинаются от <strong>490 ₽</strong>. На платном тарифе удобнее работать каждый день: больше лимитов, история и доступ к сильным моделям.
      </p>
      <p style="margin:0;text-align:center;">
        <a href="${plansUrl}" style="color:#2563eb;font-weight:700;text-decoration:none;">Посмотреть тарифы →</a>
      </p>
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:13px;margin:24px 0 0 0;">© 2026 WebGPT · support@gptweb.ru</p>
  </div>
</body>
</html>`,
    subject: 'Добро пожаловать в WebGPT — бесплатные кредиты уже на аккаунте',
    text: `${greeting}\n\nУ тебя уже есть бесплатные кредиты, чтобы попробовать Claude, GPT, Gemini и другие модели в одном окне.\n\nС чего начать:\n1. Сравни Claude, GPT и Gemini на одной задаче\n2. Загрузи файл и попроси краткий вывод\n3. Сделай поиск по интернету и попроси готовый ответ\n\nОткрыть WebGPT: ${chatUrl}\n\nЕсли бесплатных кредитов не хватит, тарифы начинаются от 490 ₽: ${plansUrl}`,
  };
};
