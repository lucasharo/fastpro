// Arquivo de verificacao ja enviado: miniatura da foto (ou o PDF), que abre em uma nova aba.
import { Icone } from '@/components/Icone';

export function ArquivoEnviado({ id, pdf, rotulo }: { readonly id: string; readonly pdf: boolean; readonly rotulo: string }) {
  const url = `/api/v1/professional/documents/${encodeURIComponent(id)}/file`;
  return (
    <a className="arquivo-enviado" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${rotulo} em uma nova aba`}>
      {pdf ? <Icone nome="documento" tamanho={28} /> : <img src={url} alt="" loading="lazy" />}
      <span>{pdf ? 'Abrir PDF' : 'Ver foto'}</span>
    </a>
  );
}
