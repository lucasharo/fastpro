'use client';
// Notificacoes deste aparelho (tela de Configuracoes): liga, desliga e explica quando nao da para ligar.
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { desligarPush, ligarPush, situacaoPush, type SituacaoPush } from '@/lib/push';
import { useSessao } from './Sessao';
import { Aviso, Carregando } from './ui';

const TEXTO: Record<SituacaoPush, string> = {
  desligado: 'Receba um aviso neste aparelho quando houver novidade nos seus pedidos.',
  ligado: 'As notificações estão ativas neste aparelho.',
  bloqueado: 'As notificações estão bloqueadas. Libere nas configurações do navegador e recarregue a página.',
  instalar_ios: 'No iPhone ou iPad, toque em Compartilhar, depois em Adicionar à Tela de Início, e abra o FastPro por lá.',
  indisponivel: 'As notificações não estão disponíveis neste navegador no momento.',
};

export function AvisosPush() {
  const { papel } = useSessao();
  const router = useRouter();
  const caminho = usePathname() ?? '';
  // Sem sessao, a tela leva a entrada.
  useEffect(() => {
    if (papel === 'anonimo') router.replace(caminho.startsWith('/profissional') ? '/profissional/entrar' : '/entrar');
  }, [papel, caminho, router]);

  const [situacao, setSituacao] = useState<SituacaoPush | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    void situacaoPush().then(setSituacao);
  }, []);

  async function alternar() {
    setOcupado(true);
    setErro('');
    if (situacao === 'ligado') {
      await desligarPush();
      setSituacao('desligado');
    } else {
      const r = await ligarPush();
      if (r === 'falha') setErro('Não foi possível ativar agora. Tente de novo.');
      else setSituacao(r);
    }
    setOcupado(false);
  }

  return (
    <section className="glass-card painel-cartao pilha" aria-labelledby="titulo-notificacoes">
      <h2 id="titulo-notificacoes" style={{ fontSize: '1.25rem' }}>
        Notificações
      </h2>
      {situacao === null ? <Carregando /> : <p className="texto-suave">{TEXTO[situacao]}</p>}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
      {situacao === 'desligado' || situacao === 'ligado' ? (
        <button
          type="button"
          className={`btn btn-sm ${situacao === 'ligado' ? 'btn-secondary' : 'btn-primary'}`}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => void alternar()}
          disabled={ocupado}
        >
          {situacao === 'ligado' ? 'Desativar notificações' : 'Ativar notificações'}
        </button>
      ) : null}
    </section>
  );
}
