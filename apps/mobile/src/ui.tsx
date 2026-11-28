// Componentes minimos do app, so com os tokens do FastPro (claro e escuro).
import { createContext, useContext } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, type ThemeColors } from '../../../packages/tokens/src/tokens';

export const Tema = createContext<ThemeColors>(colors.light);
export const useTema = (): ThemeColors => useContext(Tema);

export function Botao({
  rotulo,
  aoTocar,
  secundario = false,
  desabilitado = false,
}: {
  readonly rotulo: string;
  readonly aoTocar: () => void;
  readonly secundario?: boolean;
  readonly desabilitado?: boolean;
}) {
  const c = useTema();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={aoTocar}
      disabled={desabilitado}
      style={[
        estilos.botao,
        { backgroundColor: secundario ? c.buttonSecondaryBackground : c.buttonPrimaryBackground, opacity: desabilitado ? 0.6 : 1 },
      ]}
    >
      <Text style={[estilos.botaoTexto, { color: secundario ? c.buttonSecondaryText : c.buttonPrimaryText }]}>{rotulo}</Text>
    </Pressable>
  );
}

export function Campo({ rotulo, erro, ...entrada }: TextInputProps & { readonly rotulo: string; readonly erro?: string }) {
  const c = useTema();
  return (
    <View style={estilos.campo}>
      <Text style={[estilos.rotulo, { color: c.textPrimary }]}>{rotulo}</Text>
      <TextInput
        accessibilityLabel={rotulo}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={c.textSecondary}
        style={[estilos.entrada, { backgroundColor: c.field, color: c.textPrimary, borderColor: erro ? c.errorText : c.border }]}
        {...entrada}
      />
      {erro ? (
        <Text accessibilityRole="alert" style={{ color: c.errorText }}>
          {erro}
        </Text>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  botao: { width: '100%', minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  botaoTexto: { fontSize: 16, fontWeight: '700' },
  campo: { gap: 6 },
  rotulo: { fontSize: 14, fontWeight: '500' },
  entrada: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
});
