import { getCpfLast4 } from '@/lib/cpf';
import { getRequestIp, getUserAgent, jsonError, jsonOk } from '@/lib/http';
import { inferSubjectsFromClassName, subjectCode, subjectColor, subjectLogo, subjectTeachers } from '@/lib/subject';
import { authorizeManagement } from '@/server/auth/management';
import { auditLog } from '@/server/audit/audit';
import { invalidatePlatformData } from '@/server/cache/data-cache';
import { env } from '@/server/env';
import { normalizeCourseKey, parseStudentImportFile, validateImportRow } from '@/server/import/students';
import { hashCpf } from '@/server/security/cpf-hash';
import { appSchema, createSupabaseAdminClient } from '@/server/supabase/admin';

type PreviewRow = {
  row: number;
  cpfMasked: string;
  name: string;
  email: string | null;
  activeClasses: string[];
  activeClassCount: number;
  delinquentClassCount: number;
  pendingContractCount: number;
  status: 'new' | 'update' | 'invalid';
  errors: string[];
};

type DbRow = Record<string, any>;

type PreparedItem = {
  row: Awaited<ReturnType<typeof parseStudentImportFile>>[number];
  errors: string[];
  hash: string;
};

const HASH_LOOKUP_BATCH_SIZE = 50;
const ID_LOOKUP_BATCH_SIZE = 100;
const WRITE_BATCH_SIZE = 200;

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await authorizeManagement(request, ['admin', 'coordinator']);
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const file = form.get('file');
  const mode = String(form.get('mode') || 'import');
  if (!['preview', 'import'].includes(mode)) return jsonError('BAD_REQUEST', 'Modo de importação inválido.', 400);
  if (!(file instanceof File)) return jsonError('BAD_REQUEST', 'Arquivo não enviado.', 400);
  if (file.size === 0) return jsonError('BAD_REQUEST', 'O arquivo está vazio.', 400);
  if (file.size > env.maxImportFileMb * 1024 * 1024) return jsonError('BAD_REQUEST', `Arquivo maior que ${env.maxImportFileMb} MB.`, 400);

  const organizationId = auth.membership.organizationId;
  const buffer = Buffer.from(await file.arrayBuffer());
  let parsedRows;
  try {
    parsedRows = await parseStudentImportFile(buffer, file.name);
  } catch (error) {
    return jsonError('BAD_REQUEST', error instanceof Error ? error.message : 'Não foi possível ler o arquivo.', 400);
  }

  const seenHashes = new Map<string, number>();
  const prepared: PreparedItem[] = parsedRows.map((row) => {
    const errors = validateImportRow(row);
    const hash = hashCpf(row.cpf);
    if (!errors.length) {
      const firstRow = seenHashes.get(hash);
      if (firstRow) errors.push(`CPF duplicado no arquivo (primeira ocorrência na linha ${firstRow})`);
      else seenHashes.set(hash, row.sourceRow);
    }
    return { row, errors, hash };
  });

  const hashes = prepared.filter((item) => !item.errors.length).map((item) => item.hash);
  let existingRegistries: DbRow[] = [];
  try {
    existingRegistries = await lookupExistingRegistries(organizationId, hashes);
  } catch (error) {
    return jsonError(
      'INTERNAL_ERROR',
      `Erro ao consultar a base oficial: ${formatSupabaseError(error)}`,
      500
    );
  }

  const existingHashSet = new Set(existingRegistries.map((item) => item.cpf_hash));
  const previewRows: PreviewRow[] = prepared.map(({ row, errors, hash }) => ({
    row: row.sourceRow,
    cpfMasked: errors.includes('CPF inválido') ? 'CPF inválido' : `***.***.***-${row.cpf.slice(-2)}`,
    name: row.fullName,
    email: row.email,
    activeClasses: row.activeClassNames.slice(0, 4),
    activeClassCount: row.activeClassNames.length,
    delinquentClassCount: row.delinquentClassNames.length,
    pendingContractCount: row.pendingContractClassNames.length,
    status: errors.length ? 'invalid' : existingHashSet.has(hash) ? 'update' : 'new',
    errors
  }));

  const summary = {
    total: previewRows.length,
    imported: previewRows.filter((row) => row.status === 'new').length,
    updated: previewRows.filter((row) => row.status === 'update').length,
    invalidCpf: previewRows.filter((row) => row.errors.includes('CPF inválido')).length,
    invalid: previewRows.filter((row) => row.status === 'invalid').length,
    activeEnrollments: previewRows.reduce((sum, row) => sum + row.activeClassCount, 0),
    delinquentEnrollments: previewRows.reduce((sum, row) => sum + row.delinquentClassCount, 0),
    pendingContracts: previewRows.reduce((sum, row) => sum + row.pendingContractCount, 0)
  };

  if (mode === 'preview') return jsonOk({ summary, rows: previewRows.slice(0, 200), truncated: previewRows.length > 200 });

  const validItems = prepared.filter((item) => !item.errors.length);
  const result = {
    ...summary,
    imported: 0,
    updated: 0,
    classesCreated: 0,
    subjectsCreated: 0,
    enrollmentsSynced: 0,
    errors: [] as Array<{ row: number; message: string }>,
    storageWarning: null as string | null
  };

  const storagePath = `${organizationId}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const upload = await createSupabaseAdminClient().storage.from('student-imports').upload(storagePath, buffer, {
    upsert: false,
    contentType: file.type || 'application/octet-stream'
  });
  if (upload.error) result.storageWarning = `O arquivo foi processado, mas não pôde ser arquivado: ${upload.error.message}`;

  if (!validItems.length) return jsonOk(result, 201);

  try {
    const courseNames = uniqueStrings(validItems.flatMap(({ row }) => [
      ...row.activeClassNames,
      ...row.delinquentClassNames,
      ...row.pendingContractClassNames
    ]));
    const subjectNames = uniqueStrings(courseNames.flatMap(inferSubjectsFromClassName));

    const classMap = await ensureClasses(organizationId, courseNames);
    result.classesCreated = classMap.created;
    const subjectMap = await ensureSubjects(organizationId, subjectNames);
    result.subjectsCreated = subjectMap.created;

    const registryPayloads = validItems.map(({ row, hash }) => ({
      organization_id: organizationId,
      cpf_hash: hash,
      cpf_last4: getCpfLast4(row.cpf),
      full_name: row.fullName,
      email: row.email,
      phone: row.phone,
      phone_e164: row.phoneE164,
      birth_date: row.birthDate,
      city: row.city,
      guardian_name: row.guardianName,
      guardian_phone: row.guardianPhone,
      grade: row.grade,
      instagram: row.instagram,
      status: 'imported',
      imported_by: auth.user.authUid,
      imported_at: new Date().toISOString(),
      source_snapshot_at: new Date().toISOString(),
      import_metadata: {
        active_classes: row.activeClassNames,
        old_classes: row.oldClassNames,
        delinquent_classes: row.delinquentClassNames,
        pending_contracts: row.pendingContractClassNames
      }
    }));

    const registries = await upsertReturningInBatches(
      'students_registry',
      registryPayloads,
      'organization_id,cpf_hash',
      'id,cpf_hash',
      'Alunos'
    );

    const registryByHash = new Map(registries.map((item: any) => [item.cpf_hash, item.id]));
    result.imported = validItems.filter((item) => !existingHashSet.has(item.hash)).length;
    result.updated = validItems.filter((item) => existingHashSet.has(item.hash)).length;

    const registryIds = [...registryByHash.values()] as string[];
    const profiles = await selectInBatches({
      table: 'student_profiles',
      select: 'id,registry_id',
      filterColumn: 'registry_id',
      values: registryIds,
      label: 'Perfis',
      apply: (query) => query.eq('organization_id', organizationId)
    });
    const profileByRegistry = new Map(profiles.map((item: any) => [item.registry_id, item.id]));

    await deactivateImportedAccesses(organizationId, registryIds, [...profileByRegistry.values()] as string[]);

    const manualRegistryRows = await selectInBatches({
      table: 'registry_enrollments',
      select: 'registry_id,class_id,subject_id',
      filterColumn: 'registry_id',
      values: registryIds,
      label: 'Vínculos manuais importados',
      apply: (query) => query.eq('manual_override', true)
    });
    const manualRegistryKeys = new Set(manualRegistryRows.map((item: any) => `${item.registry_id}:${item.class_id}:${item.subject_id}`));

    const profileIds = [...profileByRegistry.values()] as string[];
    const manualEnrollmentRows = await selectInBatches({
      table: 'enrollments',
      select: 'student_id,class_id,subject_id',
      filterColumn: 'student_id',
      values: profileIds,
      label: 'Acessos manuais dos alunos',
      apply: (query) => query.eq('manual_override', true)
    });
    const manualEnrollmentKeys = new Set(manualEnrollmentRows.map((item: any) => `${item.student_id}:${item.class_id}:${item.subject_id}`));

    const registryAccessPayloads: DbRow[] = [];
    const profileAccessPayloads: DbRow[] = [];
    const contractPayloads: DbRow[] = [];

    for (const item of validItems) {
      const registryId = registryByHash.get(item.hash);
      if (!registryId) {
        result.errors.push({ row: item.row.sourceRow, message: 'Registro não retornado após a gravação.' });
        continue;
      }
      const profileId = profileByRegistry.get(registryId) || null;
      const activeKeys = new Set(item.row.activeClassNames.map(normalizeCourseKey));
      const delinquentKeys = new Set(item.row.delinquentClassNames.map(normalizeCourseKey));
      const contractKeys = new Set(item.row.pendingContractClassNames.map(normalizeCourseKey));
      const allCurrent = uniqueStrings([
        ...item.row.activeClassNames,
        ...item.row.delinquentClassNames,
        ...item.row.pendingContractClassNames
      ]);

      for (const className of allCurrent) {
        const classId = classMap.map.get(normalizeCourseKey(className));
        if (!classId) continue;
        const classKey = normalizeCourseKey(className);
        const status = delinquentKeys.has(classKey) ? 'delinquent' : activeKeys.has(classKey) ? 'active' : 'inactive';
        const contractStatus = contractKeys.has(classKey) ? 'pending' : 'not_required';

        for (const subjectName of inferSubjectsFromClassName(className)) {
          const subjectId = subjectMap.map.get(normalizeCourseKey(subjectName));
          if (!subjectId) continue;
          const registryKey = `${registryId}:${classId}:${subjectId}`;
          if (!manualRegistryKeys.has(registryKey)) {
            registryAccessPayloads.push({
              organization_id: organizationId,
              registry_id: registryId,
              class_id: classId,
              subject_id: subjectId,
              status,
              contract_status: contractStatus,
              source: 'import',
              manual_override: false,
              blocked_reason: status === 'delinquent' ? 'Turma marcada como inadimplente na base importada.' : null
            });
          }

          if (profileId) {
            const enrollmentKey = `${profileId}:${classId}:${subjectId}`;
            if (!manualEnrollmentKeys.has(enrollmentKey)) {
              profileAccessPayloads.push({
                organization_id: organizationId,
                student_id: profileId,
                class_id: classId,
                subject_id: subjectId,
                status,
                contract_status: contractStatus,
                source: 'import',
                manual_override: false,
                blocked_reason: status === 'delinquent' ? 'Turma marcada como inadimplente na base importada.' : null
              });
            }
          }
        }
      }

      for (const contractName of item.row.pendingContractClassNames) {
        const classId = classMap.map.get(normalizeCourseKey(contractName)) || null;
        contractPayloads.push({
          organization_id: organizationId,
          registry_id: registryId,
          student_id: profileId,
          class_id: classId,
          contract_name: contractName,
          status: 'pending',
          source: 'import',
          detected_at: new Date().toISOString(),
          resolved_at: null,
          resolved_by: null
        });
      }
    }

    await upsertInBatches(
      'registry_enrollments',
      registryAccessPayloads,
      'registry_id,class_id,subject_id',
      'Vínculos importados'
    );
    await upsertInBatches(
      'enrollments',
      profileAccessPayloads,
      'student_id,class_id,subject_id',
      'Acessos dos alunos'
    );
    result.enrollmentsSynced = registryAccessPayloads.length;

    await updateInBatches({
      table: 'student_contract_requirements',
      payload: { status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: auth.user.authUid },
      filterColumn: 'registry_id',
      values: registryIds,
      label: 'Resolução de contratos anteriores',
      apply: (query) => query.eq('source', 'import').eq('status', 'pending')
    });
    await upsertInBatches(
      'student_contract_requirements',
      contractPayloads,
      'organization_id,registry_id,contract_name',
      'Contratos pendentes'
    );
  } catch (error) {
    result.errors.push({ row: 0, message: error instanceof Error ? error.message : 'Falha na sincronização dos dados.' });
  }

  await auditLog({
    organizationId,
    actorAuthUid: auth.user.authUid,
    action: 'students_imported_and_synced',
    entityName: 'students_registry',
    ipAddress: getRequestIp(request),
    userAgent: getUserAgent(request),
    metadata: { file_name: file.name, storage_path: upload.error ? null : storagePath, summary: result }
  });

  invalidatePlatformData();
  return jsonOk(result, 201);
}

async function ensureClasses(organizationId: string, names: string[]) {
  const { data: existing, error } = await appSchema().from('classes').select('id,name,status').eq('organization_id', organizationId);
  if (error) throw new Error(`Turmas: ${error.message}`);
  const map = new Map((existing ?? []).map((item: any) => [normalizeCourseKey(item.name), item.id]));
  const missing = names.filter((name) => !map.has(normalizeCourseKey(name)));
  if (missing.length) {
    const payloads = missing.map((name) => ({
      organization_id: organizationId,
      name,
      code: buildClassCode(name),
      description: 'Turma criada automaticamente pela sincronização da base oficial.',
      status: 'active'
    }));
    const { data: created, error: createError } = await appSchema().from('classes').insert(payloads).select('id,name');
    if (createError) throw new Error(`Criação de turmas: ${createError.message}`);
    for (const item of created ?? []) map.set(normalizeCourseKey(item.name), item.id);
  }
  return { map, created: missing.length };
}

async function ensureSubjects(organizationId: string, names: string[]) {
  const { data: existing, error } = await appSchema().from('subjects').select('id,name,status').eq('organization_id', organizationId);
  if (error) throw new Error(`Matérias: ${error.message}`);
  const map = new Map((existing ?? []).map((item: any) => [normalizeCourseKey(item.name), item.id]));
  const missing = names.filter((name) => !map.has(normalizeCourseKey(name)));
  if (missing.length) {
    const payloads = missing.map((name) => ({
      organization_id: organizationId,
      name,
      code: subjectCode(name),
      color: subjectColor(name),
      logo_path: subjectLogo(name),
      teacher_names: subjectTeachers(name),
      status: 'active'
    }));
    const { data: created, error: createError } = await appSchema().from('subjects').insert(payloads).select('id,name');
    if (createError) throw new Error(`Criação de matérias: ${createError.message}`);
    for (const item of created ?? []) map.set(normalizeCourseKey(item.name), item.id);
  }
  return { map, created: missing.length };
}

async function deactivateImportedAccesses(organizationId: string, registryIds: string[], studentIds: string[]) {
  const payload = { status: 'inactive', contract_status: 'not_required', blocked_reason: null };

  await updateInBatches({
    table: 'registry_enrollments',
    payload,
    filterColumn: 'registry_id',
    values: registryIds,
    label: 'Sincronização de vínculos importados',
    apply: (query) => query
      .eq('organization_id', organizationId)
      .eq('source', 'import')
      .eq('manual_override', false)
  });

  await updateInBatches({
    table: 'enrollments',
    payload,
    filterColumn: 'student_id',
    values: studentIds,
    label: 'Sincronização de acessos',
    apply: (query) => query
      .eq('organization_id', organizationId)
      .eq('source', 'import')
      .eq('manual_override', false)
  });
}

async function lookupExistingRegistries(organizationId: string, hashes: string[]): Promise<DbRow[]> {
  return selectInBatches({
    table: 'students_registry',
    select: 'id,cpf_hash',
    filterColumn: 'cpf_hash',
    values: uniqueStrings(hashes),
    batchSize: HASH_LOOKUP_BATCH_SIZE,
    label: 'Base oficial',
    apply: (query) => query.eq('organization_id', organizationId)
  });
}

async function selectInBatches(input: {
  table: string;
  select: string;
  filterColumn: string;
  values: string[];
  label: string;
  batchSize?: number;
  apply?: (query: any) => any;
}): Promise<DbRow[]> {
  const values = [...new Set(input.values.filter(Boolean))];
  if (!values.length) return [];

  const rows: DbRow[] = [];
  for (const batch of chunkArray(values, input.batchSize ?? ID_LOOKUP_BATCH_SIZE)) {
    let query: any = appSchema().from(input.table).select(input.select).in(input.filterColumn, batch);
    if (input.apply) query = input.apply(query);
    const { data, error } = await query;
    if (error) throw new Error(`${input.label}: ${formatSupabaseError(error)}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function upsertReturningInBatches(
  table: string,
  payloads: DbRow[],
  onConflict: string,
  select: string,
  label: string
): Promise<DbRow[]> {
  if (!payloads.length) return [];

  const rows: DbRow[] = [];
  for (const batch of chunkArray(payloads, WRITE_BATCH_SIZE)) {
    const { data, error } = await appSchema().from(table)
      .upsert(batch, { onConflict })
      .select(select);
    if (error) throw new Error(`${label}: ${formatSupabaseError(error)}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function upsertInBatches(
  table: string,
  payloads: DbRow[],
  onConflict: string,
  label: string
): Promise<void> {
  if (!payloads.length) return;

  for (const batch of chunkArray(payloads, WRITE_BATCH_SIZE)) {
    const { error } = await appSchema().from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${label}: ${formatSupabaseError(error)}`);
  }
}

