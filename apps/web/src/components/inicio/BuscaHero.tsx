'use client';
// Busca em card de vidro do hero: servico (catalogo real), endereco e quando. Leva ao pedido ja preenchido.
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { CampoServico } from '@/components/CampoServico';
import type { ServicoCatalogo } from '@/lib/api';

export function BuscaHero() {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [servico, setServico] = useState<ServicoCatalogo | null>(null);
  const [endereco, setEndereco] = useState('');
  const [quando, setQuando] = useState('esta_semana');

  function buscar(e: FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (servico) {
      p.set('servico_id', servico.service_id);
      p.set('servico', servico.service_name);
    } else if (texto.trim()) {
      p.set('q', texto.trim());
    }
    if (endereco.trim()) p.set('endereco', endereco.trim());
    p.set('quando', quando);
    router.push(`/pedido?${p.toString()}`);
  }

  return (
    <form className="glass-card busca-card" onSubmit={buscar} role="search" aria-label="Pedir um serviço">
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
          <input
            id="hero-endereco"
            placeholder="Bairro ou CEP"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
          />
        </div>
        <div className="busca-campo">
          <label htmlFor="hero-quando">Quando?</label>
          <select id="hero-quando" value={quando} onChange={(e) => setQuando(e.target.value)}>
            <option value="urgente">Hoje ou amanhã</option>
            <option value="esta_semana">Nesta semana</option>
            <option value="flexivel">Sem pressa</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary btn-sm">
          Buscar
        </button>
      </div>
    </form>
  );
}
