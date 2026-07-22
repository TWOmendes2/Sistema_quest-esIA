import { Badge, PageHeader, StatCard } from '@/components/ui';
import { Icon } from '@/components/icon';
import { getAuditLogs } from '@/server/data/admin';
import { formatDate } from '@/lib/format';
import { requireManagementRoles } from '@/server/data/context';

export default async function AuditPage() {
  await requireManagementRoles(['admin', 'coordinator']);
  const logs = await getAuditLogs(500);
  const today = new Date().toDateString();
  return <><PageHeader eyebrow="Governança e segurança" title="Auditoria" description="Eventos reais de acesso, alteração, publicação, importação e exportação." actions={<a href="/api/admin/exports/audit" className="app-button-secondary"><Icon name="download" className="h-4 w-4" /> Exportar logs</a>} /><div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Eventos hoje" value={logs.filter((item) => new Date(item.date).toDateString() === today).length} icon="shield" tone="primary" /><StatCard label="Alertas" value={logs.filter((item) => item.severity === 'warning').length} icon="alert" tone="warning" /><StatCard label="Eventos de sucesso" value={logs.filter((item) => item.severity === 'success').length} icon="check-circle" tone="success" /><StatCard label="Retenção exibida" value={`${logs.length} eventos`} icon="history" tone="neutral" /></div><div className="app-table-wrap"><table className="app-table min-w-[1180px]"><thead><tr><th>Data e hora</th><th>Ator</th><th>Papel</th><th>Ação</th><th>Entidade</th><th>Detalhes</th><th>IP protegido</th><th>Nível</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{formatDate(log.date, true)}</td><td className="font-semibold text-white">{log.actor}</td><td><Badge>{log.role}</Badge></td><td><code className="text-xs font-semibold text-[#ddd]">{log.action}</code></td><td>{log.entity}</td><td><p className="max-w-md break-words text-sm leading-6">{log.detail}</p></td><td className="font-mono text-xs">{log.ip}</td><td><Badge tone={log.severity === 'warning' ? 'warning' : log.severity === 'success' ? 'success' : 'primary'}>{log.severity}</Badge></td></tr>)}</tbody></table></div>{!logs.length ? <div className="app-card mt-4 p-12 text-center text-sm text-[#777]">Nenhum evento registrado.</div> : null}</>;
}
