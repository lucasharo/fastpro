// H-115 (Issue 124) | Tipos da matriz de acesso (docs/factory/164-DESENHO-H115.md, §3.2).
// Dados puros: nenhum import de dominio ou de banco. Paridade entre camadas e feita por esperado unico.

export type PrincipalType = 'anonymous' | 'customer' | 'professional' | 'admin' | 'system';
export type Aal = 'aal0' | 'aal1' | 'aal2';

/** Camada que executa o caso: contrato HTTP da API, sonda de banco ou varredura de catalogo. */
export type AccessLayer = 'api' | 'db' | 'catalog';

export type AccessAction = 'read' | 'list' | 'create' | 'update' | 'delete' | 'execute' | 'reveal' | 'write';

export type HttpExpectation =
  | {
      readonly status: 200 | 201 | 204;
      readonly mustHaveKeys?: readonly string[];
      readonly mustNotHaveKeys: readonly string[];
      readonly emptyItems?: boolean;
    }
  | { readonly status: 401 | 403 | 404; readonly code?: string }; // F6: 404 uniforme da guarda admin nao tem codigo

export type DbExpectation =
  | { readonly kind: 'rows'; readonly minRows: number; readonly columns?: readonly string[]; readonly forbiddenColumns?: readonly string[] }
  | { readonly kind: 'no_rows' }
  | { readonly kind: 'denied'; readonly sqlstate: '42501' }
  | { readonly kind: 'exception'; readonly sqlstate: string };

export type DbProbe =
  | { readonly kind: 'table_select'; readonly relation: string; readonly where?: string }
  | { readonly kind: 'table_write'; readonly relation: string; readonly verb: 'insert' | 'update' | 'delete' }
  | { readonly kind: 'function_call'; readonly fn: string; readonly args: readonly string[] }
  | { readonly kind: 'none' };

export interface AccessCase {
  /** Estavel, usado nos titulos dos testes: 'CP-01'... */
  readonly id: string;
  /** Chave de ACCESS_RESOURCES. */
  readonly resource: string;
  readonly action: AccessAction;
  /** Chave de ACCESS_PRINCIPALS. */
  readonly principal: string;
  /** Texto curto, em linguagem tecnica, para o relatorio. */
  readonly condition: string;
  /** 'CA-H115-08'... (existem em CA-H115-01..20). */
  readonly criteria: readonly string[];
  /** Invariantes do refino (ex.: 'I-16'). */
  readonly invariants: readonly string[];
  /** Camadas que executam o caso. [AJUSTE] campo explicito: caso de catalogo nao tem API nem sonda por rota. */
  readonly layers: readonly AccessLayer[];
  readonly route?: { readonly method: string; readonly path: string };
  readonly http?: HttpExpectation;
  readonly db?: DbExpectation;
  readonly probe?: DbProbe;
  readonly status: 'active' | 'deferred';
  /** Obrigatorio em deferred: relacao que, ao existir, ativa o caso (ex.: 'app.acceptance'). */
  readonly requiresRelation?: string;
  /** Obrigatorio em deferred: Issues que criam a relacao (ex.: '#71'). */
  readonly deferredBy?: readonly string[];
}

export interface PrincipalContext {
  readonly principalType: PrincipalType;
  readonly aal: Aal;
  /** Espelha app.permissions; so para admin. */
  readonly permissions?: readonly string[];
}

export interface AccessPrincipal extends PrincipalContext {
  readonly id: string;
  readonly description: string;
}

export interface AccessResource {
  readonly key: string;
  /** Relacao real no banco (schema.tabela ou funcao de fachada). [AJUSTE] nomes conferidos no DEV (166-INVENTARIO-H115). */
  readonly relation: string;
  readonly routes: readonly string[];
  /** Sensibilidade: C0 publico a C4 documento de identidade. */
  readonly sensitivity: 'C0' | 'C1' | 'C2' | 'C3' | 'C4';
}
