import React, { useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, MessageSquare, Send, User } from 'lucide-react';
import { ApiClientError, apiClient } from '../api/client';
import { APP_NAME, DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useDateRange } from '../hooks';
import type { AskAnalystHistoryMessage, AskAnalystNumberUsed } from '../types';
import { formatFullDateRange } from '../utils/dateUtils';

export const MAX_ANALYST_QUESTION_LENGTH = 2000;
export const MAX_ANALYST_HISTORY_MESSAGES = 20;

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  numbersUsed?: AskAnalystNumberUsed[];
}

export function formatAnalystErrorMessage(code?: string, serverMessage?: string): string {
  switch (code) {
    case 'NO_DATA_SOURCES':
      return 'Connect Google Analytics, Search Console or Meta on the Connections page first.';
    case 'CLOUD_NOT_CONFIGURED':
      return "The AI analyst isn't set up yet.";
    case 'QUOTA_EXCEEDED':
      return "You've used all AI questions for this month.";
    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many questions. Wait a minute.';
    default:
      return serverMessage && serverMessage.trim()
        ? serverMessage
        : 'Unable to complete your question right now.';
  }
}

export function trimHistoryMessages(messages: ChatTurn[]): AskAnalystHistoryMessage[] {
  return messages
    .map((m) => ({
      role: m.role,
      content: m.content,
    }))
    .slice(-MAX_ANALYST_HISTORY_MESSAGES);
}

