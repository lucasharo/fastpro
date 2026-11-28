// Entrada: cliente por codigo no e-mail; profissional por e-mail e senha. Mesmas rotas da web.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { chamarApi, ok, type Papel } from './api';
import { Botao, Campo, useTema } from './ui';

const OBRIGATORIO = 'Campo obrigatório.';
const INDISPONIVEL = 'Não foi possível concluir agora. Tente de novo em instantes.';
const LIMITE = 'Muitas tentativas. Aguarde um instante e tente de novo.';

export function Entrar({ aoEntrar }: { readonly aoEntrar: (papel: Papel) => void }) {
  const c = useTema();
  const [papel, setPapel] = useState<Papel>('cliente');
  const [email, setEmail] = useState('');
  const [segredo, setSegredo] = useState('');
  const [codigoEnviado, setCodigoEnviado] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const pedeSegredo = papel === 'profissional' || codigoEnviado;
  const erroEmail = !tentou ? '' : !email.trim() ? OBRIGATORIO : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? '' : 'Digite um e-mail válido.';
  const erroSegredo =
    !tentou || !pedeSegredo ? '' : !segredo ? OBRIGATORIO : papel === 'cliente' && !/^\d{6}$/.test(segredo) ? 'Digite os 6 números do código.' : '';

  function trocar(novo: Papel) {
    setPapel(novo);
    setSegredo('');
    setCodigoEnviado(false);
    setTentou(false);
    setErro('');
  }

  async function pedirCodigo() {
    const r = await chamarApi('/v1/auth/challenges', { email: email.trim(), purpose: 'login' });
    if (!ok(r.status)) return setErro(r.status === 429 ? LIMITE : INDISPONIVEL);
    setTentou(false);
    setCodigoEnviado(true);
  }

  async function validarCodigo() {
    const v = await chamarApi('/v1/auth/challenges/verify', { email: email.trim(), code: segredo, purpose: 'login' });
    if (!ok(v.status)) return setErro(v.status === 429 ? LIMITE : v.status === 422 ? 'Código incorreto ou vencido.' : INDISPONIVEL);
    const s = await chamarApi('/v1/auth/session', {});
    if (s.status !== 200) return setErro(INDISPONIVEL);
    aoEntrar('cliente');
  }

  async function entrarProfissional() {
    const r = await chamarApi<{ email_verified?: boolean; access_level?: string }>('/v1/auth/professional/login', {
      email: email.trim(),
      password: segredo,
    });
    if (r.status === 200 && r.corpo?.email_verified === true && r.corpo.access_level === 'full') return aoEntrar('profissional');
    if (r.status === 200) return setErro('Confirme o seu e-mail pelo site antes de entrar no app.');
    setErro(r.status === 401 ? 'E-mail ou senha incorretos.' : r.status === 429 ? LIMITE : INDISPONIVEL);
  }

  async function enviar() {
    setTentou(true);
    setErro('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    if (pedeSegredo && (!segredo || (papel === 'cliente' && !/^\d{6}$/.test(segredo)))) return;
    setOcupado(true);
    if (papel === 'profissional') await entrarProfissional();
    else if (codigoEnviado) await validarCodigo();
    else await pedirCodigo();
    setOcupado(false);
  }

  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: c.textPrimary, fontSize: 22, fontWeight: '700' }}>
        {papel === 'cliente' ? 'Entrar como cliente' : 'Entrar como profissional'}
      </Text>
      <Campo rotulo="E-mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" erro={erroEmail} editable={!codigoEnviado} />
      {pedeSegredo ? (
        <Campo
          rotulo={papel === 'cliente' ? 'Código de 6 dígitos' : 'Senha'}
          value={segredo}
          onChangeText={setSegredo}
          secureTextEntry={papel === 'profissional'}
          keyboardType={papel === 'cliente' ? 'number-pad' : 'default'}
          erro={erroSegredo}
        />
      ) : null}
      {erro ? (
        <Text accessibilityRole="alert" style={{ color: c.errorText }}>
          {erro}
        </Text>
      ) : null}
      <Botao
        rotulo={ocupado ? 'Aguarde…' : papel === 'cliente' && !codigoEnviado ? 'Receber código' : 'Entrar'}
        aoTocar={() => void enviar()}
        desabilitado={ocupado}
      />
      {codigoEnviado ? <Botao secundario rotulo="Trocar e-mail" aoTocar={() => trocar('cliente')} /> : null}
      <Botao
        secundario
        rotulo={papel === 'cliente' ? 'Sou profissional' : 'Sou cliente'}
        aoTocar={() => trocar(papel === 'cliente' ? 'profissional' : 'cliente')}
        desabilitado={ocupado}
      />
    </View>
  );
}
