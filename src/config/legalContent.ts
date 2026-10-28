/**
 * Text of the Privacy Policy and Terms of Service (Sprint 10). Kept as data so a test can check that every statement
 * the policy makes about what AdLens does is still present, and so the owner's name and contact come from settings.
 * Everything here describes what the product really does; if the product changes, change this text in the same commit.
 */

export interface LegalOwner {
  entity: string;
  supportEmail: string;
  address: string;
}

export interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
}

export const LEGAL_LAST_UPDATED = '28 October 2026';

/** The wording Google requires for apps that use Google user data. */
export const GOOGLE_LIMITED_USE_STATEMENT =
  "AdLens's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.";

function contactLine(o: LegalOwner): string {
  const parts = [o.entity];
  if (o.address) parts.push(o.address);
  parts.push(o.supportEmail ? `Email: ${o.supportEmail}` : 'Contact: use the Help link inside AdLens');
  return parts.join(' · ');
}

export function privacySections(o: LegalOwner): LegalSection[] {
  return [
    {
      id: 'who',
      title: 'Who we are',
      paragraphs: [
        `AdLens is a marketing analytics console operated by ${o.entity}. It lets you connect your own Google Analytics 4, Google Search Console and Meta Ads accounts, look at your numbers in one place, and ask an AI assistant questions about them.`,
        `This policy explains what AdLens reads, what it keeps, who it is shared with, and how you delete it. ${contactLine(o)}`,
      ],
    },
    {
      id: 'collect',
      title: 'What AdLens reads and stores',
      paragraphs: [
        'Your account: the name and email address from your sign-in (email and password, or Google), and the workspace and project settings you create, such as project names, the property or site you chose, currency and timezone, and a profile picture or workspace logo if you add one.',
        'Your connections: when you connect Google or Facebook, AdLens stores the access it needs to read your data on your behalf. These credentials are encrypted with AES-256-GCM, tied to your account, and kept in a database that browsers cannot read.',
        'What you build: saved reports, dashboards, AI agent settings (including any API key you add, which is encrypted), and a count of AI questions asked each month so plan limits can be applied.',
        'Your analytics data: AdLens reads it from Google and Meta only when you open a screen or ask a question, with read-only access. It is shown to you and held in the server\'s memory for up to about ten minutes to avoid asking Google and Meta again; it is not saved to AdLens\'s database.',
      ],
    },
    {
      id: 'google',
      title: 'Google user data',
      paragraphs: [
        'AdLens asks Google for read-only access to Google Analytics 4 and Google Search Console so it can show you reports for the properties and sites you choose. It cannot change anything in those accounts.',
        GOOGLE_LIMITED_USE_STATEMENT,
        'In practice this means: Google data is used only to show you your own reports and answer your own questions; it is not sold, not used for advertising, not used to build or train AI models, and no person at AdLens reads it unless you ask for help with a specific problem and agree.',
      ],
    },
    {
      id: 'meta',
      title: 'Meta (Facebook and Instagram) data',
      paragraphs: [
        'When you choose Connect Facebook, AdLens asks for read-only access to your ad accounts (the ads_read permission) to show spend, reach, clicks and results. It cannot create, edit or pause ads.',
        'AdLens follows the Meta Platform Terms. If you remove AdLens in your Facebook settings, or ask Facebook to delete your AdLens data, AdLens receives a signed notice and deletes your Facebook connection. You can check the result on the data deletion page.',
      ],
    },
    {
      id: 'ai',
      title: 'AI processing',
      paragraphs: [
        'When you ask the AI Analyst a question, AdLens sends the question and the report numbers needed to answer it to Google Gemini. This happens only when you ask, and only after you have agreed to it.',
        'If you set up your own AI agent (an AI provider key or a webhook), your numbers are sent to that provider only when you ask a question through that agent, and only after you confirm that you allow it. Their handling of the data is covered by their own terms.',
        'In Private mode the question is answered by the AI model built into your browser, on your device. In that mode nothing is sent to the cloud unless you turn on cloud fallback or choose to ask the cloud model for that one question.',
      ],
    },
    {
      id: 'share',
      title: 'Who we share data with',
      paragraphs: [
        'AdLens does not sell your data. It uses these service providers to run the product: Google Cloud and Firebase (sign-in and database, hosted in the Asia-Southeast region), Google Gemini (AI answers, when you ask), and the AI provider you choose if you add your own agent.',
        'Your workspace members can see what you share with the workspace, such as projects, saved reports and dashboards. We may disclose information if the law requires it.',
      ],
    },
    {
      id: 'cookies',
      title: 'Cookies and similar storage',
      paragraphs: [
        'AdLens uses only essential cookies and browser storage: to keep you signed in, to complete the Google and Facebook connection safely, and to remember settings such as your theme and AI engine choice. It does not use advertising or analytics cookies.',
      ],
    },
    {
      id: 'keep',
      title: 'How long we keep it, and deleting it',
      paragraphs: [
        'We keep your account and settings until you delete them. Disconnecting Google or Facebook in Connections removes the stored access and asks the provider to revoke it. Deleting your account removes your connections, your personal data and the workspaces you own. If you own a workspace with other members, transfer ownership or remove them first.',
        'You can also remove AdLens from your Google account permissions page or your Facebook business integrations settings at any time. To ask for something that cannot be done in the app, write to us using the contact above.',
      ],
    },
    {
      id: 'security',
      title: 'Security',
      paragraphs: [
        'Credentials are encrypted and bound to your account; connections are made over HTTPS; browsers cannot read the database that holds connections, agents or dashboards directly. No system is perfectly secure, so please use a strong password and tell us promptly if you suspect a problem.',
      ],
    },
    {
      id: 'rights',
      title: 'Your rights',
      paragraphs: [
        'Depending on where you live you may have the right to access, correct, export or delete your personal data, and to object to or restrict certain uses. Most of this you can do yourself in AdLens; for the rest, contact us and we will respond.',
      ],
    },
    {
      id: 'children',
      title: 'Children',
      paragraphs: ['AdLens is for businesses and is not directed to children under 16.'],
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      paragraphs: [`We will update this page when our practices change and show the date at the top. This version was last updated on ${LEGAL_LAST_UPDATED}.`],
    },
  ];
}

