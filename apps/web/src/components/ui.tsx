// Componentes de pagina reaproveitados por todas as telas internas (mesma linguagem do template).
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icone, type NomeIcone } from './Icone';

export function PaginaInterna({
  children,
  largura = 'larga',
}: {
  readonly children: ReactNode;
  readonly largura?: 'larga' | 'media' | 'estreita';
}) {
  const classe = largura === 'estreita' ? 'pagina-estreita' : largura === 'media' ? 'pagina-media' : '';
  return (
    <div className="pagina">
      <div className="pagina-topo">
        <div className="aurora-bg" />
      </div>
      <div className={`pagina-conteudo ${classe}`}>{children}</div>
    </div>
  );
}

export function CabecaPagina({
  sobretitulo,
  titulo,
  destaque,
  texto,
  voltar,
  acoes,
}: {
  readonly sobretitulo?: string;
  readonly titulo: string;
  readonly destaque?: string;
  readonly texto?: ReactNode;
  readonly voltar?: { href: string; rotulo: string };
  readonly acoes?: ReactNode;
}) {
  return (
    <div className="pagina-cabeca">
      {voltar ? (
        <Link href={voltar.href} className="voltar">
          <Icone nome="voltar" tamanho={16} />
          {voltar.rotulo}
        </Link>
      ) : null}
      <div className="linha-entre" style={{ alignItems: 'flex-end' }}>
        <div>
          {sobretitulo ? <span className="sobretitulo">{sobretitulo}</span> : null}
          <h1>
            {titulo} {destaque ? <span className="destaque">{destaque}</span> : null}
          </h1>
          {texto ? <p>{texto}</p> : null}
        </div>
        {acoes}
      </div>
    </div>
  );
}

export type TipoAviso = 'info' | 'erro' | 'sucesso' | 'alerta';

const ICONE_AVISO: Record<TipoAviso, NomeIcone> = { info: 'alerta', erro: 'alerta', sucesso: 'check', alerta: 'relogio' };

export function Aviso({ tipo = 'info', children }: { readonly tipo?: TipoAviso; readonly children: ReactNode }) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : 'status'}>
      <Icone nome={ICONE_AVISO[tipo]} tamanho={18} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

export function Campo({
  id,
  rotulo,
  erro,
  dica,
  children,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly erro?: string;
  readonly dica?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      {children}
      {erro ? (
        <span id={`${id}-erro`} className="campo-erro">
          {erro}
        </span>
      ) : dica ? (
        <span className="campo-dica">{dica}</span>
      ) : null}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…' }: { readonly texto?: string }) {
  return (
    <div className="vazio" role="status" aria-live="polite">
      <div className="circulo-icone">
        <Icone nome="relogio" />
      </div>
      <p className="texto-suave">{texto}</p>
    </div>
  );
}

export function Vazio({
  icone = 'documento',
  titulo,
  texto,
  acao,
}: {
  readonly icone?: NomeIcone;
  readonly titulo: string;
  readonly texto?: ReactNode;
  readonly acao?: ReactNode;
}) {
  return (
    <div className="vazio">
      <div className="circulo-icone">
        <Icone nome={icone} />
      </div>
      <h3 style={{ fontSize: '1.125rem', marginBottom: '0.5rem' }}>{titulo}</h3>
      {texto ? (
        <p className="texto-suave" style={{ marginBottom: '1.5rem' }}>
          {texto}
        </p>
      ) : null}
      {acao}
    </div>
  );
}
