// Pagina inicial no formato do template de referencia (hero com aurora e busca em vidro, servicos populares,
// diferenciais, depoimentos, chamada final). Numeros, fotos e depoimentos sao MOCK de vitrine (lib/mock.ts).
import Image from 'next/image';
import Link from 'next/link';
import { Icone, type NomeIcone } from '@/components/Icone';
import { BuscaHero } from '@/components/inicio/BuscaHero';
import { DEPOIMENTOS, NOTA_MEDIA, NUMEROS_HERO, SERVICOS_POPULARES, urlFoto } from '@/lib/mock';

const DIFERENCIAIS: readonly { icone: NomeIcone; titulo: string; texto: string }[] = [
  { icone: 'escudo', titulo: 'Profissionais verificados', texto: 'Documento conferido pela nossa equipe antes de o profissional receber pedidos.' },
  { icone: 'carteira', titulo: 'Grátis para quem pede', texto: 'Você pede e combina o serviço sem pagar nada e sem criar conta.' },
  { icone: 'conversa', titulo: 'Conversa direta', texto: 'Tire dúvidas e combine valores direto com o profissional, pelo WhatsApp.' },
  { icone: 'relogio', titulo: 'Resposta rápida', texto: 'Os profissionais da sua região recebem o pedido na hora em que você publica.' },
];

const PASSOS: readonly { icone: NomeIcone; titulo: string; texto: string }[] = [
  { icone: 'documento', titulo: '1. Descreva o serviço', texto: 'Diga o que precisa, onde e quando. Fotos ajudam.' },
  { icone: 'maleta', titulo: '2. Receba interessados', texto: 'Profissionais verificados da região aceitam seu pedido.' },
  { icone: 'conversa', titulo: '3. Converse', texto: 'Quem aceitar chama você no WhatsApp. Veja o perfil e as avaliações.' },
  { icone: 'check', titulo: '4. Escolha e avalie', texto: 'Escolha um profissional e avalie depois do serviço.' },
];

