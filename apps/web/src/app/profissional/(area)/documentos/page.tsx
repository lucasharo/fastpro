// Os documentos ficam dentro da Gestao profissional; o endereco antigo leva para la.
import { redirect } from 'next/navigation';

export default function Documentos() {
  redirect('/profissional/gestao');
}
