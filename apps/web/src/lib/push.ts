// Web Push no navegador: registra o service worker, inscreve com a chave publica do servidor e guarda o aparelho na
// conta da sessao. No iPhone e iPad so existe depois de "Adicionar a Tela de Inicio" (iOS 16.4 ou mais novo).
import { chamarApi, ok } from './api';

const SW = '/push-sw.js';

export type SituacaoPush = 'indisponivel' | 'instalar_ios' | 'bloqueado' | 'desligado' | 'ligado';

function suportado(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function iosForaDoApp(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia('(display-mode: standalone)').matches;
}

export function bytesDaChave(base64url: string): Uint8Array<ArrayBuffer> {
  const texto = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i += 1) bytes[i] = texto.charCodeAt(i);
  return bytes;
}

async function chaveDoServidor(): Promise<string | null> {
  const r = await chamarApi<{ webPublicKey?: string | null }>('/v1/push/config');
  return r.status === 200 && typeof r.corpo?.webPublicKey === 'string' ? r.corpo.webPublicKey : null;
}

async function inscricaoAtual(): Promise<PushSubscription | null> {
  const registro = await navigator.serviceWorker.getRegistration('/');
  return (await registro?.pushManager.getSubscription()) ?? null;
}

async function guardar(inscricao: PushSubscription): Promise<boolean> {
  const dados = inscricao.toJSON();
  const r = await chamarApi('/v1/push/devices', { body: { platform: 'web', token: dados.endpoint, keys: dados.keys } });
  return ok(r.status);
}

export async function situacaoPush(): Promise<SituacaoPush> {
  if (!suportado()) return iosForaDoApp() ? 'instalar_ios' : 'indisponivel';
  if ((await chaveDoServidor()) === null) return 'indisponivel';
  if (Notification.permission === 'denied') return 'bloqueado';
  return Notification.permission === 'granted' && (await inscricaoAtual()) !== null ? 'ligado' : 'desligado';
}

/** Chamada a partir de um clique (os navegadores exigem o gesto para pedir a permissao). */
export async function ligarPush(): Promise<SituacaoPush | 'falha'> {
  if (!suportado()) return 'indisponivel';
  const chave = await chaveDoServidor();
  if (chave === null) return 'indisponivel';
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'bloqueado' : 'desligado';
  try {
    await navigator.serviceWorker.register(SW, { scope: '/' });
    const registro = await navigator.serviceWorker.ready;
    const inscricao =
      (await registro.pushManager.getSubscription()) ??
      (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesDaChave(chave) }));
    return (await guardar(inscricao)) ? 'ligado' : 'falha';
  } catch {
    return 'falha';
  }
}

/** Remove o aparelho da conta e cancela a inscricao. Usada no botao de desativar e antes de sair. Nunca lanca. */
export async function desligarPush(): Promise<void> {
  if (!suportado()) return;
  try {
    const inscricao = await inscricaoAtual();
    if (inscricao === null) return;
    await chamarApi('/v1/push/devices/remove', { body: { token: inscricao.endpoint } });
    await inscricao.unsubscribe();
  } catch {
    /* a sessao encerra mesmo assim; o servidor descarta a inscricao vencida no proximo envio */
  }
}

/** Reassocia a inscricao existente a conta que entrou. Nunca pede permissao. */
export async function sincronizarPush(): Promise<void> {
  if (!suportado() || Notification.permission !== 'granted') return;
  try {
    const inscricao = await inscricaoAtual();
    if (inscricao !== null) await guardar(inscricao);
  } catch {
    /* tenta de novo na proxima entrada */
  }
}
