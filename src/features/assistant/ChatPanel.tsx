import { useRef, useState, type ReactNode } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { ChatComposer, ChatLayout, ChatMessage, ChatMessageBubble, ChatMessageList } from '@astryxdesign/core/Chat';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { env } from '@/lib/env';
import { useI18n, type MessageKey } from '@/lib/i18n';

export interface ChatMsg { role: 'user' | 'assistant'; content: string; tools?: string[] }

type Status = 'idle' | 'busy' | 'unavailable' | 'limited' | 'error';

/**
 * Assistant UI shared by client and owner. Conversation state lives only in
 * memory (nothing is stored server-side either). Every answer about times and
 * bookings is produced from server tools by the ai-chat function; the UI shows
 * which tools were consulted.
 */
export function ChatPanel({
  slug,
  scope,
  authToken,
  bookingToken,
  suggestions,
  header,
  onUnavailable,
}: {
  slug: string;
  scope: 'client' | 'owner';
  authToken: () => Promise<string>;
  bookingToken?: string | null;
  suggestions: MessageKey[];
  header?: ReactNode;
  onUnavailable?: ReactNode;
}) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const requestId = useRef<string>(crypto.randomUUID());

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || status === 'busy') return;
    const next: ChatMsg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setStatus('busy');
    try {
      const res = await fetch(`${env.functionsUrl}/ai-chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: env.supabaseAnonKey, authorization: `Bearer ${await authToken()}` },
        body: JSON.stringify({
          slug,
          scope,
          booking_token: bookingToken ?? null,
          request_id: requestId.current,
          messages: next.slice(-12).map(({ role, content: c }) => ({ role, content: c })),
        }),
      });
      if (res.status === 503 || res.status === 404) return setStatus('unavailable');
      if (res.status === 429) return setStatus('limited');
      if (!res.ok) return setStatus('error');
      const data = (await res.json()) as { reply: string; tools_used: string[] };
      setMessages((m) => [...m, { role: 'assistant', content: data.reply, tools: data.tools_used }]);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'unavailable') return <>{onUnavailable}</>;

  return (
    <VStack gap={2} className="h-full min-h-0 flex-1">
      {header}
      <Text type="supporting" data-testid="ai-notice">{t('ai.aiNotice')}</Text>
      <div className="min-h-0 flex-1">
        <ChatLayout
          composer={
            <VStack gap={2}>
              {status === 'limited' ? <Banner status="warning" title={t('ai.limit')} /> : null}
              {status === 'error' ? <Banner status="error" title={t('ai.error')} /> : null}
              <ChatComposer
                value={input}
                onChange={setInput}
                onSubmit={(v) => void send(v)}
                placeholder={t('ai.placeholder')}
                isDisabled={status === 'busy'}
                elevation="low"
              />
            </VStack>
          }
          emptyState={
            <VStack gap={3} padding={4}>
              <Text color="secondary">{t('ai.disclaimer')}</Text>
              <HStack gap={2} wrap="wrap">
                {suggestions.map((k) => (
                  <Button key={k} label={t(k)} size="sm" onClick={() => void send(t(k))} />
                ))}
              </HStack>
            </VStack>
          }
        >
          {messages.length > 0 ? (
            <ChatMessageList isStreaming={status === 'busy'}>
              {messages.map((m, i) => (
                <ChatMessage key={i} sender={m.role}>
                  <ChatMessageBubble variant={m.role === 'assistant' ? 'ghost' : undefined}>
                    <span className="whitespace-pre-line" data-testid={m.role === 'assistant' ? 'ai-reply' : undefined}>{m.content}</span>
                  </ChatMessageBubble>
                  {m.tools && m.tools.length > 0 ? <Text type="supporting">{t('ai.checked', { tools: [...new Set(m.tools)].join(', ') })}</Text> : null}
                </ChatMessage>
              ))}
              {status === 'busy' ? (
                <ChatMessage sender="assistant">
                  <ChatMessageBubble variant="ghost">…</ChatMessageBubble>
                </ChatMessage>
              ) : null}
            </ChatMessageList>
          ) : null}
        </ChatLayout>
      </div>
    </VStack>
  );
}
