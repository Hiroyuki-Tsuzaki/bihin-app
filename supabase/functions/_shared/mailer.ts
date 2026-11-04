// メール送信の切り替え
//   MAIL_PROVIDER=log   : 送信せずログ出力のみ（既定。開発用）
//   MAIL_PROVIDER=smtp  : SMTP 送信（ローカルは Supabase 同梱の Mailpit、本番は Gmail SMTP 465番）
//   MAIL_PROVIDER=fail  : 常に失敗（再送処理の確認用）
export const DEFAULT_FROM_NAME = '備品管理アプリ';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  close(): Promise<void>;
}

export async function createMailerFromEnv(env: Record<string, string | undefined>): Promise<Mailer> {
  const provider = (env.MAIL_PROVIDER ?? 'log').toLowerCase();

  if (provider === 'log') {
    return {
      send(m) {
        console.log(`[mail:log] to=${m.to} subject=${m.subject}\n${m.text}`);
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    };
  }

  if (provider === 'fail') {
    return {
      send: () => Promise.reject(new Error('MAIL_PROVIDER=fail のため送信失敗扱い')),
      close: () => Promise.resolve(),
    };
  }

  if (provider === 'smtp') {
    const host = env.SMTP_HOST;
    const from = env.MAIL_FROM ?? env.SMTP_USER;
    if (!host || !from) throw new Error('SMTP_HOST と MAIL_FROM（または SMTP_USER）を設定してください');
    const port = Number(env.SMTP_PORT ?? '465');
    const secure = (env.SMTP_SECURE ?? (port === 465 ? 'true' : 'false')) === 'true';
    // 差出人名: MAIL_FROM_NAME が未設定ならソース内の既定値（UTF-8 で確実に保持される）を使う
    const fromName = (env.MAIL_FROM_NAME ?? '').trim() || DEFAULT_FROM_NAME;
    const { default: nodemailer } = await import('npm:nodemailer@6.9.16');
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    return {
      async send(m) {
        await transport.sendMail({
          // 差出人名はオブジェクト形式で渡し、nodemailer に RFC 2047 でエンコードさせる
          from: { name: fromName, address: from },
          to: m.to,
          subject: m.subject,
          text: m.text,
        });
      },
      close: () => Promise.resolve(transport.close()),
    };
  }

  throw new Error(`未対応の MAIL_PROVIDER: ${provider}`);
}
