import type { ReactNode } from 'react';
import type { DateInputProps } from '@astryxdesign/core/DateInput';
import type { TimeInputProps } from '@astryxdesign/core/TimeInput';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

export type ISODate = NonNullable<DateInputProps['value']>;
export type ISOTime = NonNullable<TimeInputProps['value']>;
export const asDate = (s: string) => s as ISODate;
export const asTime = (s: string) => s as ISOTime;

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <HStack gap={3} paddingInline={4} paddingBlockStart={4} paddingBlockEnd={2} vAlign="center" wrap="wrap" className="justify-between">
      <VStack gap={0.5}>
        <Heading level={1}>{title}</Heading>
        {subtitle ? <Text type="supporting">{subtitle}</Text> : null}
      </VStack>
      {actions ? (
        <HStack gap={2} wrap="wrap">
          {actions}
        </HStack>
      ) : null}
    </HStack>
  );
}

