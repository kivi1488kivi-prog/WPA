import { useId } from 'react';
import { Field } from '@astryxdesign/core/Field';
import { cn } from '@/lib/utils';

/**
 * Phone input: Astryx TextInput has no `tel` type, so we compose the
 * documented Field (label, description, status, a11y wiring) with a native
 * input that brings the numeric phone keyboard (inputMode="tel") and
 * autofill (autocomplete="tel").
 */
export function PhoneField({
  label,
  value,
  onChange,
  status,
  isRequired,
  description,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  status?: { type: 'error'; message: string } | undefined;
  isRequired?: boolean;
  description?: string;
  testId?: string;
}) {
  const id = useId();
  return (
    <Field label={label} inputID={id} status={status} isRequired={isRequired} description={description} width="100%">
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={status ? true : undefined}
        required={isRequired}
        data-testid={testId}
        className={cn(
          'h-11 w-full rounded-lg border bg-surface px-3 text-base text-primary placeholder:text-secondary',
          status ? 'border-error' : 'border-border focus:border-accent-bg',
        )}
        placeholder="+00 000 000 00 00"
      />
    </Field>
  );
}
