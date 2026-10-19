import React from 'react';
import { Check, Circle } from 'lucide-react';
import { evaluatePasswordRules } from '../utils/firebaseErrors';

interface PasswordStrengthChecklistProps {
  password: string;
}

export const PasswordStrengthChecklist: React.FC<PasswordStrengthChecklistProps> = ({
  password,
}) => {
  const rules = evaluatePasswordRules(password);

  const barColors = [
    'bg-slate-200 dark:bg-slate-800',
    'bg-red-500',
    'bg-amber-500',
    'bg-blue-500',
    'bg-emerald-500',
  ];

  const activeColor = password.length === 0 ? barColors[0] : barColors[rules.score];

  const items = [
    { key: 'minLength', label: '8+ characters', met: rules.minLength },
    { key: 'hasUpper', label: 'At least 1 uppercase letter (A–Z)', met: rules.hasUpper },
    { key: 'hasLower', label: 'At least 1 lowercase letter (a–z)', met: rules.hasLower },
    { key: 'hasNumber', label: 'At least 1 number (0–9)', met: rules.hasNumber },
  ];

  return (
    <div className="space-y-2.5 pt-1" data-testid="password-strength-checklist">
      {/* Strength Meter Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-slate-500 dark:text-slate-400">Password strength</span>
          <span
            className={`font-semibold ${
              password.length === 0
                ? 'text-slate-400 dark:text-slate-500'
                : rules.score <= 1
                  ? 'text-red-600 dark:text-red-400'
                  : rules.score === 2
                    ? 'text-amber-600 dark:text-amber-400'
                    : rules.score === 3
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {password.length === 0 ? 'Enter password' : rules.label}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-1.5 h-1.5">
          {[1, 2, 3, 4].map((step) => (
            <div
              key={step}
              className={`rounded-full transition-colors ${
                password.length > 0 && rules.score >= step
                  ? activeColor
                  : 'bg-slate-200 dark:bg-slate-800'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Checklist */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
        {items.map((item) => (
          <li
            key={item.key}
            className={`flex items-center gap-1.5 ${
              item.met
                ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {item.met ? (
              <Check className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Circle className="w-3 h-3 shrink-0 text-slate-300 dark:text-slate-600" />
            )}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
