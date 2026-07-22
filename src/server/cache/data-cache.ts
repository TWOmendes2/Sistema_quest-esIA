import 'server-only';
import { unstable_cache, revalidatePath, revalidateTag } from 'next/cache';
import { appSchema } from '@/server/supabase/admin';

type AnyRow = Record<string, any>;

const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

const loadRows = unstable_cache(
  async (table: string, select: string, organizationId: string): Promise<AnyRow[]> => {
    const output: AnyRow[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let query = appSchema()
        .from(table)
        .select(select)
        .order('id', { ascending: true })
        .range(from, to);
      if (organizationId) query = query.eq('organization_id', organizationId);
      const { data, error } = await query;
      if (error) throw new Error(`${table}: ${error.message}`);
      const batch = (data ?? []) as AnyRow[];
      output.push(...batch);
      if (batch.length < PAGE_SIZE) return output;
    }

    throw new Error(`${table}: volume acima do limite seguro de ${PAGE_SIZE * MAX_PAGES} registros por leitura.`);
  },
  ['nexo-app-rows-v1'],
  { revalidate: 30, tags: ['nexo-data'] },
);

/** Cache compartilhado de 30 segundos para leituras repetidas entre páginas. */
export async function cachedRows(
  table: string,
  select = '*',
  organizationId?: string,
): Promise<AnyRow[]> {
  return loadRows(table, select, organizationId || '');
}

/** Invalida o cache imediatamente depois de qualquer escrita relevante. */
export function invalidatePlatformData(): void {
  revalidateTag('nexo-data');
  revalidatePath('/admin', 'layout');
  revalidatePath('/dashboard', 'layout');
  revalidatePath('/simulados', 'layout');
  revalidatePath('/historico', 'layout');
  revalidatePath('/desempenho', 'layout');
}
