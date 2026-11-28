'use client';
// Dados do profissional: foto, nome publico e biografia (/v1/professional/account). O nome publico nasce no envio do
// documento; antes disso o campo fica bloqueado.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { chamarApi, MENSAGEM_INDISPONIVEL, ok } from '@/lib/api';
import { iniciais } from '@/lib/iniciais';
import { prepararFoto } from '@/lib/reduzir-foto';
import { Icone } from './Icone';
import { Campo } from './ui';
import { Toast } from '@/components/Toast';

const BIO_MAX = 500;
const ENVIO_MAX_BYTES = 4 * 1024 * 1024;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

interface Conta {
  publicName: string | null;
  bio: string | null;
  hasPhoto: boolean;
}

export function DadosProfissional() {
  const [conta, setConta] = useState<Conta | null>(null);
  const [nome, setNome] = useState('');
  const [bio, setBio] = useState('');
  const [erroNome, setErroNome] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Muda a cada troca para o navegador buscar a foto nova.
  const [versaoFoto, setVersaoFoto] = useState(0);
  const seletor = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await chamarApi<Conta>('/v1/professional/account');
    if (r.status !== 200 || !r.corpo) return null;
    setConta(r.corpo);
    return r.corpo;
  }, []);

  useEffect(() => {
    void carregar().then((c) => {
      setNome(c?.publicName ?? '');
      setBio(c?.bio ?? '');
    });
  }, [carregar]);

  const temNome = Boolean(conta?.publicName);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    const n = nome.trim();
    const erro = !temNome ? '' : n === '' ? 'Campo obrigatório.' : [...n].length < 2 ? 'O nome público deve ter de 2 a 80 caracteres.' : '';
    setErroNome(erro);
    if (erro) return;
    setOcupado(true);
    const r = await chamarApi('/v1/professional/account', { method: 'PUT', body: { publicName: temNome ? n : '', bio: bio.trim() } });
    setOcupado(false);
    if (!ok(r.status)) return setAviso({ tipo: 'erro', texto: MENSAGEM_INDISPONIVEL });
    setAviso({ tipo: 'sucesso', texto: 'Dados salvos.' });
    await carregar();
  }

  async function enviarFoto(arquivo: File | undefined) {
    if (!arquivo) return;
    setAviso(null);
    if (!TIPOS.includes(arquivo.type)) return setAviso({ tipo: 'erro', texto: 'Use uma foto JPG, PNG ou WebP.' });
    setOcupado(true);
    const preparada = await prepararFoto(arquivo);
    if (preparada === 'grande' || preparada.blob.size > ENVIO_MAX_BYTES) {
      setOcupado(false);
      return setAviso({ tipo: 'erro', texto: 'A foto é grande demais. O limite é de 4 MB.' });
    }
    const r = await fetch('/api/v1/professional/account/photo', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': preparada.tipo },
      body: preparada.blob,
    }).catch(() => null);
    setOcupado(false);
    if (r?.status !== 201) return setAviso({ tipo: 'erro', texto: 'Não foi possível enviar a foto. Tente de novo.' });
    setVersaoFoto((v) => v + 1);
    setAviso({ tipo: 'sucesso', texto: 'Foto atualizada.' });
    await carregar();
  }

  async function removerFoto() {
    setAviso(null);
    setOcupado(true);
    const r = await chamarApi('/v1/professional/account/photo', { method: 'DELETE' });
    setOcupado(false);
    if (!ok(r.status)) return setAviso({ tipo: 'erro', texto: MENSAGEM_INDISPONIVEL });
    await carregar();
  }

  return (
    <form className="glass-card painel-cartao form" onSubmit={salvar} noValidate>
      <h2 style={{ fontSize: '1.125rem' }}>Seus dados</h2>
      <div className="dados-topo">
        <div className="foto-coluna">
          <div className="foto-editavel">
            <span className="avatar-letra avatar-grande" aria-hidden="true">
              {/* Imagem servida pela propria API. */}
              {conta?.hasPhoto ? <img src={`/api/v1/professional/account/photo?v=${versaoFoto}`} alt="" /> : iniciais(nome || 'Profissional')}
            </span>
            <button
              type="button"
              className="btn-primary foto-editar"
              aria-label={conta?.hasPhoto ? 'Trocar foto' : 'Adicionar foto'}
              title="JPG, PNG ou WebP, até 4 MB"
              disabled={ocupado || !conta}
              onClick={() => seletor.current?.click()}
            >
              <Icone nome="camera" tamanho={16} />
            </button>
          </div>
          {conta?.hasPhoto ? (
            <button type="button" className="btn-link" disabled={ocupado} onClick={() => void removerFoto()}>
              Remover foto
            </button>
          ) : null}
        </div>
        <input
          ref={seletor}
          type="file"
          accept={TIPOS.join(',')}
          hidden
          onChange={(e) => {
            void enviarFoto(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Campo
          id="nome-publico"
          rotulo="Nome público"
          erro={erroNome || undefined}
          dica={
            temNome || !conta ? (
              'É como os clientes veem você. Pode ser o nome do seu negócio.'
            ) : (
              <>
                Defina o nome ao enviar seu documento em <Link href="/profissional/gestao">Gestão profissional</Link>.
              </>
            )
          }
        >
          <input
            id="nome-publico"
            className="entrada"
            maxLength={80}
            value={nome}
            disabled={!temNome}
            aria-invalid={erroNome ? 'true' : undefined}
            onChange={(e) => {
              setNome(e.target.value);
              setErroNome('');
            }}
          />
        </Campo>
      </div>
      <Campo id="bio" rotulo="Biografia" dica={`Aparece no seu perfil público. ${bio.length}/${BIO_MAX}`}>
        <textarea
          id="bio"
          className="entrada"
          rows={5}
          maxLength={BIO_MAX}
          placeholder="Conte sua experiência, o que você faz e como trabalha."
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
      </Campo>
      <Toast aviso={aviso} />
      <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} disabled={ocupado || !conta}>
        {ocupado ? 'Salvando…' : 'Salvar dados'}
      </button>
    </form>
  );
}
