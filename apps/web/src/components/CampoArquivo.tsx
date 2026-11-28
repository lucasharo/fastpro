'use client';
// Area de envio de um arquivo de verificacao, igual no documento e nas certificacoes: area tracejada para escolher,
// arrastar ou colar; depois de escolhido, a linha do arquivo com Trocar e Remover.
import { EscolherArquivo } from '@/components/EscolherArquivo';
import { Icone } from '@/components/Icone';
import { tamanhoLegivel, TIPOS_DOCUMENTO } from '@/lib/enviar-documento';

export interface CampoArquivoProps {
  readonly id: string;
  /** Nome do que esta sendo enviado, para leitores de tela (ex.: "do documento"). */
  readonly deQue: string;
  readonly arquivo: File | null;
  readonly aoEscolher: (arquivo: File | undefined) => void;
  readonly aoRemover: () => void;
  readonly desabilitado?: boolean;
  readonly invalido?: boolean;
}

export function CampoArquivo({ id, deQue, arquivo, aoEscolher, aoRemover, desabilitado, invalido }: CampoArquivoProps) {
  if (arquivo) {
    return (
      <div className="item-lista" style={{ padding: '0.75rem' }}>
        <Icone nome="documento" />
        <div className="item-corpo">
          <div className="item-titulo">{arquivo.name}</div>
          <div className="campo-dica">{tamanhoLegivel(arquivo.size)} · aguardando envio</div>
        </div>
        <EscolherArquivo
          className="btn-link"
          tipos={TIPOS_DOCUMENTO}
          aoEscolher={aoEscolher}
          rotuloAcessivel={`Trocar o arquivo ${deQue}`}
          desabilitado={desabilitado}
        >
          Trocar
        </EscolherArquivo>
        <button type="button" className="btn-link" disabled={desabilitado} onClick={aoRemover}>
          Remover
        </button>
      </div>
    );
  }
  return (
    <EscolherArquivo
      id={id}
      className="opcao escolher-arquivo-area"
      tipos={TIPOS_DOCUMENTO}
      aoEscolher={aoEscolher}
      rotuloAcessivel={`Escolher arquivo ${deQue}`}
      invalido={invalido}
      desabilitado={desabilitado}
    >
      <Icone nome="camera" tamanho={28} />
      <span style={{ fontWeight: 500 }}>Escolher arquivo</span>
      <span className="campo-dica">ou arraste o arquivo para cá, ou clique aqui e cole (Ctrl+V)</span>
    </EscolherArquivo>
  );
}

export interface CampoVariosArquivosProps {
  readonly id: string;
  readonly deQue: string;
  readonly arquivos: readonly File[];
  /** Quantos ainda cabem alem dos ja escolhidos. */
  readonly restantes: number;
  readonly aoEscolher: (arquivos: File[]) => void;
  readonly aoRemover: (indice: number) => void;
  readonly desabilitado?: boolean;
  readonly invalido?: boolean;
}

/** A mesma area, para varios arquivos em um unico envio: lista os escolhidos e continua aberta enquanto couber. */
export function CampoVariosArquivos({ id, deQue, arquivos, restantes, aoEscolher, aoRemover, desabilitado, invalido }: CampoVariosArquivosProps) {
  return (
    <div className="pilha" style={{ gap: '0.5rem' }}>
      {arquivos.map((arquivo, i) => (
        <div key={`${arquivo.name}-${i}`} className="item-lista" style={{ padding: '0.75rem' }}>
          <Icone nome="documento" />
          <div className="item-corpo">
            <div className="item-titulo">{arquivo.name}</div>
            <div className="campo-dica">{tamanhoLegivel(arquivo.size)} · aguardando envio</div>
          </div>
          <button type="button" className="btn-link" disabled={desabilitado} onClick={() => aoRemover(i)}>
            Remover
          </button>
        </div>
      ))}
      {restantes > 0 ? (
        <EscolherArquivo
          id={id}
          className="opcao escolher-arquivo-area"
          tipos={TIPOS_DOCUMENTO}
          aoEscolher={(f) => aoEscolher(f ? [f] : [])}
          aoEscolherVarios={aoEscolher}
          rotuloAcessivel={`Escolher arquivos ${deQue}`}
          invalido={invalido}
          desabilitado={desabilitado}
        >
          <Icone nome="camera" tamanho={28} />
          <span style={{ fontWeight: 500 }}>{arquivos.length > 0 ? 'Escolher mais arquivos' : 'Escolher arquivos'}</span>
          <span className="campo-dica">ou arraste para cá, ou clique aqui e cole (Ctrl+V)</span>
        </EscolherArquivo>
      ) : null}
    </div>
  );
}
