import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Send,
  Shield,
  User,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiClientError, apiClient } from '../api/client';
import { AnalystMessage } from '../components/AnalystMessage';
import { APP_NAME, DEMO_PROJECT } from '../config/app';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useDateRange } from '../hooks';
import { AiEngineBar } from '../components/AiEngineBar';
import type { PublicAgent } from '../types/agents.js';
import type { AskAnalystHistoryMessage, AskAnalystNumberUsed } from '../types';
import { agentReadiness } from '../utils/agentForm.js';
import { chooseEngine, type EngineDecision, type EngineSettings, type OnDeviceStatus } from '../utils/aiEngineRouter.js';
import type { ToolSource } from '../utils/aiTools.js';
import { askOnDevice, detectOnDeviceStatus, downloadOnDeviceModel, getLanguageModel, loadEngineSettings, saveEngineSettings } from '../utils/onDeviceEngine.js';
import { formatFullDateRange } from '../utils/dateUtils';

export const MAX_ANALYST_QUESTION_LENGTH = 2000;
export const MAX_ANALYST_HISTORY_MESSAGES = 20;
export const AI_CONSENT_TITLE = 'Before you ask';
export const AI_CONSENT_BODY =
  "To answer, AdLens sends the report numbers for your selected project and dates, plus your question, to Google's Gemini AI. Your raw account data and sign-in details are never sent.";
export const AI_NOT_CONFIGURED_NOTICE =
  "The AI analyst isn't set up yet. The owner needs to add the AI key.";
export const AI_QUOTA_REACHED_TEXT = "You've used all AI questions for this month.";

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
  numbersUsed?: AskAnalystNumberUsed[];
  /** Who answered, e.g. "Gemini (AdLens analyst)" or the name of one of your agents. */
  engineLabel?: string;
  /** Answered on this device. These turns are never sent to the cloud or to your agents as chat history. */
  private?: boolean;
}

export function getAiConsentStorageKey(uid: string | null | undefined): string {
  const safeUid = uid && uid.trim() ? uid.trim() : 'anonymous';
  return `adlens_ai_consent_${safeUid}`;
}

export function hasStoredAiConsent(
  uid: string | null | undefined,
  storage?: Pick<Storage, 'getItem'> | null
): boolean {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    if (!store) return false;
    const val = store.getItem(getAiConsentStorageKey(uid));
    return val === '1' || val === 'true';
  } catch {
    return false;
  }
}

export function saveStoredAiConsent(
  uid: string | null | undefined,
  storage?: Pick<Storage, 'setItem'> | null
): boolean {
  try {
    const store =
      storage !== undefined
        ? storage
        : typeof window !== 'undefined'
          ? window.localStorage
          : null;
    if (!store) return false;
    store.setItem(getAiConsentStorageKey(uid), '1');
    return true;
  } catch {
    return false;
  }
}

export function formatUsageMeterText(used: number, limit: number): string {
  return `${used} of ${limit} AI questions used this month`;
}

const USAGE_WIDTH_CLASSES: readonly string[] = [
  'w-0',
  'w-[5%]',
  'w-[10%]',
  'w-[15%]',
  'w-[20%]',
  'w-[25%]',
  'w-[30%]',
  'w-[35%]',
  'w-[40%]',
  'w-[45%]',
  'w-[50%]',
  'w-[55%]',
  'w-[60%]',
  'w-[65%]',
  'w-[70%]',
  'w-[75%]',
  'w-[80%]',
  'w-[85%]',
  'w-[90%]',
  'w-[95%]',
  'w-full',
];

export function getUsageBarWidthClass(used: number, limit: number): string {
  if (limit <= 0 || used <= 0) return 'w-0';
  if (used >= limit) return 'w-full';
  const ratio = Math.min(1, Math.max(0, used / limit));
  const stepIndex = Math.max(1, Math.min(20, Math.round(ratio * 20)));
  return USAGE_WIDTH_CLASSES[stepIndex] ?? 'w-0';
}