export default function Inicio() {
  return (
    <>
      <section className="hero">
        <div className="aurora-bg" />
        <div className="hero-conteudo">
          <div>
            <span className="selo">
              <Icone nome="escudo" tamanho={16} />
              Profissionais verificados perto de você
            </span>
            <h1>
              Encontre o profissional <span className="destaque">certo para o seu serviço</span>
            </h1>
            <p className="hero-texto">
              Peça de graça, receba profissionais verificados da sua região e converse com eles pelo WhatsApp.
            </p>
            <BuscaHero />
            <div className="numeros">
              {NUMEROS_HERO.map((n) => (
                <div key={n.rotulo}>
                  <div className="numero-valor">{n.valor}</div>
                  <div className="numero-rotulo">{n.rotulo}</div>
                </div>
              ))}
              <div>
                <div className="numero-valor">
                  <span className="estrela">★</span>
                  {NOTA_MEDIA}
                </div>
                <div className="numero-rotulo">Avaliação média</div>
              </div>
            </div>
          </div>
          <div className="hero-galeria">
            <div className="galeria-grade">
              <div className="galeria-coluna">
                <div className="foto foto-43">
                  <Image src={urlFoto('eletricista', 400, 300)} alt="Eletricista instalando um quadro de luz" fill sizes="25vw" priority />
                </div>
                <div className="foto foto-11">
                  <Image src={urlFoto('pintor', 400, 400)} alt="Rolo de pintura em parede" fill sizes="25vw" priority />
                </div>
              </div>
              <div className="galeria-coluna galeria-coluna-baixa">
                <div className="foto foto-11">
                  <Image src={urlFoto('diarista', 400, 400)} alt="Diarista limpando uma janela" fill sizes="25vw" priority />
                </div>
                <div className="foto foto-43">
                  <Image src={urlFoto('montador', 400, 300)} alt="Furadeira sobre madeira" fill sizes="25vw" priority />
                </div>
              </div>
            </div>
            <div className="flutuante glass-card">
              <div className="circulo-icone">
                <Icone nome="maleta" />
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>3 profissionais aceitaram</div>
                <div className="texto-suave" style={{ fontSize: '0.875rem' }}>
                  Eletricista, Pinheiros
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="servicos" className="secao secao-clara">
        <div className="container">
          <div className="cabeca-secao">
            <div>
              <span className="sobretitulo">Explore</span>
              <h2 className="titulo-secao">
                Serviços <span className="destaque">mais pedidos</span>
              </h2>
            </div>
            <Link href="/pedido" className="btn btn-secondary btn-sm">
              Ver todos os serviços
            </Link>
          </div>
          <div className="grade grade-4">
            {SERVICOS_POPULARES.map((s) => (
              <Link key={s.nome} href={`/pedido?q=${encodeURIComponent(s.busca)}`} className="cartao cartao-elevado servico-card">
                <div className="servico-imagem">
                  <Image src={urlFoto(s.foto)} alt="" fill sizes="(min-width: 1024px) 25vw, 50vw" />
                  <span className="nota-flutuante">
                    <Icone nome="estrela" tamanho={12} preenchido className="estrela" />
                    {s.nota}
                  </span>
                </div>
                <div className="servico-corpo">
                  <h3>{s.nome}</h3>
                  <p>{s.descricao}</p>
                  <div className="servico-rodape">
                    <div>
                      <span className="preco">{s.profissionais.toLocaleString('pt-BR')}</span>
                      <span className="preco-sufixo"> profissionais</span>
                    </div>
                    <span className="btn-icone" aria-hidden="true">
                      <Icone nome="seta" tamanho={18} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="secao">
        <div className="container">
          <div className="cabeca-centro">
            <span className="sobretitulo">Por que o FastPro</span>
            <h2 className="titulo-secao">
              Contrate com <span className="destaque">confiança</span>
            </h2>
          </div>
          <div className="grade grade-4">
            {DIFERENCIAIS.map((d) => (
              <div key={d.titulo} className="diferencial">
                <div className="diferencial-icone">
                  <Icone nome={d.icone} tamanho={28} />
                </div>
                <h3>{d.titulo}</h3>
                <p>{d.texto}</p>
              </div>
            ))}
          </div>
          <hr className="divisor" style={{ margin: '4rem 0' }} />
          <div className="cabeca-centro">
            <span className="sobretitulo">Como funciona</span>
            <h2 className="titulo-secao">
              Do pedido ao serviço <span className="destaque">em 4 passos</span>
            </h2>
          </div>
          <div className="grade grade-4">
            {PASSOS.map((p) => (
              <div key={p.titulo} className="cartao-plano">
                <div className="circulo-icone" style={{ marginBottom: '1rem' }}>
                  <Icone nome={p.icone} />
                </div>
                <h3 style={{ fontSize: '1.0625rem', marginBottom: '0.5rem' }}>{p.titulo}</h3>
                <p className="texto-suave" style={{ fontSize: '0.875rem' }}>
                  {p.texto}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="secao secao-clara">
        <div className="container">
          <div className="cabeca-centro">
            <span className="sobretitulo">Depoimentos</span>
            <h2 className="titulo-secao">
              O que dizem <span className="destaque">clientes e profissionais</span>
            </h2>
          </div>
          <div className="grade grade-3">
            {DEPOIMENTOS.map((d) => (
              <figure key={d.nome} className="depoimento" style={{ margin: 0 }}>
                <div className="estrelas" aria-label="5 de 5 estrelas">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Icone key={i} nome="estrela" tamanho={18} preenchido />
                  ))}
                </div>
                <blockquote className="depoimento-texto" style={{ margin: '0 0 1.5rem' }}>
                  “{d.texto}”
                </blockquote>
                <span className="selo selo-sm" style={{ marginBottom: '1rem' }}>
                  <Icone nome="ferramenta" tamanho={12} />
                  {d.servico}
                </span>
                <figcaption className="autor">
                  <Image src={d.foto} alt="" width={40} height={40} className="avatar" />
                  <div>
                    <p className="autor-nome">{d.nome}</p>
                    <p className="autor-local">{d.cidade}</p>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="secao chamada">
        <div className="aurora-bg" />
        <div className="chamada-conteudo">
          <h2>
            Pronto para resolver <span className="destaque">aquele serviço?</span>
          </h2>
          <p className="chamada-texto">
            Publique seu pedido em menos de dois minutos. Profissionais da sua região recebem na hora.
          </p>
          <div className="linha-botoes">
            <Link href="/pedido" className="btn btn-primary">
              Pedir orçamento grátis
              <Icone nome="seta" tamanho={18} />
            </Link>
            <Link href="/profissional/cadastro" className="btn btn-secondary">
              Sou profissional
            </Link>
          </div>
          <div className="garantias">
            <span>
              <Icone nome="escudo" tamanho={18} /> Profissionais verificados
            </span>
            <span>
              <Icone nome="carteira" tamanho={18} /> Grátis para quem pede
            </span>
            <span>
              <Icone nome="coracao" tamanho={18} /> 80 mil+ pedidos atendidos
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
