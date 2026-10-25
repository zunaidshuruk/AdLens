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
    'bg-fill-3',
    'bg-danger',
    'bg-warning',
    'bg-accent',
    'bg-success',
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
          <span className="text-fg-muted">Password strength</span>
          <span
            className={`font-semibold ${
              password.length === 0
                ? 'text-fg-subtle'
                : rules.score <= 1
                  ? 'text-danger'
                  : rules.score === 2
                    ? 'text-warning'
                    : rules.score === 3
                      ? 'text-accent-text'
                      : 'text-success'
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
                  : 'bg-fill-3'
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
                ? 'text-success font-medium'
                : 'text-fg-muted'
            }`}
          >
            {item.met ? (
              <Check className="w-3.5 h-3.5 shrink-0 text-success" />
            ) : (
              <Circle className="w-3 h-3 shrink-0 text-line-strong" />
            )}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
