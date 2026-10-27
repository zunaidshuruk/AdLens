import React, { useEffect } from 'react';
import { PublicShell } from '../components/PublicShell';
import { LEGAL_LAST_UPDATED, privacySections, termsSections } from '../config/legalContent.js';
import { usePublicLegal } from '../hooks/usePublicLegal';

export const LegalPage: React.FC<{ kind: 'privacy' | 'terms' }> = ({ kind }) => {
  const owner = usePublicLegal();
  const sections = kind === 'privacy' ? privacySections(owner) : termsSections(owner);
  const title = kind === 'privacy' ? 'Privacy Policy' : 'Terms of Service';

  useEffect(() => {
    document.title = `${title} — AdLens`;
    if (window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    }
  }, [title]);

  return (
    <PublicShell>
      <article className="max-w-3xl">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg">{title}</h1>
        <p className="mt-1 text-xs text-fg-muted">Last updated {LEGAL_LAST_UPDATED}</p>
        <nav aria-label="On this page" className="mt-6 rounded-xl border border-line bg-surface p-4">
          <ol className="text-sm columns-1 sm:columns-2 gap-6 list-decimal pl-5 space-y-1">
            {sections.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="text-accent-text hover:underline">{s.title}</a></li>
            ))}
          </ol>
        </nav>
        <div className="mt-8 space-y-8">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20">
              <h2 className="text-lg font-semibold text-fg">{s.title}</h2>
              {s.paragraphs.map((p) => (
                <p key={p} className="mt-2 text-sm leading-6 text-fg">{p}</p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </PublicShell>
  );
};
