'use client';
// Busca em card de vidro do hero: servico (catalogo real), endereco com sugestoes do Mapbox e quando.
// A API so libera as sugestoes de endereco para quem ja tem um rascunho de pedido (protege a cota do Mapbox):
// o rascunho e criado na primeira vez que a pessoa mexe no endereco. "Buscar" grava servico e endereco no
// rascunho e leva ao pedido ja preenchido.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CampoEndereco, ENDERECO_MIN } from '@/components/CampoEndereco';
import { CampoServico } from '@/components/CampoServico';
import { Selecao } from '@/components/Selecao';
import { chamarApi, MENSAGEM_LIMITE, ok, type ServicoCatalogo } from '@/lib/api';

export function BuscaHero() {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [servico, setServico] = useState<ServicoCatalogo | null>(null);
  const [endereco, setEndereco] = useState('');
  const [quando, setQuando] = useState('esta_semana');
  const [criado, setCriado] = useState(false);
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const preparando = useRef<Promise<boolean> | null>(null);

  // Rascunho ja existente (ex.: a pessoa voltou a inicial): as sugestoes ja podem aparecer.
  useEffect(() => {
    void (async () => {
      const r = await chamarApi('/v1/drafts/current');
      if (r.status === 200) setCriado(true);
    })();
  }, []);

  /** Cria o rascunho uma unica vez (com o servico, se ja escolhido; senao com o endereco digitado). */
  function preparar(): Promise<boolean> {
    if (criado) return Promise.resolve(true);
    if (preparando.current) return preparando.current;
    const corpo = servico ? { service_id: servico.service_id } : endereco.trim().length >= ENDERECO_MIN ? { address_text: endereco.trim() } : null;
    if (corpo === null) return Promise.resolve(false);
    preparando.current = (async () => {
      const r = await chamarApi('/v1/drafts', { method: 'POST', body: corpo });
      preparando.current = null;
      if (ok(r.status)) {
        setCriado(true);
        return true;
      }
      if (r.status === 429) setAviso(MENSAGEM_LIMITE);
      return false;
    })();
    return preparando.current;
  }

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setAviso('');
    if (endereco.trim().length < ENDERECO_MIN) {
      setAviso('Digite o endereço do serviço (rua, número e bairro).');
      return;
    }
    setEnviando(true);
    const parcial: Record<string, string> = { address_text: endereco.trim() };
    if (servico) parcial.service_id = servico.service_id;
    const r = criado
      ? await chamarApi('/v1/drafts/current', { method: 'PATCH', body: parcial })
      : await chamarApi('/v1/drafts', { method: 'POST', body: parcial });
    setEnviando(false);
    if (!ok(r.status)) {
      setAviso(r.status === 429 ? MENSAGEM_LIMITE : 'Não foi possível continuar agora. Tente de novo.');
      return;
    }
    const p = new URLSearchParams();
    if (!servico && texto.trim()) p.set('q', texto.trim());
    p.set('quando', quando);
    router.push(`/pedido?${p.toString()}`);
  }

  return (
    <form className="glass-card busca-card" onSubmit={buscar} role="search" aria-label="Pedir um serviço" noValidate>
      <div className="busca-grade">
        <div className="busca-campo">
          <label htmlFor="hero-servico">Qual serviço?</label>
          <CampoServico
            id="hero-servico"
            valor={texto}
            onTexto={(t) => {
              setTexto(t);
              if (servico && t !== servico.service_name) setServico(null);
            }}
            onEscolher={setServico}
            placeholder="Eletricista, faxina, pintor..."
          />
        </div>
        <div className="busca-campo">
          <label htmlFor="hero-endereco">Onde?</label>
          <CampoEndereco
            id="hero-endereco"
            className=""
            contexto="request_draft"
            valor={endereco}
            onMudar={setEndereco}
            podeConsultar={criado}
            onPreparar={() => void preparar()}
            placeholder="Rua, número e bairro"
          />
        </div>
        <div className="busca-campo">
          <label htmlFor="hero-quando">Quando?</label>
          <Selecao
            id="hero-quando"
            variante="limpo"
            valor={quando}
            onMudar={setQuando}
            opcoes={[
              { valor: 'urgente', rotulo: 'Hoje ou amanhã' },
              { valor: 'esta_semana', rotulo: 'Nesta semana' },
              { valor: 'flexivel', rotulo: 'Sem pressa' },
            ]}
          />
        </div>
        <button type="submit" className="btn btn-primary btn-sm" disabled={enviando}>
          {enviando ? 'Aguarde…' : 'Buscar'}
        </button>
      </div>
      {aviso ? (
        <p className="campo-erro" role="alert" style={{ marginTop: '0.75rem' }}>
          {aviso}
        </p>
      ) : null}
    </form>
  );
}
