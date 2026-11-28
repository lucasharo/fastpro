// Push no Android e no iOS: permissao, token do Expo e registro do aparelho na conta da sessao.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { SITE, chamarApi, ok } from './api';

export type SituacaoPush = 'ligado' | 'bloqueado' | 'emulador' | 'sem_projeto' | 'falha';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let tokenAtual: string | null = null;

export async function ligarPush(): Promise<SituacaoPush> {
  try {
    if (Platform.OS === 'android') {
      // Obrigatorio antes de pedir a permissao no Android 13 ou mais novo.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    if (!Device.isDevice) return 'emulador';
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return 'bloqueado';
    const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
    if (!projectId) return 'sem_projeto';
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    const r = await chamarApi('/v1/push/devices', { platform: Platform.OS === 'ios' ? 'ios' : 'android', token: data });
    if (!ok(r.status)) return 'falha';
    tokenAtual = data;
    return 'ligado';
  } catch {
    return 'falha';
  }
}

/** Chamada antes de sair: o aparelho deixa de receber os avisos desta conta. */
export async function desligarPush(): Promise<void> {
  if (tokenAtual === null) return;
  await chamarApi('/v1/push/devices/remove', { token: tokenAtual });
  tokenAtual = null;
}

/** Abre no site a tela do aviso tocado. So aceita caminho da propria origem. */
export function abrirAoTocar(): () => void {
  const abrir = (r: Notifications.NotificationResponse | null) => {
    const caminho = r?.notification.request.content.data?.caminho;
    if (typeof caminho === 'string' && /^\/(?!\/)/.test(caminho)) void Linking.openURL(`${SITE}${caminho}`);
  };
  void Notifications.getLastNotificationResponseAsync().then(abrir);
  const inscricao = Notifications.addNotificationResponseReceivedListener(abrir);
  return () => inscricao.remove();
}
