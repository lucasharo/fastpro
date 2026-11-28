'use client';
// Certificacao de um servico regulamentado, no mesmo modo de envio do documento: o arquivo e escolhido e so vai ao
// clicar em Enviar para analise. Aceita ate 5 arquivos por servico; com algum ja enviado, a area aparece ao adicionar.
import { useState } from 'react';
import { ArquivoEnviado } from '@/components/ArquivoEnviado';
import { CampoVariosArquivos } from '@/components/CampoArquivo';
import { Icone } from '@/components/Icone';
import { Aviso } from '@/components/ui';
import { chamarApi, MENSAGEM_INDISPONIVEL } from '@/lib/api';
import { enviarDocumento, erroDoArquivo } from '@/lib/enviar-documento';
import { formatarData } from '@/lib/formatos';
import type { ArquivoRecebido } from '@/lib/primeiros-passos';

const MAX_ARQUIVOS = 5;

export interface CertificacaoServicoProps {
  readonly servicoId: string;
  readonly nome: string;
  readonly arquivos: readonly ArquivoRecebido[];
  readonly aoEnviar: () => Promise<void>;
}

export function CertificacaoServico({ servicoId, nome, arquivos, aoEnviar }: CertificacaoServicoProps) {
  const [escolhidos, setEscolhidos] = useState<File[]>([]);
  const [progresso, setProgresso] = useState('');
  const [erro, setErro] = useState('');
  const [erroArquivo, setErroArquivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [expandido, setExpandido] = useState(false);
  const id = `certificado-${servicoId}`;
  const enviada = arquivos.length > 0;
  const cheia = arquivos.length >= MAX_ARQUIVOS;
  const aberto = !enviada || (expandido && !cheia);

  const restantes = MAX_ARQUIVOS - arquivos.length - escolhidos.length;

  function escolher(novos: File[]) {
    if (novos.length === 0) return;
    const problemas = novos.flatMap((f) => {
      const problema = erroDoArquivo(f);
      return problema ? [`${f.name}: ${problema}`] : [];
    });
    const bons = novos.filter((f) => erroDoArquivo(f) === null);
    if (bons.length > restantes) problemas.push(`Cada serviço aceita até ${MAX_ARQUIVOS} arquivos; os demais não foram incluídos.`);
    setErro('');
    setErroArquivo(problemas.join(' '));
    setEscolhidos([...escolhidos, ...bons.slice(0, Math.max(0, restantes))]);
  }

  async function enviar() {
    if (enviando) return;
    if (escolhidos.length === 0) {
      setErroArquivo('Campo obrigatório.');
      return;
    }
    setEnviando(true);
    setErro('');
    setErroArquivo('');
    try {
      // Um por vez (o servidor aceita um envio pendente por servico). O que falhar continua na lista.
      for (const [i, arquivo] of escolhidos.entries()) {
        setProgresso(`Enviando ${i + 1} de ${escolhidos.length}…`);
        const r = await enviarDocumento(arquivo, servicoId);
        if (!r.ok) {
          setErro(`${arquivo.name}: ${r.texto}`);
          setEscolhidos(escolhidos.slice(r.trocarArquivo ? i + 1 : i));
          await aoEnviar();
          return;
        }
      }
      setEscolhidos([]);
      setExpandido(false);
      await aoEnviar();
    } finally {
      setProgresso('');
      setEnviando(false);
    }
  }

  async function excluir(idArquivo: string) {
    setErro('');
    const r = await chamarApi(`/v1/professional/documents/${encodeURIComponent(idArquivo)}`, { method: 'DELETE' });
    if (r.status === 409) setErro('Este arquivo já foi analisado e não pode ser excluído.');
    else if (r.status !== 200 && r.status !== 204) setErro(MENSAGEM_INDISPONIVEL);
    await aoEnviar();
  }

  return (
    <div className="onboard-certificado">
      <div>
        <div className="item-titulo">{nome}</div>
        <div className="campo-dica">
          {enviada ? `${arquivos.length} de ${MAX_ARQUIVOS} arquivos enviados` : 'Falta a certificação'}
        </div>
      </div>
      {enviada ? (
        <ul className="certificado-arquivos">
          {arquivos.map((f, i) => (
            <li key={f.id}>
              <ArquivoEnviado id={f.id} pdf={f.pdf === true} rotulo={`o arquivo ${i + 1} da certificação de ${nome}`} />
              {f.receivedAt ? <span className="campo-dica">{formatarData(f.receivedAt)}</span> : null}
              {f.deletable ? (
                <button type="button" className="btn-link" disabled={enviando} onClick={() => void excluir(f.id)}>
                  Excluir
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!aberto && !cheia ? (
        <div className="onboard-acoes">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpandido(true)}>
            Adicionar arquivo
          </button>
        </div>
      ) : null}
      {aberto ? (
        <div className="form">
          <div className="campo">
            <label htmlFor={id}>{enviada ? 'Novos arquivos' : 'Fotos ou PDFs da certificação'}</label>
            <CampoVariosArquivos
              id={id}
              deQue={`da certificação de ${nome}`}
              arquivos={escolhidos}
              restantes={restantes}
              aoEscolher={escolher}
              aoRemover={(i) => {
                setEscolhidos(escolhidos.filter((_, n) => n !== i));
                setErroArquivo('');
              }}
              desabilitado={enviando}
              invalido={Boolean(erroArquivo)}
            />
            {erroArquivo ? (
              <span className="campo-erro" role="alert">
                {erroArquivo}
              </span>
            ) : (
              <span className="campo-dica">Você pode escolher vários. Foto até 5 MB (JPG, PNG, WebP) ou PDF até 2 MB. Nada é enviado antes de clicar em Enviar para análise.</span>
            )}
          </div>
          <button type="button" className="btn btn-primary btn-bloco" disabled={enviando} onClick={() => void enviar()}>
            <Icone nome={enviando ? 'relogio' : 'enviar'} tamanho={18} />
            {enviando ? progresso || 'Enviando…' : 'Enviar para análise'}
          </button>
        </div>
      ) : null}
      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}
    </div>
  );
}
