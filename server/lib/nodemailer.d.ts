declare module 'nodemailer' {
  export interface SendMailOptions { from: string; to: string; subject: string; text: string; html: string; headers?: Record<string, string>; attachments?: { filename: string; content: Buffer }[] }
  export interface Transporter { sendMail(m: SendMailOptions): Promise<unknown> }
  export function createTransport(o: { host: string; port: number; secure: boolean; auth: { user: string; pass: string }; connectionTimeout?: number; greetingTimeout?: number; socketTimeout?: number }): Transporter;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