export function termsSections(o: LegalOwner): LegalSection[] {
  return [
    {
      id: 'agreement',
      title: 'Agreement',
      paragraphs: [
        `These terms are between you and ${o.entity}, which operates AdLens. By creating an account or using AdLens you agree to them and to the Privacy Policy. If you use AdLens for an organisation, you confirm you may accept these terms for it.`,
      ],
    },
    {
      id: 'service',
      title: 'What AdLens does',
      paragraphs: [
        'AdLens shows reports from the Google Analytics 4, Google Search Console and Meta Ads accounts you connect, and offers AI-written explanations of those reports. It reads data only; it does not change your accounts or your ads.',
        'AdLens is provided as a beta. Features, limits and availability can change.',
      ],
    },
    {
      id: 'accounts',
      title: 'Your account and connections',
      paragraphs: [
        'Keep your sign-in details safe and tell us if you think someone else has used your account. Connect only accounts you are allowed to connect. You can disconnect any account, or delete your account, at any time.',
      ],
    },
    {
      id: 'use',
      title: 'Acceptable use',
      paragraphs: [
        'Do not misuse AdLens: do not try to break or probe it, overload it, resell access to it, or use it to break the law or the rules of Google, Meta or any AI provider. Do not connect accounts you do not have permission to use.',
      ],
    },
    {
      id: 'ai-answers',
      title: 'AI answers',
      paragraphs: [
        'AI answers are generated automatically and can be wrong or incomplete. Each answer shows the numbers it used so you can check it. Treat AI output as a starting point for your own judgement, not as professional advice.',
      ],
    },
    {
      id: 'third',
      title: 'Third-party services',
      paragraphs: [
        'AdLens depends on Google, Meta and AI providers. Their services, limits and terms apply to your use of them, and they can change or be unavailable without notice. If you use your own AI provider key, you are responsible for its cost and for following that provider\'s terms.',
      ],
    },
    {
      id: 'content',
      title: 'Your data',
      paragraphs: [
        'You keep all rights to your data and your reports. You allow AdLens to read, process and show them to you, and to send them to the AI services you choose, so the product can work.',
      ],
    },
    {
      id: 'warranty',
      title: 'No warranty and limits',
      paragraphs: [
        'AdLens is provided as is, without promises that it will be uninterrupted or error-free, or that the numbers match your own tools exactly. To the extent the law allows, we are not liable for indirect or consequential loss, or for decisions you make based on AdLens, and our total liability is limited to what you paid us for AdLens in the twelve months before the claim.',
      ],
    },
    {
      id: 'plans',
      title: 'Plans, payments, cancellation and refunds',
      paragraphs: [
        'AdLens has a Free plan and paid plans (Pro and Business). What each plan includes, and its price in US dollars and Bangladeshi taka, is shown in the Pricing section on the home page and under Settings, Plan and billing. Limits include the number of projects, AI questions each month, team members, saved items and how many days of data you can look back. We may change plans and prices for future periods; the price on your invoice is the price you pay.',
        'There is no automatic card payment. When you ask for a paid plan we send you an invoice and payment details, and we switch the plan on after we receive your payment. A paid plan runs for the period on the invoice and ends on the end date shown in Settings. It does not renew by itself, so there is nothing to cancel: if you do not pay for a new period, the plan simply ends. After the end date there is a 7-day grace period, then the workspace moves to the Free plan.',
        'When a plan ends we do not delete your data. You move to the Free limits: you may not be able to add new items above those limits, and data older than the Free history limit is not shown until you upgrade again. You can stop using AdLens and delete your account at any time.',
        'Refunds: you can ask for a refund within 3 days of the payment date. Refunds are not available after 3 days from the payment date. To ask, write to us using the contact details at the end of these terms and include your workspace name and the invoice number.',
      ],
    },
    {
      id: 'ending',
      title: 'Ending your use',
      paragraphs: [
        'You can stop using AdLens and delete your account at any time. We may suspend or end access if these terms are broken or if needed to protect the service or other people.',
      ],
    },
    {
      id: 'changes',
      title: 'Changes and contact',
      paragraphs: [
        `We may update these terms and will show the date on this page. These terms were last updated on ${LEGAL_LAST_UPDATED}. ${contactLine(o)}`,
      ],
    },
  ];
}
