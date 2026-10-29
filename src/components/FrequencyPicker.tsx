import React from 'react';
import { type Frequency, type FrequencyFields, cleanWeekdays, frequencyLabel } from '../utils/scheduleFrequency';

export interface FrequencyValue { frequency: Frequency; weekdays: number[]; monthDay: number; intervalDays: number }
export const DEFAULT_FREQUENCY: FrequencyValue = { frequency: 'weekly', weekdays: [1], monthDay: 1, intervalDays: 3 };
export const toFrequencyValue = (s: FrequencyFields): FrequencyValue => ({ frequency: s.frequency, weekdays: cleanWeekdays(s.weekdays), monthDay: s.monthDay ?? 1, intervalDays: s.intervalDays ?? 3 });
/** Why the choice cannot be saved, or null when it is fine. */
export const frequencyProblem = (v: FrequencyValue): string | null => (v.frequency === 'weekly' && v.weekdays.length === 0 ? 'Choose at least one day of the week.' : v.frequency === 'interval' && (!Number.isInteger(v.intervalDays) || v.intervalDays < 2 || v.intervalDays > 60) ? 'Choose a number of days between 2 and 60.' : null);

const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const field = 'rounded-lg border border-line bg-surface text-fg text-sm px-3 py-2 min-h-[40px]';

/** "How often": every day, chosen days of the week, a day of the month, or every few days. */
export const FrequencyPicker: React.FC<{ value: FrequencyValue; onChange: (v: FrequencyValue) => void; id: string }> = ({ value, onChange, id }) => {
  const set = (patch: Partial<FrequencyValue>) => onChange({ ...value, ...patch });
  const problem = frequencyProblem(value);
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-fg space-y-1" htmlFor={`${id}-how`}>How often
        <select id={`${id}-how`} className={`${field} block`} value={value.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
          <option value="daily">Every day</option>
          <option value="weekly">On days of the week I choose</option>
          <option value="monthly">On a day of the month</option>
          <option value="interval">Every few days</option>
        </select>
      </label>
      {value.frequency === 'weekly' && (
        <fieldset className="space-y-1"><legend className="text-xs font-medium text-fg">Which days</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map(([n, label]) => {
              const on = value.weekdays.includes(n);
              return <label key={n} className={`cursor-pointer select-none rounded-lg border px-2.5 py-1.5 text-xs min-h-[36px] inline-flex items-center ${on ? 'border-accent bg-accent-soft text-accent-text' : 'border-line text-fg hover:bg-fill-2'}`}><input type="checkbox" className="sr-only" checked={on} onChange={() => set({ weekdays: (on ? value.weekdays.filter((d) => d !== n) : [...value.weekdays, n]).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) })} />{label}</label>;
            })}
          </div>
        </fieldset>
      )}
      {value.frequency === 'monthly' && (
        <label className="block text-xs font-medium text-fg space-y-1" htmlFor={`${id}-day`}>Day of the month
          <select id={`${id}-day`} className={`${field} block`} value={value.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            <option value={31}>Last day of the month</option>
          </select>
          {value.monthDay >= 29 && value.monthDay < 31 && <span className="block text-[11px] font-normal text-fg-muted">In shorter months it goes out on the last day.</span>}
        </label>
      )}
      {value.frequency === 'interval' && (
        <label className="block text-xs font-medium text-fg space-y-1" htmlFor={`${id}-n`}>Send every
          <span className="flex items-center gap-2"><input id={`${id}-n`} type="number" min={2} max={60} inputMode="numeric" className={`${field} w-24`} value={Number.isFinite(value.intervalDays) ? value.intervalDays : ''} onChange={(e) => set({ intervalDays: e.target.value === '' ? NaN : Number(e.target.value) })} /> <span className="text-fg-muted font-normal">days</span></span>
        </label>
      )}
      <p className={`text-[11px] ${problem ? 'text-danger' : 'text-fg-muted'}`} role={problem ? 'alert' : undefined}>{problem ?? `It will go out ${frequencyLabel(value)}. Emails are sent once a day, in the early morning (UTC), so the exact hour cannot be chosen.`}</p>
    </div>
  );
};
