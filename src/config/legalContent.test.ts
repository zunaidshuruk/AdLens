import assert from 'node:assert/strict';
import test from 'node:test';
import { GOOGLE_LIMITED_USE_STATEMENT, privacySections, termsSections } from './legalContent.js';

const owner = { entity: 'Synesis IT PLC', supportEmail: 'help@example.org', address: '' };
const text = (s: { title: string; paragraphs: string[] }[]) => s.flatMap((x) => [x.title, ...x.paragraphs]).join('\n');

test('privacy policy carries the Google Limited Use statement word for word', () => {
  assert.match(text(privacySections(owner)), /will adhere to the Google API Services User Data Policy, including the Limited Use requirements\./);
  assert.ok(GOOGLE_LIMITED_USE_STATEMENT.startsWith("AdLens's use and transfer to any other app of information received from Google APIs"));
});

test('privacy policy covers everything the platform reviews ask for', () => {
  const t = text(privacySections(owner));
  for (const needle of [/read-only/i, /AES-256-GCM/, /Gemini/, /Private mode/, /ads_read/, /Meta Platform Terms/, /data deletion/i, /Deleting your account/, /essential cookies/i, /does not sell/i]) {
    assert.match(t, needle, String(needle));
  }
});

test('the owner name and contact come from settings, and a missing email never prints a placeholder', () => {
  assert.match(text(privacySections(owner)), /Email: help@example\.org/);
  const none = text(privacySections({ ...owner, supportEmail: '' }));
  assert.match(none, /Help link inside AdLens/);
  assert.doesNotMatch(none, /example|TODO|\[.*\]/);
  assert.match(text(termsSections(owner)), /Synesis IT PLC/);
});

test('section ids are unique so page anchors work', () => {
  for (const sections of [privacySections(owner), termsSections(owner)]) {
    const ids = sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});
