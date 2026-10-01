import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { HStack } from '@astryxdesign/core/HStack';
import { VStack } from '@astryxdesign/core/VStack';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useI18n } from '@/lib/i18n';

/**
 * Mobile bottom sheet built on the shadcn Base UI Drawer (single branch, no
 * Vaul). Base UI provides the focus trap, Escape/overlay dismissal, scroll
 * lock and focus restoration. This wrapper adds: a title row with a close
 * button, a scrollable body that keeps the focused field above the on-screen
 * keyboard, and a sticky footer for the primary action.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  headerStart,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerStart?: ReactNode;
  testId?: string;
}) {
  const { t } = useI18n();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Keep focused inputs visible when the virtual keyboard shrinks the viewport.
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const keepVisible = () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && bodyRef.current?.contains(el) && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    vv?.addEventListener('resize', keepVisible);
    document.addEventListener('focusin', keepVisible);
    return () => {
      vv?.removeEventListener('resize', keepVisible);
      document.removeEventListener('focusin', keepVisible);
    };
  }, [open]);

  return (
    <Drawer open={open} onOpenChange={(o) => onOpenChange(o)} showSwipeHandle>
      <DrawerContent data-testid={testId} className="mx-auto w-full max-w-xl">
        <DrawerHeader className="pb-2 text-start">
          <HStack gap={2} vAlign="center">
            {headerStart}
            <VStack gap={0.5} className="min-w-0 flex-1">
              <DrawerTitle className="text-lg font-semibold">{title}</DrawerTitle>
              {description ? <DrawerDescription className="text-start">{description}</DrawerDescription> : null}
            </VStack>
            <IconButton label={t('app.close')} icon={<Icon icon={X} />} variant="ghost" onClick={() => onOpenChange(false)} />
          </HStack>
        </DrawerHeader>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {children}
        </div>
        {footer ? <DrawerFooter className="border-t border-border bg-popover pt-3">{footer}</DrawerFooter> : null}
      </DrawerContent>
    </Drawer>
  );
}