export function formatAnalystErrorMessage(code?: string, serverMessage?: string): string {
  switch (code) {
    case 'NO_DATA_SOURCES':
      return 'Connect Google Analytics, Search Console or Meta on the Connections page first.';
    case 'CLOUD_NOT_CONFIGURED':
      return "The AI analyst isn't set up yet.";
    case 'QUOTA_EXCEEDED':
      return AI_QUOTA_REACHED_TEXT;
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

/** Chat history that may leave the device: everything except turns from Private (on-device) mode. */
export function historyForCloud(messages: ChatTurn[]): AskAnalystHistoryMessage[] {
  return trimHistoryMessages(messages.filter((m) => !m.private));
}

export const AIAnalystPage: React.FC = () => {
  const { dateRange, compareEnabled } = useDateRange();
  const { activeProject, activeWorkspace, userProfile } = useAppContext();
  const { user } = useAuth();
  const currentUid = user?.uid || userProfile?.uid || 'demo';

  const TRACKED_SITE = {
    name: activeProject?.name || DEMO_PROJECT.name,
    domain: activeProject?.domain || DEMO_PROJECT.domain,
  };

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [isWaiting, setIsWaiting] = useState(false);
  const [openNumbersIds, setOpenNumbersIds] = useState<Record<string, boolean>>({});
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 100 });
  const [aiConfigured, setAiConfigured] = useState<boolean>(true);
  const [hasConsented, setHasConsented] = useState<boolean>(() => hasStoredAiConsent(currentUid));
  const [consentDialogOpen, setConsentDialogOpen] = useState<boolean>(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [engineSettings, setEngineSettings] = useState<EngineSettings>(() => loadEngineSettings());
  const [onDeviceStatus, setOnDeviceStatus] = useState<OnDeviceStatus>('unsupported');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ decision: EngineDecision; question: string } | null>(null);

  const seqRef = useRef(1);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setHasConsented(hasStoredAiConsent(currentUid));
  }, [currentUid]);

  useEffect(() => {
    let active = true;
    apiClient
      .getAiUsage()
      .then((res) => {
        if (!active) return;
        setUsage({
          used: typeof res.used === 'number' ? res.used : 0,
          limit: typeof res.limit === 'number' ? res.limit : 100,
        });
        setAiConfigured(Boolean(res.aiConfigured));
      })
      .catch(() => {
        // Keep defaults in demo / unauthenticated fallback mode
      });
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id, activeProject?.id]);

  useEffect(() => {
    let active = true;
    setAgentId('');
    apiClient
      .listAgents()
      .then((res) => active && setAgents(res.agents))
      .catch(() => active && setAgents([]));
    return () => {
      active = false;
    };
  }, [activeWorkspace?.id, activeProject?.id]);

  useEffect(() => {
    let active = true;
    void detectOnDeviceStatus().then((st) => active && setOnDeviceStatus(st));
    return () => {
      active = false;
    };
  }, []);

  const changeEngineSettings = (next: EngineSettings) => {
    setEngineSettings(next);
    saveEngineSettings(next);
    setBlocked(null);
  };

  const startModelDownload = async () => {
    setDownloadError(null);
    setDownloadProgress(0);
    setOnDeviceStatus('downloading');
    try {
      await downloadOnDeviceModel((f) => setDownloadProgress(f));
    } catch {
      setDownloadError('The download did not finish. Check your connection and free disk space, then try again.');
    } finally {
      setDownloadProgress(null);
      setOnDeviceStatus(await detectOnDeviceStatus());
    }
  };

  const selectedAgent = agents.find((a) => a.id === agentId) ?? null;
  const agentState = selectedAgent ? agentReadiness(selectedAgent) : null;
  const usingAgent = selectedAgent !== null;
  // The monthly allowance and the server AI key only matter for the built-in analyst.
  const privateReady = engineSettings.preference === 'on-device' || onDeviceStatus === 'available';
  const isQuotaExhausted = !usingAgent && !privateReady && usage.limit > 0 && usage.used >= usage.limit;
  const engineConfigured = usingAgent ? Boolean(agentState?.ready) : aiConfigured || privateReady;

  const changeAgent = (next: string) => {
    // A different engine means a different company may read the chat, so start a fresh conversation.
    setAgentId(next);
    setMessages([]);
    setOpenNumbersIds({});
  };

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

  const executeQuestionSend = async (trimmed: string) => {
    const historyToSend = historyForCloud(messages);
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
        ...(selectedAgent ? { agentId: selectedAgent.id } : {}),
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        ...(hasComparison
          ? {
              compareStartDate: dateRange.compareStartDate,
              compareEndDate: dateRange.compareEndDate,
            }
          : {}),
      });

      if (
        res.quota &&
        typeof res.quota.used === 'number' &&
        typeof res.quota.limit === 'number'
      ) {
        setUsage({ used: res.quota.used, limit: res.quota.limit });
      }

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
        ...(res.engine?.label ? { engineLabel: res.engine.label } : {}),
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

  const engineEnv = () => ({
    onDevice: onDeviceStatus,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    cloudConfigured: aiConfigured,
    cloudQuotaRemaining: usage.limit > 0 ? Math.max(0, usage.limit - usage.used) : null,
  });

  const executeOnDeviceSend = async (trimmed: string) => {
    const historyToSend = trimHistoryMessages(messages);
    const userTurn: ChatTurn = { id: `turn_${seqRef.current++}`, role: 'user', content: trimmed, private: true };
    setQuestion('');
    setIsWaiting(true);
    setMessages((prev) => [...prev, userTurn].slice(-MAX_ANALYST_HISTORY_MESSAGES));

    const sources: ToolSource[] = [];
    if (activeProject?.ga4PropertyId) sources.push('ga4');
    if (activeProject?.searchConsoleSite) sources.push('search_console');
    if (activeProject?.metaAdAccountId) sources.push('meta');
    const hasComparison = Boolean(compareEnabled && dateRange.compareStartDate && dateRange.compareEndDate);
    const dates = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      ...(hasComparison ? { compareStartDate: dateRange.compareStartDate, compareEndDate: dateRange.compareEndDate } : {}),
    };

    try {
      const res = await askOnDevice(
        { question: trimmed, history: historyToSend, project: { name: TRACKED_SITE.name, domain: TRACKED_SITE.domain }, dates, availableSources: sources },
        {
          lm: getLanguageModel(),
          listTools: async () => (await apiClient.listReports()).map((r) => ({ id: r.id, title: r.title, description: r.description, source: r.source, input: r.input })),
          runReport: async (id, args) => (await apiClient.runReport({ id, args, ...dates })).result,
        }
      );
      const turn: ChatTurn = res.ok
        ? { id: `turn_${seqRef.current++}`, role: 'assistant', content: res.answer, numbersUsed: res.numbersUsed, engineLabel: 'Chrome built-in AI (on this device)', private: true }
        : { id: `turn_${seqRef.current++}`, role: 'assistant', content: res.message, isError: true, numbersUsed: [], private: true };
      setMessages((prev) => [...prev, turn].slice(-MAX_ANALYST_HISTORY_MESSAGES));
    } finally {
      setIsWaiting(false);
    }
  };

  const handleSend = async (opts: { forceCloudOnce?: boolean; text?: string } = {}) => {
    const trimmed = (opts.text ?? question).trim();
    if (
      !trimmed ||
      trimmed.length > MAX_ANALYST_QUESTION_LENGTH ||
      isWaiting ||
      isQuotaExhausted ||
      !engineConfigured
    ) {
      return;
    }
    setBlocked(null);

    // Your own agents record their own confirmation on the AI Agents page.
    if (usingAgent) {
      await executeQuestionSend(trimmed);
      return;
    }

    // Private mode: the router decides, and never sends a question to the cloud unless allowed.
    const decision = chooseEngine(engineSettings, engineEnv(), trimmed, { forceCloudOnce: opts.forceCloudOnce });
    if (decision.engine === 'none') {
      setBlocked({ decision, question: trimmed });
      return;
    }
    if (decision.engine === 'on-device') {
      await executeOnDeviceSend(trimmed);
      return;
    }

    const alreadyConsented = hasConsented || hasStoredAiConsent(currentUid);
    if (!alreadyConsented) {
      setPendingQuestion(trimmed);
      setConsentDialogOpen(true);
      return;
    }

    await executeQuestionSend(trimmed);
  };

  const handleConsentAgree = () => {
    saveStoredAiConsent(currentUid);
    setHasConsented(true);
    setConsentDialogOpen(false);
    const queued = pendingQuestion;
    setPendingQuestion(null);
    if (queued) {
      void executeQuestionSend(queued);
    }
  };

  const handleConsentCancel = () => {
    setConsentDialogOpen(false);
    setPendingQuestion(null);
  };

  const handleOpenReviewNotice = () => {
    setPendingQuestion(null);
    setConsentDialogOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const canSend =
    !isWaiting &&
    !isQuotaExhausted &&
    engineConfigured &&
    question.trim().length > 0 &&
    question.length <= MAX_ANALYST_QUESTION_LENGTH;

  return (
    <div className="space-y-6">
      {/* Page Header with Usage Meter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">
            AI Marketing Analyst
          </h1>
          <p className="text-xs sm:text-sm text-fg-muted mt-0.5">
            Cross-channel conversational intelligence across Google Analytics 4, Search Console, and Meta Ads
          </p>
        </div>

        {usingAgent ? (
          <div data-testid="analyst-agent-note" className="px-3.5 py-2.5 rounded-xl border border-line bg-surface min-w-[230px] text-xs text-fg-muted">
            Using your own AI agent. These questions do not use the monthly allowance.
          </div>
        ) : (
        <div
          data-testid="analyst-usage-meter"
          className="px-3.5 py-2.5 rounded-xl border border-line bg-surface min-w-[230px] space-y-1.5"
        >
          <div
            data-testid="analyst-usage-text"
            className={`text-xs font-medium ${isQuotaExhausted ? 'text-warning' : 'text-fg-muted'}`}
          >
            {formatUsageMeterText(usage.used, usage.limit)}
          </div>
          <div
            data-testid="analyst-usage-bar"
            role="progressbar"
            aria-valuenow={usage.used}
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-label="Monthly AI question usage"
            className="h-1.5 w-full rounded-full bg-fill-2 overflow-hidden"
          >
            <div
              data-testid="analyst-usage-bar-fill"
              className={`h-full rounded-full transition-all ${
                isQuotaExhausted ? 'bg-warning' : 'bg-accent'
              } ${getUsageBarWidthClass(usage.used, usage.limit)}`}
            />
          </div>
        </div>
        )}
      </div>

      {!usingAgent && (
        <AiEngineBar
          settings={engineSettings}
          onChange={changeEngineSettings}
          status={onDeviceStatus}
          downloadProgress={downloadProgress}
          onDownload={() => void startModelDownload()}
          downloadError={downloadError}
        />
      )}

      {agents.length > 0 && (
        <div data-testid="analyst-agent-picker" className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          <label htmlFor="analyst-agent-select" className="font-medium text-fg">Answer with</label>
          <select
            id="analyst-agent-select"
            value={agentId}
            onChange={(e) => changeAgent(e.target.value)}
            className="rounded-lg border border-line bg-surface text-fg text-xs px-2 py-2 min-h-[36px]"
          >
            <option value="">AdLens analyst (Gemini)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{agentReadiness(a).ready ? '' : ` (${agentReadiness(a).reason?.toLowerCase()})`}</option>
            ))}
          </select>
          <span>Switching starts a new conversation.</span>
        </div>
      )}

      {usingAgent && selectedAgent && !agentState?.ready && (
        <div role="status" data-testid="analyst-agent-not-ready" className="flex items-center gap-2.5 p-3 rounded-lg border border-warning-line bg-warning-soft text-xs text-fg">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <span>{selectedAgent.name} is not ready: {agentState?.reason?.toLowerCase()}. Fix it on the <Link to="/agents" className="text-accent-text underline">AI Agents page</Link>.</span>
        </div>
      )}

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
          {engineConfigured && (
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
          )}

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
                    <div className="w-full max-w-[96%] sm:max-w-[90%] flex items-start gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-fill-2 border border-line text-accent-text flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div
                          className={`px-4 py-3 rounded-2xl rounded-tl-sm border text-xs sm:text-sm break-words ${
                            msg.isError
                              ? 'bg-warning-soft border-warning-line text-fg whitespace-pre-wrap'
                              : 'bg-fill-1 border-line text-fg'
                          }`}
                        >
                          {msg.isError ? msg.content : <AnalystMessage content={msg.content} />}
                        </div>

                        {msg.engineLabel && !msg.isError && (
                          <p data-testid="analyst-engine-label" className="text-[11px] text-fg-subtle px-1">Answered by {msg.engineLabel}</p>
                        )}

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

        {blocked && (
          <div role="status" data-testid="analyst-engine-blocked" className="px-4 pt-4">
            <div className="max-w-3xl mx-auto flex flex-col gap-2 p-3 rounded-lg border border-warning-line bg-warning-soft text-xs text-fg">
              <span>{blocked.decision.message}</span>
              <div className="flex flex-wrap gap-2">
                {blocked.decision.offer === 'download-model' && (
                  <button type="button" onClick={() => void startModelDownload()} className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px]">Download the on-device model</button>
                )}
                {blocked.decision.offer === 'ask-cloud-once' && (
                  <button type="button" onClick={() => void handleSend({ forceCloudOnce: true, text: blocked.question })} className="rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2">Ask the cloud model this once</button>
                )}
                <button type="button" onClick={() => setBlocked(null)} className="rounded-lg border border-line text-xs px-3 py-2 min-h-[36px] text-fg hover:bg-fill-2">Dismiss</button>
              </div>
            </div>
          </div>
        )}

        {/* Chat Composer OR Not Configured Notice */}
        <div className="p-4 border-t border-line bg-page/60">
          {!aiConfigured && !usingAgent ? (
            <div
              role="status"
              data-testid="analyst-not-configured-notice"
              className="max-w-3xl mx-auto flex items-center gap-2.5 p-3.5 rounded-lg border border-warning-line bg-warning-soft text-xs sm:text-sm text-fg"
            >
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <span>{AI_NOT_CONFIGURED_NOTICE}</span>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-1.5">
              {isQuotaExhausted && (
                <div
                  role="status"
                  data-testid="analyst-quota-exhausted-notice"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-warning-line bg-warning-soft text-xs text-warning font-medium"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
                  <span>{AI_QUOTA_REACHED_TEXT}</span>
                </div>
              )}

              <div className="flex items-end gap-2.5">
                <textarea
                  ref={textareaRef}
                  rows={2}
                  maxLength={MAX_ANALYST_QUESTION_LENGTH}
                  value={question}
                  onChange={(e) =>
                    setQuestion(e.target.value.slice(0, MAX_ANALYST_QUESTION_LENGTH))
                  }
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
                <div className="flex items-center gap-2">
                  <span>Press Enter to send, Shift+Enter for a new line</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={handleOpenReviewNotice}
                    data-testid="analyst-review-notice-link"
                    className="text-accent-text hover:underline cursor-pointer"
                  >
                    Review notice
                  </button>
                </div>
                <span data-testid="analyst-char-counter" className="font-mono">
                  {question.length}/{MAX_ANALYST_QUESTION_LENGTH}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Consent Notice Dialog */}
      {consentDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-consent-dialog-title"
          data-testid="ai-consent-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/60 backdrop-blur-xs"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-accent-soft border border-accent-line text-accent-text flex items-center justify-center shrink-0">
                <Shield className="w-4 h-4" />
              </div>
              <h2
                id="ai-consent-dialog-title"
                className="text-base font-bold text-fg"
              >
                {AI_CONSENT_TITLE}
              </h2>
            </div>

            <p
              data-testid="ai-consent-dialog-body"
              className="text-xs sm:text-sm text-fg-muted leading-relaxed"
            >
              {AI_CONSENT_BODY}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-line">
              <button
                type="button"
                onClick={handleConsentCancel}
                data-testid="ai-consent-cancel"
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-fg border border-line hover:bg-fill-2 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConsentAgree}
                data-testid="ai-consent-agree"
                className="px-4 py-2 rounded-lg text-xs font-semibold text-on-accent bg-accent hover:bg-accent-hover transition-colors cursor-pointer"
              >
                I agree
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
