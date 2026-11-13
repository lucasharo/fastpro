// E3 (Issue 141) | Entrada do bundle publico apps/web/public/fotos-envio.js (docs/factory/104-DESENHO-MIDIA-COMPOSICAO.md,
// §4.2). Expoe globalThis.FastProFotosEnvio para fotos.js. Sem efeito colateral na carga alem de atribuir o global.
// A pagina fornece emitir e enviar (POST com cookie na mesma origem e PUT sem cookie); aqui so ha reducao e a ordem
// reduz -> emite (tamanho reduzido) -> envia (reduzir-foto.ts, decisao 192: o servidor decide por conteudo).
import { enviarFoto, type EnvioFoto } from './reduzir-foto.js';
import { criarPortasNavegador } from './portas-navegador.js';

export interface GanchosEnvio {
  emitir: EnvioFoto['emitir'];
  enviar: EnvioFoto['enviar'];
}

export interface FotosEnvioNavegador {
  /** Verdadeiro quando o bundle carregou. Sem reducao (navegador antigo), o original segue e o servidor reduz. */
  disponivel(): boolean;
  /** Reduz, emite e envia uma foto. Resolve sempre (com { ok: true } ou com { code }); nunca rejeita por reducao. */
  enviar(arquivo: Blob, tipoDeclarado: string, ganchos: GanchosEnvio): ReturnType<typeof enviarFoto>;
}

const envio: FotosEnvioNavegador = {
  disponivel(): boolean {
    return typeof Blob === 'function';
  },
  enviar(arquivo, tipoDeclarado, ganchos) {
    return enviarFoto({
      arquivo,
      tipoDeclarado,
      portas: criarPortasNavegador(),
      emitir: ganchos.emitir,
      enviar: ganchos.enviar,
    });
  },
};

(globalThis as unknown as { FastProFotosEnvio: FotosEnvioNavegador }).FastProFotosEnvio = envio;
