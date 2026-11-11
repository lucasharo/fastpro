// H-093 | Renderizador minimo. Os textos finais entram com H-095..H-099 sem mudar os adaptadores.
// Nao usa params nem templateKey: nenhum dado do pedido sai pelo corpo nesta etapa.
export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
}

export interface EmailRenderer {
  render(templateKey: string, params: Readonly<Record<string, unknown>>): RenderedEmail;
}

export function createMinimalRenderer(): EmailRenderer {
  return {
    render: () => ({
      subject: 'Aviso do FastPro',
      text: 'Voce tem um novo aviso do FastPro. Entre na sua conta para ver os detalhes.',
    }),
  };
}
