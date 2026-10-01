import { useMemo, type ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Tenant theme: the documented Astryx Theme provider with a runtime
 * defineTheme() that extends the neutral theme and seeds the accent family
 * from the tenant's single brand color (business.json / DB). Dark mode only.
 * The derived tokens (--color-on-accent etc.) come from the accent scale, so
 * contrast stays correct for any configured color.
 */
export function TenantTheme({ slug, accent, children }: { slug: string; accent: string; children: ReactNode }) {
  const theme = useMemo(
    () =>
      defineTheme({
        name: `tenant-${slug}`,
        extends: neutralTheme,
        color: { accent: HEX.test(accent) ? [accent, accent] : ['#C8A165', '#C8A165'], neutralStyle: 'warm' },
        radius: { base: 6, multiplier: 1.25 },
      }),
    [slug, accent],
  );
  return (
    <Theme theme={theme} mode="dark">
      {children}
    </Theme>
  );
}
