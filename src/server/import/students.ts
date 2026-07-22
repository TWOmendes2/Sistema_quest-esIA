import 'server-only';
import { parse } from 'csv-parse/sync';
import { readSheet, type Row } from 'read-excel-file/node';
import { isValidCpf, normalizeCpf } from '@/lib/cpf';

export type CanonicalImportRow = {
  sourceRow: number;
  cpf: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  birthDate: string | null;
  city: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  grade: string | null;
  instagram: string | null;
  activeClassNames: string[];
  oldClassNames: string[];
  delinquentClassNames: string[];
  pendingContractClassNames: string[];
  raw: Record<string, string>;
};

type CanonicalField = keyof Omit<CanonicalImportRow,
  'sourceRow' | 'raw' | 'activeClassNames' | 'oldClassNames' | 'delinquentClassNames' | 'pendingContractClassNames'
> | 'activeClassesRaw' | 'oldClassesRaw' | 'delinquentClassesRaw' | 'pendingContractsRaw';

const HEADER_ALIASES: Record<string, CanonicalField> = {
  cpf: 'cpf', cpf_aluno: 'cpf', documento: 'cpf', numero_cpf: 'cpf',
  nome: 'fullName', nome_completo: 'fullName', nome_do_aluno: 'fullName', aluno: 'fullName', full_name: 'fullName',
  email: 'email', e_mail: 'email', email_do_aluno: 'email',
  telefone: 'phone', celular: 'phone', whatsapp: 'phone',
  telefone_int: 'phoneE164', telefone_internacional: 'phoneE164', telefone_e164: 'phoneE164',
  data_de_nascimento: 'birthDate', nascimento: 'birthDate', data_nascimento: 'birthDate',
  cidade: 'city', municipio: 'city',
  nome_responsavel: 'guardianName', responsavel: 'guardianName', nome_do_responsavel: 'guardianName',
  telefone_responsavel: 'guardianPhone', telefone_do_responsavel: 'guardianPhone', celular_responsavel: 'guardianPhone',
  serie: 'grade', escolaridade: 'grade', ano_serie: 'grade',
  instagram: 'instagram', insta: 'instagram',
  turmas_ativas: 'activeClassesRaw', turma_ativa: 'activeClassesRaw', cursos_ativos: 'activeClassesRaw',
  turmas_antigas: 'oldClassesRaw', turma_antiga: 'oldClassesRaw', cursos_antigos: 'oldClassesRaw',
  turmas_inadimplentes: 'delinquentClassesRaw', turma_inadimplente: 'delinquentClassesRaw', cursos_inadimplentes: 'delinquentClassesRaw',
  contratos_pendentes: 'pendingContractsRaw', contrato_pendente: 'pendingContractsRaw',
  // Formato antigo: uma turma e uma matéria por linha.
  turma: 'activeClassesRaw', classe: 'activeClassesRaw', nome_da_turma: 'activeClassesRaw', class: 'activeClassesRaw', class_name: 'activeClassesRaw'
};

export async function parseStudentImportFile(buffer: Buffer, fileName: string): Promise<CanonicalImportRow[]> {
  const lower = fileName.toLowerCase();
  let objects: Array<Record<string, string>>;
  if (lower.endsWith('.xlsx')) objects = await parseXlsx(buffer);
  else if (lower.endsWith('.xls')) throw new Error('Arquivos .xls antigos não são aceitos. Salve como .xlsx ou CSV.');
  else if (lower.endsWith('.csv')) objects = parseCsv(buffer);
  else throw new Error('Formato inválido. Envie CSV ou XLSX.');

  if (!objects.length) throw new Error('O arquivo não possui linhas de dados.');
  const availableHeaders = new Set(Object.keys(objects[0] || {}).map(normalizeHeader));
  const hasCpf = [...availableHeaders].some((header) => HEADER_ALIASES[header] === 'cpf');
  const hasName = [...availableHeaders].some((header) => HEADER_ALIASES[header] === 'fullName');
  if (!hasCpf || !hasName) throw new Error('Cabeçalho inválido. O arquivo precisa conter as colunas CPF e NOME.');

  return objects.map((raw, index) => canonicalize(raw, index + 2));
}

