import { Alert } from '@/components/ui';
import { Icon } from '@/components/icon';

export function ContractNotice({ contracts, signatureUrl }: { contracts: Array<{ id: string; contract_name: string }>; signatureUrl?: string }) {
  if (!contracts.length) return null;
  return (
    <div className="mb-6">
      <Alert tone="warning" title="Contrato pendente">
        <p>Você possui {contracts.length} contrato(s) pendente(s). O acesso às turmas relacionadas ficará bloqueado até a regularização.</p>
        <div className="mt-3 space-y-1 text-xs">{contracts.slice(0, 6).map((item) => <p key={item.id}>• {item.contract_name}</p>)}</div>
        {signatureUrl ? <a href={signatureUrl} target="_blank" rel="noreferrer" className="app-button-primary mt-4"><Icon name="edit" className="h-4 w-4" /> Assinar contrato</a> : <p className="mt-3 text-xs">Entre em contato com o atendimento da Nexo Avalia para concluir a assinatura.</p>}
      </Alert>
    </div>
  );
}
