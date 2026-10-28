import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Compass, LayoutGrid, Lock, Sparkles } from 'lucide-react';
import { PublicShell } from '../components/PublicShell';
import { apiClient } from '../api/client';
import { APP_NAME } from '../config/app';
import type { PublicConfigResponse } from '../types';

const FEATURES = [
  { icon: BarChart3, title: 'All your numbers in one place', text: 'Connect Google Analytics 4, Search Console and Meta Ads and see website visits, search results and ad spend side by side.' },
  { icon: Compass, title: 'Find what to do next', text: 'Rising and falling searches, easy SEO wins, pages that compete with each other, and what each ad campaign really brought to your site.' },
  { icon: LayoutGrid, title: 'Build your own dashboards', text: 'Start from a template, or describe the chart you want in plain words. Put a dashboard on a screen in presentation mode.' },
  { icon: Sparkles, title: 'Ask questions in plain language', text: 'An AI analyst reads your real numbers and answers with the data it used. Use Gemini, your own AI provider, or Private mode that runs in your browser.' },
  { icon: Lock, title: 'Read-only and private', text: 'AdLens can only read your data, never change it. Connections are encrypted, and you can disconnect or delete everything at any time.' },
];

type PublicPlan = NonNullable<PublicConfigResponse['plans']>[number];

const days = (n: number | null) => (n === null ? 'All your data history' : `Last ${n} days of data`);
const price = (p: PublicPlan) => (p.priceUsd === 0 ? 'Free' : `$${p.priceUsd} / month`);

/** What each plan includes. Numbers come from the server, so changes made in the admin panel show here too. */
const PricingSection: React.FC<{ plans: PublicPlan[] }> = ({ plans }) => (
  <section id="pricing" aria-label="Pricing" className="mt-12">
    <h2 className="text-xl font-bold tracking-tight text-fg">Pricing</h2>
    <p className="mt-1 text-sm text-fg-muted">Start free. Upgrade when you need more projects, AI questions, people or history.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      {plans.map((p) => (
        <div key={p.id} data-testid={`pricing-${p.id}`} className="rounded-xl border border-line bg-surface p-5">
          <h3 className="text-sm font-semibold text-fg">{p.label}</h3>
          <p className="mt-1 text-2xl font-bold text-fg">{price(p)}</p>
          {p.priceBdt > 0 && <p className="text-xs text-fg-muted">or ৳{p.priceBdt.toLocaleString('en-US')} / month</p>}
          <ul className="mt-3 space-y-1.5 text-sm text-fg-muted">
            <li>{p.maxProjects} {p.maxProjects === 1 ? 'project' : 'projects'}</li>
            <li>{p.aiQuestionsPerMonth.toLocaleString('en-US')} AI questions a month</li>
            <li>{p.maxMembers} {p.maxMembers === 1 ? 'person' : 'people'} in the workspace</li>
            <li>{days(p.historyDays)}</li>
            <li>{p.emailSummaries ? 'Weekly email summaries and alerts' : 'No email summaries'}</li>
          </ul>
        </div>
      ))}
    </div>
    <p className="mt-3 text-xs text-fg-muted max-w-3xl">
      There is no automatic card payment: ask for a paid plan inside AdLens and we send you an invoice. Plans do not renew by themselves. You can ask for a refund within 3 days of paying; refunds are not available after 3 days. Details in the <Link to="/terms#plans" className="text-accent-text underline">Terms of Service</Link>.
    </p>
  </section>
);

export const LandingPage: React.FC = () => {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  useEffect(() => {
    let live = true;
    apiClient.getPublicConfig().then((c) => { if (live && c.plans?.length) setPlans(c.plans); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    document.title = `${APP_NAME} — Marketing analytics for your website, search and ads`;
  }, []);
  return (
    <PublicShell>
      <section className="py-8 sm:py-14 max-w-3xl">
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-fg">Your website, search and ads, explained.</h1>
        <p className="mt-4 text-base sm:text-lg text-fg-muted">
          {APP_NAME} brings Google Analytics 4, Google Search Console and Meta Ads into one console, shows what is changing, and answers your questions with an AI analyst that works from your real numbers.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/sign-up" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-hover">Create a free account</Link>
          <Link to="/sign-in" className="rounded-lg border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-fg hover:bg-fill-1">Sign in</Link>
        </div>
      </section>
      <section aria-label="What AdLens does" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border border-line bg-surface p-5">
            <div className="w-9 h-9 rounded-lg bg-accent-soft text-accent-text flex items-center justify-center"><f.icon className="w-5 h-5" /></div>
            <h2 className="mt-3 text-sm font-semibold text-fg">{f.title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{f.text}</p>
          </div>
        ))}
      </section>
      {plans.length > 0 && <PricingSection plans={plans} />}
      <section className="mt-10 rounded-xl border border-line bg-surface p-5 text-sm text-fg-muted max-w-3xl">
        <h2 className="text-sm font-semibold text-fg">How AdLens uses your Google data</h2>
        <p className="mt-1">
          AdLens asks for read-only access to Google Analytics and Search Console and uses it only to show you your own reports and answer your own questions. Read the <Link to="/privacy" className="text-accent-text underline">Privacy Policy</Link> and <Link to="/terms" className="text-accent-text underline">Terms of Service</Link>.
        </p>
      </section>
    </PublicShell>
  );
};
