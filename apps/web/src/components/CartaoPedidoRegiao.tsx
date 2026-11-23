// Cartao de pedido da regiao (lista do profissional), no formato dos cartoes de servico do template.
import Image from 'next/image';
import Link from 'next/link';
import { formatarDataHora, rotuloUrgencia } from '@/lib/formatos';
import { fotoDoServico, urlFoto } from '@/lib/mock';
import { distancia, ROTULO_MODALIDADE, type ItemDescoberta } from '@/lib/profissional';
import { Icone } from './Icone';

export function CartaoPedidoRegiao({ p }: { readonly p: ItemDescoberta }) {
  return (
    <Link href={`/profissional/pedidos/${p.id}`} className="cartao cartao-elevado servico-card">
      <div className="servico-imagem">
        <Image src={urlFoto(fotoDoServico(p.service_name))} alt="" fill sizes="(min-width: 1024px) 33vw, 100vw" />
        {p.distance_km !== undefined ? (
          <span className="nota-flutuante">
            <Icone nome="local" tamanho={12} className="estrela" /> {distancia(p.distance_km)}
          </span>
        ) : null}
      </div>
      <div className="servico-corpo">
        <h3>{p.service_name ?? 'Serviço'}</h3>
        <p style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</p>
        <div className="item-meta" style={{ marginBottom: '0.75rem' }}>
          {p.public_label ? (
            <span>
              <Icone nome="local" tamanho={14} /> {p.public_label}
            </span>
          ) : null}
          <span>
            <Icone nome="relogio" tamanho={14} /> {rotuloUrgencia(p.urgency)}
          </span>
          {p.modality ? <span>{ROTULO_MODALIDADE[p.modality] ?? p.modality}</span> : null}
          {p.has_photos ? (
            <span>
              <Icone nome="camera" tamanho={14} /> Com fotos
            </span>
          ) : null}
        </div>
        <div className="servico-rodape">
          <span className="preco-sufixo">Aceites até {formatarDataHora(p.acceptance_deadline_at)}</span>
          <span className="btn-icone" aria-hidden="true">
            <Icone nome="seta" tamanho={18} />
          </span>
        </div>
      </div>
    </Link>
  );
}
