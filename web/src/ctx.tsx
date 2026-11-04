import { createContext, useContext, useMemo } from 'react';
import { objectDef, roleAllows, fieldAccess, DEFAULT_PICKLISTS, type FieldDef, type Picklist, type RoleDef, type Layout } from '@suite/shared';

export interface Me {
  user: { id: number; name: string; email: string; role: string };
  role: RoleDef;
  company: { id: number; name: string; stateCode: string; logo?: string };
  security?: { totpEnabled: boolean; required: boolean; idleMinutes?: number; idleWarnAfter?: number };
}
export interface Meta {
  picklists: Picklist[]; fields: (FieldDef & { object: string })[]; layouts: Layout[]; roles: RoleDef[];
  listviews: { key: string; owner_id: number | null; data: any }[]; reports: { key: string; owner_id: number | null; data: any }[]; dashboards: { key: string; owner_id: number | null; data: any }[];
}

export const MeCtx = createContext<Me | null>(null);
export const MetaCtx = createContext<{ meta: Meta; reload: () => void } | null>(null);
export const useMe = () => useContext(MeCtx)!;
export const useMeta = () => useContext(MetaCtx)!;

/** Permission check, e.g. can('signReports') or can('invoice.create'). */
export function useCan() {
  const me = useMe();
  return (perm: string) => roleAllows(me.role, perm);
}
export const isAdmin = (me: Me) => Boolean(me.role?.admin);
export const hasTab = (me: Me, tab: string) => Boolean(me.role?.admin || me.role?.tabs?.includes(tab));

export function usePicklist(key?: string) {
  const ctx = useContext(MetaCtx);
  return useMemo(() => {
    if (!key) return [] as { value: string; label: string }[];
    const pl = ctx?.meta.picklists.find((p) => p.key === key) ?? DEFAULT_PICKLISTS.find((p) => p.key === key);
    return (pl?.values ?? []).filter((v) => v.active !== false).map((v) => ({ value: v.value, label: v.label || v.value }));
  }, [ctx, key]);
}

/** Fields of an object in layout order with this user's access level. */
export function useFields(object: string) {
  const me = useMe();
  const ctx = useContext(MetaCtx);
  return useMemo(() => {
    const std = objectDef(object)?.fields ?? [];
    const custom = (ctx?.meta.fields ?? []).filter((f) => f.object === object).map((f) => ({ ...f, custom: true }));
    const all = [...std, ...custom];
    const layout = ctx?.meta.layouts.find((l) => l.object === object);
    const order = layout?.fields?.length ? [...layout.fields, ...all.map((f) => f.key).filter((k) => !layout.fields.includes(k))] : all.map((f) => f.key);
    return order
      .map((k) => all.find((f) => f.key === k))
      .filter((f): f is FieldDef => Boolean(f) && !layout?.hidden?.includes(f!.key))
      .map((f) => ({ ...f, access: fieldAccess(me.role, object, f.key) }))
      .filter((f) => f.access !== 'hidden');
  }, [ctx, object, me]);
}
