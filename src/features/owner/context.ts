import { createContext, useContext } from 'react';
import type { OwnerApi, Role, Workspace } from '@/lib/api/owner';

export interface OwnerCtx {
  tenantId: string;
  role: Role;
  myBarberId: string | null;
  api: OwnerApi;
  workspace: Workspace;
  refreshWorkspace: () => Promise<unknown>;
  base: string; // /s/{slug}/owner
}

export const OwnerContext = createContext<OwnerCtx | null>(null);

export function useOwner(): OwnerCtx {
  const v = useContext(OwnerContext);
  if (!v) throw new Error('useOwner outside OwnerApp');
  return v;
}

/** UI-side capability map; the database enforces the same rules. */
export function can(role: Role, action: 'settings' | 'manage' | 'payments' | 'allBarbers' | 'golive' | 'gdprErase' | 'gdprExport'): boolean {
  switch (action) {
    case 'settings':
    case 'golive':
    case 'gdprErase':
      return role === 'owner';
    case 'manage':
    case 'payments':
    case 'allBarbers':
    case 'gdprExport':
      return role === 'owner' || role === 'admin';
  }
}