async function updateInBatches(input: {
  table: string;
  payload: DbRow;
  filterColumn: string;
  values: string[];
  label: string;
  apply?: (query: any) => any;
}): Promise<void> {
  const values = [...new Set(input.values.filter(Boolean))];
  if (!values.length) return;

  for (const batch of chunkArray(values, ID_LOOKUP_BATCH_SIZE)) {
    let query: any = appSchema().from(input.table).update(input.payload).in(input.filterColumn, batch);
    if (input.apply) query = input.apply(query);
    const { error } = await query;
    if (error) throw new Error(`${input.label}: ${formatSupabaseError(error)}`);
  }
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function formatSupabaseError(error: unknown): string {
  if (!error || typeof error !== 'object') return error instanceof Error ? error.message : String(error);
  const record = error as Record<string, unknown>;
  const parts = [record.message, record.code, record.details, record.hint]
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean);
  return [...new Set(parts)].join(' | ') || 'Falha desconhecida no Supabase.';
}

function uniqueStrings(values: string[]): string[] {
  const map = new Map<string, string>();
  for (const value of values) {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
    if (cleaned) map.set(normalizeCourseKey(cleaned), cleaned);
  }
  return [...map.values()];
}

function buildClassCode(name: string): string {
  const base = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const acronym = base.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const suffix = Math.abs([...base].reduce((sum, char) => sum + char.charCodeAt(0), 0)).toString(36).toUpperCase().slice(-3);
  return `${acronym || 'TURMA'}-${suffix}`.slice(0, 12);
}

function sanitizeFileName(fileName: string): string {
  return fileName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_');
}
