// App FastPro minimo: entrar e receber notificacoes. O restante do produto abre no site.
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View, useColorScheme } from 'react-native';
import { colors } from '../../packages/tokens/src/tokens';
import { SITE, chamarApi, papelDaSessao, type Papel } from './src/api';
import { Entrar } from './src/Entrar';
import { abrirAoTocar, desligarPush, ligarPush, type SituacaoPush } from './src/push';
import { Botao, Tema } from './src/ui';

const TEXTO_PUSH: Record<SituacaoPush, string> = {
  ligado: 'As notificações estão ativas neste aparelho.',
  bloqueado: 'As notificações estão bloqueadas. Libere nas configurações do aparelho.',
  emulador: 'Notificações só funcionam em um aparelho de verdade.',
  sem_projeto: 'O app ainda não está configurado para notificações.',
  falha: 'Não foi possível ativar as notificações agora.',
};

type Estado = { readonly tela: 'carregando' } | { readonly tela: 'erro' } | { readonly tela: 'entrar' } | { readonly tela: 'inicio'; readonly papel: Papel };

export default function App() {
  const c = colors[useColorScheme() === 'dark' ? 'dark' : 'light'];
  const [estado, setEstado] = useState<Estado>({ tela: 'carregando' });
  const [push, setPush] = useState<SituacaoPush | null>(null);

  const consultar = useCallback(async () => {
    setEstado({ tela: 'carregando' });
    const papel = SITE ? await papelDaSessao() : 'erro';
    if (papel === 'erro') setEstado({ tela: 'erro' });
    else setEstado(papel === null ? { tela: 'entrar' } : { tela: 'inicio', papel });
  }, []);

  useEffect(() => {
    void consultar();
    return abrirAoTocar();
  }, [consultar]);

  const logado = estado.tela === 'inicio';
  useEffect(() => {
    if (logado) void ligarPush().then(setPush);
  }, [logado]);

  async function sair() {
    await desligarPush();
    await chamarApi('/v1/auth/logout', {});
    setPush(null);
    setEstado({ tela: 'entrar' });
  }

  return (
    <Tema.Provider value={c}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: c.primary, fontSize: 32, fontWeight: '700' }}>FastPro</Text>
          {estado.tela === 'carregando' ? <ActivityIndicator color={c.primary} /> : null}
          {estado.tela === 'erro' ? (
            <View style={{ gap: 16 }}>
              <Text style={{ color: c.errorText }}>Não foi possível conectar. Confira a internet e tente de novo.</Text>
              <Botao rotulo="Tentar de novo" aoTocar={() => void consultar()} />
            </View>
          ) : null}
          {estado.tela === 'entrar' ? <Entrar aoEntrar={(papel) => setEstado({ tela: 'inicio', papel })} /> : null}
          {estado.tela === 'inicio' ? (
            <View style={{ gap: 16 }}>
              <Text style={{ color: c.textPrimary, fontSize: 16 }}>{push === null ? 'Ativando as notificações…' : TEXTO_PUSH[push]}</Text>
              {push === 'bloqueado' ? <Botao rotulo="Abrir configurações" aoTocar={() => void Linking.openSettings()} /> : null}
              {push === 'falha' || push === 'bloqueado' ? (
                <Botao secundario rotulo="Tentar de novo" aoTocar={() => void ligarPush().then(setPush)} />
              ) : null}
              <Botao
                rotulo={estado.papel === 'cliente' ? 'Ver meus pedidos no site' : 'Abrir meu painel no site'}
                aoTocar={() => void Linking.openURL(`${SITE}${estado.papel === 'cliente' ? '/painel' : '/profissional/painel'}`)}
              />
              <Botao secundario rotulo="Sair" aoTocar={() => void sair()} />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Tema.Provider>
  );
}