export const AIAnalystPage: React.FC = () => {
  const { dateRange, compareEnabled } = useDateRange();
  const { activeProject } = useAppContext();
  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: activeProject?.domain || DEMO_PROJECT.domain,
  };

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [isWaiting, setIsWaiting] = useState(false);
  const [openNumbersIds, setOpenNumbersIds] = useState<Record<string, boolean>>({});
  const seqRef = useRef(1);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const sampleQuestions = [
    `Which Meta Ads campaign drove the lowest cost per demo_request on ${TRACKED_SITE.domain} during ${formatFullDateRange(dateRange.startDate, dateRange.endDate)}?`,
    `Compare Organic Search conversion rate vs Paid Social conversion rate for ${TRACKED_SITE.name} this period.`,
    `Which Search Console queries with high impressions have a CTR below 4% and rank between positions 4 and 10?`,
    `How did weekend traffic in Asia/Dhaka affect ${TRACKED_SITE.name} enterprise trial signups?`,
  ];

  const toggleNumbersPanel = (id: string) => {
    setOpenNumbersIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleSampleClick = (sample: string) => {
    setQuestion(sample.slice(0, MAX_ANALYST_QUESTION_LENGTH));
    textareaRef.current?.focus();
  };

  const handleSend = async () => {
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > MAX_ANALYST_QUESTION_LENGTH || isWaiting) {
      return;
    }

    const historyToSend = trimHistoryMessages(messages);
    const userTurn: ChatTurn = {
      id: `turn_${seqRef.current++}`,
      role: 'user',
      content: trimmed,
    };

    setQuestion('');
    setIsWaiting(true);
    setMessages((prev) => [...prev, userTurn].slice(-MAX_ANALYST_HISTORY_MESSAGES));

    try {
      const hasComparison = Boolean(
        compareEnabled && dateRange.compareStartDate && dateRange.compareEndDate
      );

      const res = await apiClient.askAnalyst({
        question: trimmed,
        history: historyToSend,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        ...(hasComparison
          ? {
              compareStartDate: dateRange.compareStartDate,
              compareEndDate: dateRange.compareEndDate,
            }
          : {}),
      });

      const isAnswerOk = Boolean(res.ok && !res.error);
      const assistantContent = isAnswerOk
        ? res.answer
        : formatAnalystErrorMessage(res.error?.code, res.error?.message || res.answer);

      const assistantTurn: ChatTurn = {
        id: `turn_${seqRef.current++}`,
        role: 'assistant',
        content: assistantContent,
        isError: !isAnswerOk,
        numbersUsed: Array.isArray(res.numbersUsed) ? res.numbersUsed : [],
      };

      setMessages((prev) => [...prev, assistantTurn].slice(-MAX_ANALYST_HISTORY_MESSAGES));
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      const msg = err instanceof Error ? err.message : undefined;
      const friendly = formatAnalystErrorMessage(code, msg);

      const errorTurn: ChatTurn = {
        id: `turn_${seqRef.current++}`,
        role: 'assistant',
        content: friendly,
        isError: true,
        numbersUsed: [],
      };

      setMessages((prev) => [...prev, errorTurn].slice(-MAX_ANALYST_HISTORY_MESSAGES));
    } finally {
      setIsWaiting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const canSend = !isWaiting && question.trim().length > 0 && question.length <= MAX_ANALYST_QUESTION_LENGTH;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
            AI Marketing Analyst
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted mt-0.5">
            Cross-channel conversational intelligence across Google Analytics 4, Search Console, and Meta Ads
          </p>
        </div>
      </div>

      {/* Chat Console */}
      <div className="rounded-xl border border-line bg-surface flex flex-col min-h-[540px] justify-between overflow-hidden">
        {/* Conversation Area */}
        <div className="p-4 sm:p-6 flex-1 flex flex-col gap-5 overflow-y-auto">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center max-w-2xl mx-auto my-auto py-4">
              <div className="w-12 h-12 rounded-xl bg-accent text-on-accent flex items-center justify-center mb-4">
                <Bot className="w-6 h-6" />
              </div>

              <h2 className="text-lg font-bold text-fg">
                Ask {APP_NAME} AI Analyst
              </h2>

              <p className="mt-1.5 text-xs sm:text-sm text-fg-muted leading-relaxed">
                Ask questions about{' '}
                <span className="font-medium text-fg">
                  {TRACKED_SITE.name} ({TRACKED_SITE.domain})
                </span>{' '}
                for {formatFullDateRange(dateRange.startDate, dateRange.endDate)}.
              </p>
            </div>
          )}

          {/* Sample Question Chips */}
          <div className="w-full max-w-3xl mx-auto">
            <div className="text-xs font-semibold text-fg-muted mb-2">
              Sample questions:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sampleQuestions.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSampleClick(q)}
                  data-testid={`analyst-sample-chip-${i}`}
                  className="p-3 rounded-lg border border-line bg-fill-1 hover:bg-fill-2 text-left text-xs text-fg-muted hover:text-fg flex items-start gap-2.5 transition-colors cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-accent-text shrink-0 mt-0.5" />
                  <span>{q}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Message List */}
          {messages.length > 0 && (
            <div
              data-testid="analyst-message-list"
              className="w-full max-w-3xl mx-auto space-y-4 pt-2"
            >
              {messages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div
                      key={msg.id}
                      data-testid="analyst-user-bubble"
                      className="flex justify-end"
                    >
                      <div className="max-w-[85%] sm:max-w-[75%] flex items-start gap-2.5">
                        <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-accent text-on-accent text-xs sm:text-sm whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                        <div className="w-7 h-7 rounded-lg bg-accent-soft border border-accent-line text-accent-text flex items-center justify-center shrink-0 mt-0.5">
                          <User className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  );
                }

                const isNumbersOpen = Boolean(openNumbersIds[msg.id]);
                const numbersList = msg.numbersUsed ?? [];

                return (
                  <div
                    key={msg.id}
                    data-testid="analyst-assistant-bubble"
                    className="flex justify-start"
                  >
                    <div className="max-w-[90%] sm:max-w-[80%] flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-fill-2 border border-line text-accent-text flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div
                          className={`px-4 py-3 rounded-2xl rounded-tl-sm border text-xs sm:text-sm whitespace-pre-wrap break-words ${
                            msg.isError
                              ? 'bg-warning-soft border-warning-line text-fg'
                              : 'bg-fill-1 border-line text-fg'
                          }`}
                        >
                          {msg.content}
                        </div>

                        {/* Collapsible "Numbers used" panel (closed by default) */}
                        <div className="rounded-lg border border-line bg-surface overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleNumbersPanel(msg.id)}
                            aria-expanded={isNumbersOpen}
                            data-testid="analyst-numbers-toggle"
                            className="w-full px-3 py-1.5 flex items-center justify-between gap-2 text-xs font-medium text-fg-muted hover:text-fg hover:bg-fill-1 transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5">
                              {isNumbersOpen ? (
                                <ChevronDown className="w-3.5 h-3.5 text-fg-subtle" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-fg-subtle" />
                              )}
                              <span>Numbers used</span>
                            </span>
                            <span className="text-[11px] font-mono text-fg-subtle">
                              {numbersList.length}
                            </span>
                          </button>

                          {isNumbersOpen && (
                            <div
                              data-testid="analyst-numbers-panel"
                              className="px-3 py-2.5 border-t border-line bg-fill-1 space-y-2 text-xs"
                            >
                              {numbersList.length === 0 ? (
                                <div className="text-fg-muted">
                                  No data was used for this answer.
                                </div>
                              ) : (
                                numbersList.map((item, idx) => (
                                  <div
                                    key={`${item.toolId}_${idx}`}
                                    className="p-2 rounded border border-line bg-surface space-y-1"
                                  >
                                    <div className="font-mono font-semibold text-accent-text text-[11px]">
                                      {item.toolId}
                                    </div>
                                    <pre className="font-mono text-[11px] text-fg-muted whitespace-pre-wrap break-words">
                                      {item.text}
                                    </pre>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {isWaiting && (
                <div
                  data-testid="analyst-waiting-indicator"
                  className="flex justify-start"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-fill-2 border border-line text-accent-text flex items-center justify-center shrink-0">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm border border-line bg-fill-1 text-xs sm:text-sm text-fg-muted">
                      Analysing your data…
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {messages.length === 0 && isWaiting && (
            <div
              data-testid="analyst-waiting-indicator"
              className="w-full max-w-3xl mx-auto flex justify-start"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-fill-2 border border-line text-accent-text flex items-center justify-center shrink-0">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm border border-line bg-fill-1 text-xs sm:text-sm text-fg-muted">
                  Analysing your data…
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Chat Composer */}
        <div className="p-4 border-t border-line bg-page/60">
          <div className="max-w-3xl mx-auto space-y-1.5">
            <div className="flex items-end gap-2.5">
              <textarea
                ref={textareaRef}
                rows={2}
                maxLength={MAX_ANALYST_QUESTION_LENGTH}
                value={question}
                onChange={(e) => setQuestion(e.target.value.slice(0, MAX_ANALYST_QUESTION_LENGTH))}
                onKeyDown={handleKeyDown}
                aria-label="Ask AI Analyst"
                placeholder={`Ask ${APP_NAME} Analyst about ${TRACKED_SITE.name} campaigns, queries, or conversions...`}
                className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm rounded-lg border border-line bg-surface text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-focus resize-none"
              />
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void handleSend()}
                aria-label="Send message"
                data-testid="analyst-send-button"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs sm:text-sm font-medium rounded-lg bg-accent hover:bg-accent-hover text-on-accent disabled:bg-fill-3 disabled:text-fg-muted disabled:cursor-not-allowed whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-fg-subtle px-0.5">
              <span>Press Enter to send, Shift+Enter for a new line</span>
              <span data-testid="analyst-char-counter" className="font-mono">
                {question.length}/{MAX_ANALYST_QUESTION_LENGTH}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
