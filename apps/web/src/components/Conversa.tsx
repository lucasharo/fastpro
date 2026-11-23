'use client';
// Conversa de texto (DEMONSTRACAO): o chat ainda nao existe na API (backlog E7). Mensagens ficam so na tela.
import Image from 'next/image';
import { useState, type FormEvent } from 'react';
import { CONVERSA_MOCK, type MensagemMock } from '@/lib/mock';
import { Icone } from './Icone';
import { SeloMock } from './ui';

export function Conversa({ nome, foto, subtitulo }: { readonly nome: string; readonly foto: string; readonly subtitulo?: string }) {
  const [mensagens, setMensagens] = useState<MensagemMock[]>([...CONVERSA_MOCK]);
  const [texto, setTexto] = useState('');

  function enviar(e: FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    const agora = new Date();
    setMensagens((m) => [...m, { de: 'eu', texto: t, hora: `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}` }]);
    setTexto('');
  }

  return (
    <div className="cartao conversa">
      <div className="linha-entre" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
        <div className="linha">
          <Image src={foto} alt="" width={40} height={40} className="avatar" />
          <div>
            <div className="autor-nome">{nome}</div>
            <div className="autor-local">{subtitulo ?? 'Online agora'}</div>
          </div>
        </div>
        <SeloMock />
      </div>
      <div className="mensagens" aria-live="polite">
        {mensagens.map((m, i) => (
          <div key={i} className={`balao ${m.de === 'eu' ? 'balao-meu' : 'balao-deles'}`}>
            {m.texto}
            <span className="balao-hora">{m.hora}</span>
          </div>
        ))}
      </div>
      <form className="compositor" onSubmit={enviar}>
        <label htmlFor="mensagem" className="sr-only">
          Mensagem
        </label>
        <input id="mensagem" className="entrada" placeholder="Escreva uma mensagem…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button type="submit" className="btn btn-primary" aria-label="Enviar mensagem" style={{ padding: '0 1.25rem' }}>
          <Icone nome="enviar" tamanho={18} />
        </button>
      </form>
    </div>
  );
}
