import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { VStack } from '@astryxdesign/core/VStack';
import { Plus, Trash2 } from 'lucide-react';
import { useTenant } from '@/app/tenant';
import { useI18n } from '@/lib/i18n';
import { weekdayName } from '@/lib/hours';
import { hhmmToMin, minToHHMM } from '@/lib/time';
import { asTime } from './ui';

export interface Interval { weekday: number; start_min: number; end_min: number; label?: string }

/** Several intervals per weekday (e.g. 10–14 and 15–20); empty day = day off. */
export function WeekEditor({ value, onChange, addLabel, idPrefix }: { value: Interval[]; onChange: (v: Interval[]) => void; addLabel: string; idPrefix: string }) {
  const { intl } = useTenant();
  const { t } = useI18n();
  const update = (i: number, patch: Partial<Interval>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <VStack gap={2}>
      {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
        const rows = value.map((v, i) => ({ v, i })).filter((x) => x.v.weekday === wd);
        return (
          <HStack key={wd} gap={2} vAlign="start" className="border-b border-border pb-2" data-testid={`${idPrefix}-day-${wd}`}>
            <Text weight="semibold" className="w-24 shrink-0 pt-2">{weekdayName(wd, intl, 'short')}</Text>
            <VStack gap={1} className="flex-1">
              {rows.length === 0 ? <Text type="supporting" className="pt-2">{t('barbers.dayOff')}</Text> : null}
              {rows.map(({ v, i }) => (
                <HStack key={i} gap={1} vAlign="center" wrap="wrap">
                  <TimeInput label={t('block.from')} isLabelHidden size="sm" hourFormat="24h" increment={15} width={104} value={asTime(minToHHMM(v.start_min))}
                    onChange={(x) => { const m = x ? hhmmToMin(x) : null; if (m !== null) update(i, { start_min: m }); }} />
                  <Text>–</Text>
                  <TimeInput label={t('block.to')} isLabelHidden size="sm" hourFormat="24h" increment={15} width={104} value={asTime(minToHHMM(v.end_min % 1440 === 0 && v.end_min > 0 ? 1439 : v.end_min))}
                    onChange={(x) => { const m = x ? hhmmToMin(x) : null; if (m !== null) update(i, { end_min: m === 1439 ? 1440 : m }); }} />
                  <IconButton label={t('app.delete')} icon={<Icon icon={Trash2} />} size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} />
                </HStack>
              ))}
            </VStack>
            <IconButton
              label={addLabel}
              tooltip={addLabel}
              icon={<Icon icon={Plus} />}
              size="sm"
              onClick={() => {
                const last = rows.at(-1)?.v;
                const start = last ? Math.min(last.end_min + 60, 1380) : 600;
                onChange([...value, { weekday: wd, start_min: start, end_min: Math.min(start + 240, 1440), label: '' }]);
              }}
            />
          </HStack>
        );
      })}
    </VStack>
  );
}

