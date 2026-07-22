import { Badge, Card, Donut, EmptyState, MiniBarChart, PageHeader, ProgressBar, Sparkline, StatCard } from '@/components/ui';
import { getStudentPerformance } from '@/server/data/student';
import { formatDuration, formatScore } from '@/lib/format';

export default async function PerformancePage() {
  const data = await getStudentPerformance();
  const bestSubject = data.subjects[0];
  const weakTopics = data.topics.slice(0, 6);

  return (
    <>
      <PageHeader eyebrow="Análise pedagógica" title="Meu desempenho" description="Indicadores calculados a partir das suas respostas e tentativas reais." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Precisão geral" value={`${data.stats.accuracy.toFixed(1)}%`} icon="target" tone="primary" helper={`${data.stats.totalCorrect + data.stats.totalWrong} respostas corrigidas`} />
        <StatCard label="Nota média" value={formatScore(data.stats.average)} icon="chart" tone="purple" helper={`${data.stats.attempts} tentativa(s)`} />
        <StatCard label="Tempo por questão" value={formatDuration(data.stats.averageQuestionSeconds)} icon="clock" tone="neutral" helper="média registrada" />
        <StatCard label="Melhor matéria" value={bestSubject?.subject || '—'} icon="trophy" tone="success" helper={bestSubject ? `${bestSubject.accuracy.toFixed(1)}% de precisão` : 'sem dados suficientes'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_.8fr]">
        <Card title="Evolução das notas" description="Últimas tentativas concluídas">
          {data.trend.length > 1 ? <><div className="h-52 text-white"><Sparkline values={data.trend} className="h-full" /></div><div className="mt-4 flex items-center justify-between border-t border-[#292929] pt-4 text-xs text-[#777]"><span>Primeira no recorte: {formatScore(data.trend[0])}</span><span>Última: {formatScore(data.trend[data.trend.length - 1])}</span></div></> : <EmptyState icon="chart" title="Poucos dados para tendência" description="Conclua ao menos dois simulados para visualizar a evolução." />}
        </Card>
        <Card title="Distribuição geral" description="Acertos e erros corrigidos">
          <div className="flex flex-col items-center gap-6 sm:flex-row xl:flex-col 2xl:flex-row">
            <Donut value={data.stats.accuracy} label="corretas" size={150} />
            <div className="w-full space-y-4">
              <Legend label="Corretas" value={data.stats.totalCorrect} className="bg-emerald-400" />
              <Legend label="Incorretas" value={data.stats.totalWrong} className="bg-red-400" />
              <Legend label="Melhor nota" value={formatScore(data.stats.best)} className="bg-white" />
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-6" title="Desempenho por matéria" description="Precisão e nota média calculadas por disciplina">
        {data.subjects.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.subjects.map((item) => <div key={item.id} className="rounded-md border border-[#303030] bg-[#171717] p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><i className="h-3 w-3 rounded-full" style={{ background: item.color }} /><p className="font-semibold text-white">{item.subject}</p></div><Badge tone={item.accuracy >= 80 ? 'success' : item.accuracy >= 60 ? 'warning' : 'danger'}>{item.accuracy.toFixed(1)}%</Badge></div><div className="mt-5 space-y-4"><ProgressBar value={item.accuracy} label={`${item.correct} de ${item.answered} corretas`} color={item.color} /><div className="grid grid-cols-3 gap-2 text-center"><Small value={formatScore(item.average)} label="nota média" /><Small value={item.answered} label="questões" /><Small value={formatDuration(item.averageSeconds)} label="tempo médio" /></div></div></div>)}</div> : <EmptyState icon="book" title="Sem desempenho por matéria" description="Os indicadores serão calculados após a correção das primeiras tentativas." />}
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
        <Card title="Precisão por tema" description="Temas ordenados da menor para a maior precisão">
          {data.topics.length ? <div className="space-y-5">{data.topics.map((item) => <ProgressBar key={`${item.subject}-${item.topic}`} value={item.accuracy} label={`${item.topic} · ${item.subject} (${item.answered})`} color={item.accuracy < 60 ? '#f87171' : item.accuracy < 80 ? '#fbbf24' : '#34d399'} />)}</div> : <EmptyState icon="target" title="Sem temas calculados" description="Os tópicos aparecerão quando houver respostas corrigidas." />}
        </Card>
        <Card title="Prioridades de revisão" description="Menores índices de acerto">
          {weakTopics.length ? <><MiniBarChart items={weakTopics.map((item) => ({ label: item.topic, value: item.accuracy, secondary: `${item.accuracy.toFixed(0)}%` }))} max={100} /><div className="mt-6 rounded-md border border-[#333] bg-[#181818] p-4"><p className="font-semibold text-white">Próxima ação sugerida</p><p className="mt-1 text-sm leading-6 text-[#888]">Revise primeiro <strong className="text-white">{weakTopics[0].topic}</strong>, em {weakTopics[0].subject}, e refaça questões desse tema.</p></div></> : <EmptyState icon="book" title="Nenhuma lacuna identificada" description="Ainda não há respostas suficientes para priorização." />}
        </Card>
      </div>
    </>
  );
}

function Legend({ label, value, className }: { label: string; value: string | number; className: string }) {
  return <div className="flex items-center justify-between border-b border-[#292929] pb-3 text-sm"><span className="inline-flex items-center gap-2 text-[#999]"><i className={`h-2.5 w-2.5 rounded-full ${className}`} />{label}</span><b className="text-white">{value}</b></div>;
}
function Small({ value, label }: { value: string | number; label: string }) {
  return <div className="rounded-lg border border-[#303030] bg-[#1d1d1d] p-2"><b className="block text-sm text-white">{value}</b><span className="text-[9px] uppercase tracking-wide text-[#777]">{label}</span></div>;
}
