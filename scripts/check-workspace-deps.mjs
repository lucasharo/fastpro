// Placeholder (H-001) da regra de dependencia do plano tecnico 19 §1.1.
// Regras verificadas por package.json (sem analisar imports de codigo; isso fica para H-004):
//  - packages/* nunca dependem de apps/*;
//  - @fastpro/domain nao depende de nenhum pacote @fastpro/*;
//  - @fastpro/ui so pode depender de @fastpro/tokens (e de @fastpro/config em dev).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const workspaces = [];
for (const group of ['apps', 'packages']) {
  for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
    const file = join(root, group, entry.name, 'package.json');
    if (entry.isDirectory() && existsSync(file)) {
      workspaces.push({ group, ...JSON.parse(readFileSync(file, 'utf8')) });
    }
  }
}

const apps = new Set(workspaces.filter((w) => w.group === 'apps').map((w) => w.name));
const errors = [];
for (const w of workspaces) {
  const runtime = Object.keys(w.dependencies ?? {}).filter((d) => d.startsWith('@fastpro/'));
  const all = [
    ...runtime,
    ...Object.keys(w.devDependencies ?? {}).filter((d) => d.startsWith('@fastpro/')),
  ];
  if (w.group === 'packages') {
    for (const d of all) if (apps.has(d)) errors.push(`${w.name} (package) depende de app ${d}`);
  }
  if (w.name === '@fastpro/domain' && runtime.length > 0) {
    errors.push(`@fastpro/domain nao pode depender de ${runtime.join(', ')}`);
  }
  if (w.name === '@fastpro/ui' && runtime.some((d) => d !== '@fastpro/tokens')) {
    errors.push('@fastpro/ui so pode depender de @fastpro/tokens');
  }
}

if (errors.length > 0) {
  console.error('Violacoes de dependencia:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log(`check:deps ok (${workspaces.length} workspaces verificados)`);
