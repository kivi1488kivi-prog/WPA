import { useState } from 'react';
import { Link } from 'react-router';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { getSupabase } from '@/lib/supabase';
import { mediaUrl } from '@/lib/media';

/** Staff sign-in. No sign-up form exists: accounts come from tenant:member. */
export function LoginPage() {
  const { slug, shop } = useTenant();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await getSupabase(slug).auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (e) setError(/invalid|credentials|grant/i.test(e.message) ? t('owner.badCredentials') : e.message);
  };

  return (
    <VStack className="min-h-dvh items-center justify-center bg-body p-4 pt-safe">
      <Card width="100%" maxWidth={420} padding={6}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <VStack gap={4}>
            {shop.tenant.logo_path ? <img src={mediaUrl(shop.tenant.logo_path) ?? ''} alt="" className="size-12 rounded-lg" /> : null}
            <VStack gap={1}>
              <Heading level={1}>{t('owner.signInTitle')}</Heading>
              <Text color="secondary">{shop.tenant.name}</Text>
            </VStack>
            {error ? <Banner status="error" title={error} /> : null}
            <TextInput type="email" label={t('owner.email')} value={email} onChange={setEmail} autoComplete="username" isRequired width="100%" htmlName="email" />
            <TextInput type="password" label={t('owner.password')} value={password} onChange={setPassword} autoComplete="current-password" isRequired width="100%" htmlName="password" />
            <Button type="submit" label={t('owner.signIn')} variant="primary" size="lg" width="100%" isLoading={busy} />
            <Text type="supporting">{t('owner.signInHint')}</Text>
            <Text type="supporting">
              <Link className="underline" to={`/s/${slug}/impressum`}>{t('legal.impressum')}</Link> ·{' '}
              <Link className="underline" to={`/s/${slug}/datenschutz`}>{t('legal.privacy')}</Link>
            </Text>
          </VStack>
        </form>
      </Card>
    </VStack>
  );
}
