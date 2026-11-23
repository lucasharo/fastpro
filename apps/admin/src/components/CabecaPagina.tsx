// Cabecalho de pagina no estilo da web: sobretitulo, titulo (h1) e descricao opcional.
export function CabecaPagina({
  sobretitulo,
  titulo,
  descricao,
}: {
  readonly sobretitulo?: string;
  readonly titulo: string;
  readonly descricao?: string;
}) {
  return (
    <header className="pagina-cabeca">
      {sobretitulo ? <p className="sobretitulo">{sobretitulo}</p> : null}
      <h1>{titulo}</h1>
      {descricao ? <p>{descricao}</p> : null}
    </header>
  );
}
