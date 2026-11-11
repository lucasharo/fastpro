"""S-03: verificacao local de x-signature do Mercado Pago com payload SIMULADO.
Segredo e dados sinteticos; nenhum valor real. Formato conforme documentacao oficial
(manifesto id:<data.id>;request-id:<x-request-id>;ts:<ts>; HMAC-SHA256 hex). Entrega real: NAO VERIFICADO."""
import hmac, hashlib, time

def verify(secret, x_signature, x_request_id, data_id):
    parts = dict(p.split('=', 1) for p in x_signature.split(',') if '=' in p)
    ts, v1 = parts.get('ts'), parts.get('v1')
    if not ts or not v1:
        return False, 'ausente'
    did = data_id.lower() if data_id.isalnum() else data_id
    manifest = f'id:{did};request-id:{x_request_id};ts:{ts};'
    calc = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(calc, v1), ts

def sign(secret, request_id, data_id, ts):
    m = f'id:{data_id.lower()};request-id:{request_id};ts:{ts};'
    return f'ts={ts},v1=' + hmac.new(secret.encode(), m.encode(), hashlib.sha256).hexdigest()

if __name__ == '__main__':
    S = 'segredo-sintetico-s03'
    ts = str(int(time.time() * 1000))
    sig = sign(S, 'req-sint-1', 'ABC123', ts)
    print('valida            ->', verify(S, sig, 'req-sint-1', 'ABC123')[0])
    print('segredo errado    ->', verify('outro', sig, 'req-sint-1', 'ABC123')[0])
    print('data.id alterado  ->', verify(S, sig, 'req-sint-1', 'ZZZ999')[0])
    print('request-id alter. ->', verify(S, sig, 'req-sint-2', 'ABC123')[0])
    print('cabecalho ausente ->', verify(S, '', 'req-sint-1', 'ABC123')[0])
    # idempotencia: mesmo evento duas vezes -> um registro
    seen, efeitos = set(), 0
    for _ in range(2):
        if ('pay', 'ABC123', 'approved') not in seen:
            seen.add(('pay', 'ABC123', 'approved')); efeitos += 1
    print('duplicado: registros', len(seen), 'efeitos', efeitos)
    # fora de ordem: estado nao regride (ranking por ts/versao do recurso)
    ordem = {'pending': 0, 'approved': 1, 'refunded': 2}
    estado = 'pending'
    for ev in ['approved', 'pending']:
        if ordem[ev] > ordem[estado]: estado = ev
    print('fora de ordem: estado final', estado)