export function validateImportRow(row: CanonicalImportRow): string[] {
  const errors: string[] = [];
  if (!isValidCpf(row.cpf)) errors.push('CPF inválido');
  if (row.fullName.trim().length < 3) errors.push('Nome obrigatório ou muito curto');
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push('E-mail inválido');
  if (!row.activeClassNames.length && !row.delinquentClassNames.length && !row.pendingContractClassNames.length) {
    errors.push('Nenhuma turma ativa, inadimplente ou contrato pendente foi informado');
  }
  return errors;
}

function parseCsv(buffer: Buffer): Array<Record<string, string>> {
  let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if ((text.match(/�/g) || []).length > 2) text = new TextDecoder('windows-1252').decode(buffer);
  text = text.replace(/^\uFEFF/, '');
  const firstNonEmpty = text.split(/\r?\n/).find((line) => line.trim()) || '';
  const delimiters = [',', ';', '\t'];
  const delimiter = delimiters.sort((a, b) => firstNonEmpty.split(b).length - firstNonEmpty.split(a).length)[0];
  const parsed = parse(text, {
    columns: (headers: string[]) => headers.map((header) => normalizeHeader(header)),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    delimiter
  }) as Array<Record<string, unknown>>;
  return parsed.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, cellToText(value)])));
}

async function parseXlsx(buffer: Buffer): Promise<Array<Record<string, string>>> {
  const sheetRows = await readSheet(buffer);
  const headerRow = sheetRows[0];
  if (!headerRow) return [];
  const headers = headerRow.map((cell) => normalizeHeader(cellToText(cell)));
  const result: Array<Record<string, string>> = [];
  for (const row of sheetRows.slice(1)) {
    const item: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) item[header] = cellToText(row[index]);
    });
    if (Object.values(item).some((value) => value.trim())) result.push(item);
  }
  return result;
}

function canonicalize(raw: Record<string, string>, sourceRow: number): CanonicalImportRow {
  const canonical: Record<string, string> = {};
  for (const [header, value] of Object.entries(raw)) {
    const target = HEADER_ALIASES[normalizeHeader(header)];
    if (target) canonical[target] = value;
  }

  let cpfText = String(canonical.cpf || '').trim();
  if (/^\d+(\.0+)?$/.test(cpfText)) cpfText = cpfText.replace(/\.0+$/, '');
  const digits = normalizeCpf(cpfText);
  const cpf = digits.length > 0 && digits.length < 11 ? digits.padStart(11, '0') : digits;

  const activeClassNames = splitCourseList(canonical.activeClassesRaw);
  const delinquentClassNames = splitCourseList(canonical.delinquentClassesRaw);
  const delinquentKeys = new Set(delinquentClassNames.map(normalizeCourseKey));

  return {
    sourceRow,
    cpf,
    fullName: cleanText(canonical.fullName),
    email: canonical.email ? canonical.email.trim().toLowerCase() : null,
    phone: cleanNullable(canonical.phone),
    phoneE164: normalizePhoneE164(canonical.phoneE164 || canonical.phone),
    birthDate: normalizeDate(canonical.birthDate),
    city: cleanNullable(canonical.city),
    guardianName: cleanNullable(canonical.guardianName),
    guardianPhone: cleanNullable(canonical.guardianPhone),
    grade: cleanNullable(canonical.grade),
    instagram: cleanNullable(canonical.instagram),
    activeClassNames: uniqueCourses(activeClassNames.filter((name) => !delinquentKeys.has(normalizeCourseKey(name)))),
    oldClassNames: splitCourseList(canonical.oldClassesRaw),
    delinquentClassNames: uniqueCourses(delinquentClassNames),
    pendingContractClassNames: splitCourseList(canonical.pendingContractsRaw),
    raw
  };
}

export function splitCourseList(value?: string | null): string[] {
  if (!value?.trim()) return [];
  return uniqueCourses(value
    .split(/\s+\/\s+/g)
    .map(cleanText)
    .filter(Boolean));
}

function uniqueCourses(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalizeCourseKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function normalizeCourseKey(value: string): string {
  return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanText(value?: string | null): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanNullable(value?: string | null): string | null {
  const cleaned = cleanText(value);
  return cleaned || null;
}

function normalizePhoneE164(value?: string | null): string | null {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function normalizeDate(value?: string | null): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function cellToText(value: Row[number] | unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}
