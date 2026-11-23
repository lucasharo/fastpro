'use client';
// Servicos que atende (GET/PUT /v1/professional/profile/services) e area de atendimento (GET/PUT .../area).
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CampoEndereco } from '@/components/CampoEndereco';
import { CampoServico } from '@/components/CampoServico';
import { Icone } from '@/components/Icone';
import { Aviso, CabecaPagina, Campo, Carregando } from '@/components/ui';
import { chamarApi, codigoDe, MENSAGEM_LIMITE } from '@/lib/api';
import { formatarData } from '@/lib/formatos';

interface ServicoPerfil {
  serviceId: string;
  name: string;
  modalities: string[];
}

interface Area {
  configured?: boolean;
  addressLabel?: string;
  radiusKm?: number;
  changesRemaining?: number;
  nextChangeAt?: string | null;
}

export default function Perfil() {
  const router = useRouter();
  const [servicos, setServicos] = useState<ServicoPerfil[] | null>(null);
  const [texto, setTexto] = useState('');
  const [avisoServicos, setAvisoServicos] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [endereco, setEndereco] = useState('');
  const [raio, setRaio] = useState(15);
  const [avisoArea, setAvisoArea] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const [s, a] = await Promise.all([
      chamarApi<{ services?: { serviceId: string; name: string; modalities?: string[] }[] }>('/v1/professional/profile/services'),
      chamarApi<Area>('/v1/professional/profile/area'),
    ]);
    if (s.status === 401 || a.status === 401) {
      router.replace('/profissional/entrar');
      return;
    }
    setServicos((s.corpo?.services ?? []).map((x) => ({ serviceId: x.serviceId, name: x.name, modalities: x.modalities ?? ['presencial'] })));
    if (a.status === 200 && a.corpo) {
      setArea(a.corpo);
      if (a.corpo.configured) {
        setEndereco(a.corpo.addressLabel ?? '');
        setRaio(a.corpo.radiusKm ?? 15);
      }
    } else setArea({ configured: false });
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvarServicos(lista: ServicoPerfil[]) {
    setAvisoServicos(null);
    const r = await chamarApi('/v1/professional/profile/services', {
      method: 'PUT',
      body: { services: lista.map((s) => ({ serviceId: s.serviceId, modalities: s.modalities })) },
    });
    if (r.status === 200) {
      setAvisoServicos({ tipo: 'sucesso', texto: 'Serviços salvos.' });
      await carregar();
    } else if (r.status === 429) setAvisoServicos({ tipo: 'erro', texto: MENSAGEM_LIMITE });
    else if (r.status === 403) setAvisoServicos({ tipo: 'erro', texto: 'Complete o cadastro do documento antes de escolher serviços.' });
    else setAvisoServicos({ tipo: 'erro', texto: 'Não foi possível salvar os serviços. Confira e tente de novo.' });
  }

  function alternarModalidade(id: string, m: string) {
    if (!servicos) return;
    const nova = servicos.map((s) => {
      if (s.serviceId !== id) return s;
      const tem = s.modalities.includes(m);
      const lista = tem ? s.modalities.filter((x) => x !== m) : [...s.modalities, m];
      return { ...s, modalities: lista.length > 0 ? lista : s.modalities };
    });
    setServicos(nova);
    void salvarServicos(nova);
  }

  async function salvarArea() {
    setAvisoArea(null);
    const r = await chamarApi<{ code?: string }>('/v1/professional/profile/area', { method: 'PUT', body: { addressText: endereco.trim(), radiusKm: raio } });
    if (r.status === 200) {
      setAvisoArea({ tipo: 'sucesso', texto: 'Área de atendimento salva.' });
      await carregar();
      return;
    }
    const c = codigoDe(r.corpo);
    setAvisoArea({
      tipo: 'erro',
      texto:
        r.status === 429
          ? MENSAGEM_LIMITE
          : r.status === 409
            ? 'Você já usou as trocas de área permitidas por agora.'
            : r.status === 422 && c.includes('endereco')
              ? 'Não encontramos esse endereço. Confira e tente de novo.'
              : r.status === 403
                ? 'Complete o cadastro do documento antes de definir a área.'
                : 'Não foi possível salvar a área agora.',
    });
  }

  if (servicos === null || area === null) return <Carregando texto="Carregando seu perfil…" />;

  return (
    <>
      <CabecaPagina sobretitulo="Perfil" titulo="Serviços e" destaque="área de atendimento" texto="Você recebe só pedidos dos serviços escolhidos e dentro do seu raio." />
      <div className="grade grade-2" style={{ alignItems: 'start' }}>
        <div className="glass-card painel-cartao pilha">
          <div className="linha">
            <div className="circulo-icone">
              <Icone nome="ferramenta" />
            </div>
            <h2 style={{ fontSize: '1.125rem' }}>Serviços que você faz</h2>
          </div>
          <Campo id="novo-servico" rotulo="Adicionar serviço">
            <CampoServico
              id="novo-servico"
              className="entrada"
              valor={texto}
              onTexto={setTexto}
              onEscolher={(s) => {
                setTexto('');
                if (servicos.some((x) => x.serviceId === s.service_id)) return;
                const nova = [...servicos, { serviceId: s.service_id, name: s.service_name, modalities: ['presencial'] }];
                setServicos(nova);
                void salvarServicos(nova);
              }}
            />
          </Campo>
          {servicos.length === 0 ? <p className="texto-suave">Nenhum serviço escolhido ainda.</p> : null}
          {servicos.map((s) => (
            <div key={s.serviceId} className="item-lista" style={{ padding: '0.75rem 1rem' }}>
              <div className="item-corpo">
                <div className="item-titulo">{s.name}</div>
                <div className="linha" style={{ marginTop: '0.5rem', gap: '0.5rem' }}>
                  {['presencial', 'online'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`selo selo-sm ${s.modalities.includes(m) ? '' : 'selo-neutro'}`}
                      style={{ border: 'none', cursor: 'pointer' }}
                      aria-pressed={s.modalities.includes(m)}
                      onClick={() => alternarModalidade(s.serviceId, m)}
                    >
                      {m === 'presencial' ? 'Presencial' : 'Online'}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="btn-icone"
                aria-label={`Remover ${s.name}`}
                onClick={() => {
                  const nova = servicos.filter((x) => x.serviceId !== s.serviceId);
                  setServicos(nova);
                  void salvarServicos(nova);
                }}
              >
                <Icone nome="fechar" tamanho={16} />
              </button>
            </div>
          ))}
          {avisoServicos ? <Aviso tipo={avisoServicos.tipo}>{avisoServicos.texto}</Aviso> : null}
        </div>

        <div className="glass-card painel-cartao form">
          <div className="linha">
            <div className="circulo-icone">
              <Icone nome="local" />
            </div>
            <h2 style={{ fontSize: '1.125rem' }}>Área de atendimento</h2>
          </div>
          <Campo id="base" rotulo="Endereço de base" dica="Só usamos para calcular a distância. Clientes não veem seu endereço.">
            <CampoEndereco id="base" contexto="professional_base" valor={endereco} onMudar={setEndereco} />
          </Campo>
          <div className="campo">
            <label htmlFor="raio">
              Raio de atendimento: <strong className="destaque">{raio} km</strong>
            </label>
            <input id="raio" type="range" min={5} max={100} step={5} value={raio} onChange={(e) => setRaio(Number(e.target.value))} style={{ accentColor: 'var(--fp-primary)' }} />
          </div>
          {area.configured && typeof area.changesRemaining === 'number' ? (
            <p className="campo-dica">
              Trocas restantes: {area.changesRemaining}
              {area.nextChangeAt ? ` · próxima troca liberada em ${formatarData(area.nextChangeAt)}` : ''}
            </p>
          ) : null}
          {avisoArea ? <Aviso tipo={avisoArea.tipo}>{avisoArea.texto}</Aviso> : null}
          <button type="button" className="btn btn-primary btn-bloco" onClick={() => void salvarArea()} disabled={endereco.trim().length < 3}>
            Salvar área
          </button>
        </div>
      </div>
    </>
  );
}
