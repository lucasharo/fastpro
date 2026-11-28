'use client';
// Galeria do profissional: ate 30 fotos dos servicos feitos, vistas pelo cliente no perfil. As fotos sao reduzidas no
// navegador e reencodadas no servidor. API: /v1/professional/gallery.
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Confirmacao } from '@/components/Confirmacao';
import { Icone } from '@/components/Icone';
import { ModalFoto } from '@/components/ModalFoto';
import { CabecaPagina, Carregando, Vazio } from '@/components/ui';
import { chamarApi, codigoDe, MENSAGEM_INDISPONIVEL } from '@/lib/api';
import { prepararFoto } from '@/lib/reduzir-foto';
import { Toast } from '@/components/Toast';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const ENVIO_MAX_BYTES = 4 * 1024 * 1024;
const TEXTOS: Record<string, string> = {
  limite_fotos: 'Sua galeria está cheia. Exclua uma foto para enviar outra.',
  arquivo_grande: 'A foto é grande demais. Escolha uma de até 4 MB.',
  imagem_invalida: 'Não foi possível ler esta imagem. Escolha outra foto.',
  tipo_nao_aceito: 'Use fotos JPG, PNG ou WebP.',
  suspenso: 'Sua conta está suspensa.',
};

export default function Galeria() {
  const router = useRouter();
  const [fotos, setFotos] = useState<string[] | null>(null);
  const [max, setMax] = useState(30);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [progresso, setProgresso] = useState('');
  const [aberta, setAberta] = useState<number | null>(null);
  const [excluir, setExcluir] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const seletor = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await chamarApi<{ items?: { id: string }[]; max?: number }>('/v1/professional/gallery');
    if (r.status === 401) {
      router.replace('/profissional/entrar');
      return;
    }
    if (r.status !== 200) {
      setFotos((f) => f ?? []);
      setAviso({ tipo: 'erro', texto: 'Não foi possível carregar a galeria agora.' });
      return;
    }
    setFotos((r.corpo?.items ?? []).map((f) => f.id));
    if (r.corpo?.max) setMax(r.corpo.max);
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar(arquivos: File[]) {
    if (!fotos || arquivos.length === 0) return;
    setAviso(null);
    const cabem = arquivos.slice(0, Math.max(0, max - fotos.length));
    const falhas: string[] = [];
    let enviadas = 0;
    for (const [i, arquivo] of cabem.entries()) {
      setProgresso(`Enviando ${i + 1} de ${cabem.length}…`);
      if (!TIPOS.includes(arquivo.type)) {
        falhas.push(`${arquivo.name}: ${TEXTOS.tipo_nao_aceito}`);
        continue;
      }
      const preparada = await prepararFoto(arquivo);
      if (preparada === 'grande' || preparada.blob.size > ENVIO_MAX_BYTES) {
        falhas.push(`${arquivo.name}: ${TEXTOS.arquivo_grande}`);
        continue;
      }
      const resposta = await fetch('/api/v1/professional/gallery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': preparada.tipo },
        body: preparada.blob,
      }).catch(() => null);
      if (resposta?.status === 201) enviadas += 1;
      else {
        const corpo: unknown = await resposta?.json().catch(() => null);
        falhas.push(`${arquivo.name}: ${TEXTOS[codigoDe(corpo)] ?? MENSAGEM_INDISPONIVEL}`);
      }
    }
    setProgresso('');
    if (cabem.length < arquivos.length) falhas.push(`A galeria aceita até ${max} fotos; as demais não foram enviadas.`);
    if (falhas.length > 0) setAviso({ tipo: 'erro', texto: falhas.join(' ') });
    else if (enviadas > 0) setAviso({ tipo: 'sucesso', texto: enviadas === 1 ? 'Foto enviada.' : `${enviadas} fotos enviadas.` });
    await carregar();
  }

  async function confirmarExclusao(id: string) {
    setExcluindo(true);
    const r = await chamarApi(`/v1/professional/gallery/${id}`, { method: 'DELETE' });
    setExcluindo(false);
    setExcluir(null);
    setAviso(r.status === 200 ? { tipo: 'sucesso', texto: 'Foto excluída.' } : { tipo: 'erro', texto: MENSAGEM_INDISPONIVEL });
    await carregar();
  }

  if (fotos === null) return <Carregando texto="Carregando sua galeria…" />;
  const cheia = fotos.length >= max;
  const url = (id: string) => `/api/v1/professional/gallery/${id}`;

  return (
    <>
      <CabecaPagina sobretitulo="Portfólio" titulo="Sua" destaque="galeria" texto="Mostre serviços que você já fez. Os clientes veem estas fotos no seu perfil." />
      <div className="linha-entre" style={{ marginBottom: '1rem' }}>
        <span className="campo-dica" role="status">
          {progresso || `${fotos.length} de ${max} fotos`}
        </span>
        <button type="button" className="btn btn-primary btn-sm" disabled={cheia || progresso !== ''} onClick={() => seletor.current?.click()}>
          <Icone nome="camera" tamanho={18} /> Adicionar fotos
        </button>
        <input
          ref={seletor}
          type="file"
          accept={TIPOS.join(',')}
          multiple
          hidden
          aria-label="Fotos para a galeria"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? []);
            e.target.value = '';
            void enviar(arquivos);
          }}
        />
      </div>
      <Toast aviso={aviso} />
      {fotos.length === 0 ? (
        <div className="glass-card">
          <Vazio icone="camera" titulo="Nenhuma foto ainda" texto="Adicione fotos dos seus melhores trabalhos." />
        </div>
      ) : (
        <ul className="galeria-pro">
          {fotos.map((id, i) => (
            <li key={id}>
              <button type="button" className="fotos-pedido-item" onClick={() => setAberta(i)} aria-label={`Ampliar foto ${i + 1} de ${fotos.length}`}>
                <img src={url(id)} alt={`Foto ${i + 1} da galeria`} loading="lazy" />
              </button>
              <button type="button" className="btn-link" onClick={() => setExcluir(id)} aria-label={`Excluir foto ${i + 1}`}>
                Excluir
              </button>
            </li>
          ))}
        </ul>
      )}
      {aberta !== null && fotos[aberta] ? (
        <ModalFoto
          url={url(fotos[aberta])}
          titulo={`Foto ${aberta + 1} de ${fotos.length}`}
          onFechar={() => setAberta(null)}
          onAnterior={aberta > 0 ? () => setAberta(aberta - 1) : undefined}
          onProxima={aberta < fotos.length - 1 ? () => setAberta(aberta + 1) : undefined}
        />
      ) : null}
      <Confirmacao
        aberto={excluir !== null}
        titulo="Excluir esta foto?"
        texto="Ela sai do seu perfil e não pode ser recuperada."
        rotuloConfirmar="Excluir foto"
        ocupado={excluindo}
        onConfirmar={() => excluir && void confirmarExclusao(excluir)}
        onFechar={() => setExcluir(null)}
      />
    </>
  );
}
