// #155 (desenho 178, AD-155-12) | Entrada do bundle da situacao do profissional. Expoe construirTela (packages/domain)
// ao navegador, sem texto proprio: os textos da tela vem do dominio (uma so fonte). Gerado por scripts/build-situacao.mjs.
import { construirTela, type EntradaTela } from '@fastpro/domain';

type EscopoSituacao = { FastProSituacao?: { construirTela: (entrada: EntradaTela) => unknown } };

(globalThis as unknown as EscopoSituacao).FastProSituacao = { construirTela };
