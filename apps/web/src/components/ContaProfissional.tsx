// Moldura das telas de conta do profissional: cartao de vidro a esquerda e imagem com selo a direita.
import Image from 'next/image';
import type { ReactNode } from 'react';
import { urlFoto } from '@/lib/mock';
import { Icone } from './Icone';

export const MOTIVOS_SENHA: Record<string, string> = {
  tipo: 'Escolha outra senha.',
  curta: 'A senha precisa ter pelo menos 8 caracteres.',
  longa: 'A senha é longa demais. Escolha uma mais curta.',
  controle: 'A senha tem um caractere que não pode ser usado. Escolha outra.',
  igual_email: 'A senha não pode ser igual ao seu e-mail.',
  comum: 'Esta senha é comum demais. Escolha outra mais difícil de adivinhar.',
};

export function MolduraConta({
  sobretitulo,
  titulo,
  destaque,
  texto,
  children,
}: {
  readonly sobretitulo: string;
  readonly titulo: string;
  readonly destaque?: string;
  readonly texto?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="pagina">
      <div className="pagina-topo">
        <div className="aurora-bg" />
      </div>
      <div className="pagina-conteudo hero-conteudo" style={{ paddingTop: 0, alignItems: 'start' }}>
        <div>
          <div className="pagina-cabeca">
            <span className="sobretitulo">{sobretitulo}</span>
            <h1>
              {titulo} {destaque ? <span className="destaque">{destaque}</span> : null}
            </h1>
            {texto ? <p>{texto}</p> : null}
          </div>
          <div className="glass-card painel-cartao">{children}</div>
        </div>
        <div className="hero-galeria">
          <div className="foto" style={{ aspectRatio: '4 / 5' }}>
            <Image src={urlFoto('eletricista', 700, 875)} alt="Profissional verificado trabalhando" fill sizes="40vw" priority />
          </div>
          <div className="flutuante glass-card">
            <div className="circulo-icone">
              <Icone nome="escudo" />
            </div>
            <div>
              <div style={{ fontWeight: 700 }}>14 dias grátis</div>
              <div className="texto-suave" style={{ fontSize: '0.875rem' }}>
                depois da aprovação do documento
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
