// Pagina para profissionais (mesma linguagem do template): proposta, como funciona e planos aprovados.
import Image from 'next/image';
import Link from 'next/link';
import { Icone, type NomeIcone } from '@/components/Icone';
import { urlFoto } from '@/lib/mock';

const PLANOS = [
  { nome: 'Mensal', preco: 'R$ 29,90', mes: 'R$ 29,90/mês', destaque: false },
  { nome: 'Trimestral', preco: 'R$ 80,70', mes: 'R$ 26,90/mês', destaque: false },
  { nome: 'Semestral', preco: 'R$ 149,40', mes: 'R$ 24,90/mês', destaque: false },
  { nome: 'Anual', preco: 'R$ 238,80', mes: 'R$ 19,90/mês', destaque: true },
] as const;

const VANTAGENS: readonly { icone: NomeIcone; titulo: string; texto: string }[] = [
  { icone: 'carteira', titulo: 'Sem pagar por contato', texto: 'Uma assinatura fixa. Aceite quantos pedidos quiser.' },
  { icone: 'local', titulo: 'Pedidos da sua região', texto: 'Você define a base e o raio de atendimento.' },
  { icone: 'conversa', titulo: 'Conversa direta', texto: 'Combine detalhes com o cliente antes de ir.' },
  { icone: 'escudo', titulo: 'Selo de verificado', texto: 'Clientes confiam mais em quem tem documento conferido.' },
];

export default function ParaProfissionais() {
  return (
    <>
      <section className="hero" style={{ minHeight: 'auto' }}>
        <div className="aurora-bg" />
        <div className="hero-conteudo">
          <div>
            <span className="selo">
              <Icone nome="maleta" tamanho={16} />
              Para profissionais
            </span>
            <h1>
              Receba pedidos <span className="destaque">sem pagar por contato</span>
            </h1>
            <p className="hero-texto">
              Cadastre-se, envie seu documento e, depois da aprovação, ganhe 14 dias grátis para receber pedidos da sua região.
            </p>
            <div className="linha" style={{ marginBottom: '2rem' }}>
              <Link href="/profissional/cadastro" className="btn btn-primary">
                Criar conta grátis <Icone nome="seta" tamanho={18} />
              </Link>
              <Link href="/profissional/entrar" className="btn btn-secondary">
                Já tenho conta
              </Link>
            </div>
            <div className="numeros">
              <div>
                <div className="numero-valor">14 dias</div>
                <div className="numero-rotulo">Teste grátis</div>
              </div>
              <div>
                <div className="numero-valor">R$ 0</div>
                <div className="numero-rotulo">Por contato</div>
              </div>
              <div>
                <div className="numero-valor">
                  <span className="estrela">★</span>4,9
                </div>
                <div className="numero-rotulo">Satisfação</div>
              </div>
            </div>
          </div>
          <div className="hero-galeria">
            <div className="galeria-grade">
              <div className="galeria-coluna">
                <div className="foto foto-43">
                  <Image src={urlFoto('reforma', 400, 300)} alt="Profissional analisando uma planta" fill sizes="25vw" priority />
                </div>
                <div className="foto foto-11">
                  <Image src={urlFoto('encanador', 400, 400)} alt="Torneira instalada" fill sizes="25vw" priority />
                </div>
              </div>
              <div className="galeria-coluna galeria-coluna-baixa">
                <div className="foto foto-11">
                  <Image src={urlFoto('eletricista', 400, 400)} alt="Eletricista trabalhando" fill sizes="25vw" priority />
                </div>
                <div className="foto foto-43">
                  <Image src={urlFoto('jardinagem', 400, 300)} alt="Ferramentas de jardinagem" fill sizes="25vw" priority />
                </div>
              </div>
            </div>
            <div className="flutuante glass-card">
              <div className="circulo-icone">
                <Icone nome="local" />
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>Novo pedido a 2,4 km</div>
                <div className="texto-suave" style={{ fontSize: '0.875rem' }}>
                  Instalação de chuveiro
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="secao secao-clara">
        <div className="container">
          <div className="cabeca-centro">
            <span className="sobretitulo">Vantagens</span>
            <h2 className="titulo-secao">
              Feito para quem <span className="destaque">trabalha por conta</span>
            </h2>
          </div>
          <div className="grade grade-4">
            {VANTAGENS.map((v) => (
              <div key={v.titulo} className="diferencial">
                <div className="diferencial-icone">
                  <Icone nome={v.icone} tamanho={28} />
                </div>
                <h3>{v.titulo}</h3>
                <p>{v.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="secao" id="planos">
        <div className="container">
          <div className="cabeca-centro">
            <span className="sobretitulo">Planos</span>
            <h2 className="titulo-secao">
              Um preço justo, <span className="destaque">sem surpresas</span>
            </h2>
          </div>
          <div className="grade grade-4">
            {PLANOS.map((p) => (
              <div key={p.nome} className={`cartao plano ${p.destaque ? 'plano-destaque' : ''}`}>
                <div className="linha-entre">
                  <h3 style={{ fontSize: '1.125rem' }}>{p.nome}</h3>
                  {p.destaque ? <span className="selo selo-sm">Mais escolhido</span> : null}
                </div>
                <div>
                  <div className="plano-preco">{p.preco}</div>
                  <div className="texto-suave" style={{ fontSize: '0.875rem' }}>
                    equivale a {p.mes}
                  </div>
                </div>
                <ul>
                  <li>
                    <Icone nome="check" tamanho={16} /> Pedidos ilimitados
                  </li>
                  <li>
                    <Icone nome="check" tamanho={16} /> Conversa com clientes
                  </li>
                  <li>
                    <Icone nome="check" tamanho={16} /> Perfil público verificado
                  </li>
                  <li>
                    <Icone nome="check" tamanho={16} /> Pix ou cartão
                  </li>
                </ul>
                <Link href="/profissional/cadastro" className={`btn btn-sm ${p.destaque ? 'btn-primary' : 'btn-secondary'}`}>
                  Começar
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="secao chamada">
        <div className="aurora-bg" />
        <div className="chamada-conteudo">
          <h2>
            Pronto para <span className="destaque">receber pedidos?</span>
          </h2>
          <p className="chamada-texto">O cadastro leva 3 minutos. A análise do documento sai em até 2 dias úteis.</p>
          <div className="linha-botoes">
            <Link href="/profissional/cadastro" className="btn btn-primary">
              Criar conta grátis <Icone nome="seta" tamanho={18} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
