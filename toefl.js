// API da Plataforma TOEFL · English With Denise
// Rotas (todas em /api/toefl?acao=...):
//   config    → devolve o Google Client ID para a página
//   login     → confere o login Google, cria/atualiza o aluno no Notion e devolve uma sessão
//   enviar    → grava o resultado de um simulado no Notion (precisa da sessão)
//   historico → devolve os resultados do aluno logado (precisa da sessão)
//   setup     → cria as bases "TOEFL Alunos" e "TOEFL Resultados" no Notion (uma vez só)
//
// Variáveis de ambiente na Vercel:
//   NOTION_TOKEN          token da integração do Notion
//   GOOGLE_CLIENT_ID      Client ID do Google (o mesmo do app, com o domínio novo autorizado)
//   SESSION_SECRET        qualquer frase longa e secreta (assina as sessões dos alunos)
//   SETUP_KEY             senha para rodar o setup
//   NOTION_PARENT_PAGE    página do Notion onde as bases serão criadas (só para o setup)
//   TOEFL_ALUNOS_DB       ID da base de alunos (o setup devolve)
//   TOEFL_RESULTADOS_DB   ID da base de resultados (o setup devolve)
//   ACESSO_RESTRITO       opcional: "1" = aluno novo entra como "Pendente" até você liberar

const crypto = require('crypto');

const NOTION_API = 'https://api.notion.com/v1';
const env = k => (process.env[k] || '').trim();
// Aceita o ID puro, com hífens ou o link inteiro do Notion e devolve só o ID de 32 caracteres.
const idNotion = k => {
  const bruto = env(k).replace(/-/g, '');
  const m = bruto.match(/[0-9a-f]{32}/i);
  if (!m) throw new Error(`Variável ${k} vazia ou inválida na Vercel`);
  return m[0];
};
const nHeaders = () => ({
  Authorization: `Bearer ${env('NOTION_TOKEN') || env('REACT_APP_NOTION_TOKEN')}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
});
async function notion(path, method = 'GET', body) {
  if (!env('NOTION_TOKEN') && !env('REACT_APP_NOTION_TOKEN')) throw new Error('Variável NOTION_TOKEN vazia na Vercel');
  const r = await fetch(NOTION_API + path, { method, headers: nHeaders(), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Notion: ${j.message || r.status}`);
  return j;
}

const NOMES = { reading: 'Reading', listening: 'Listening', writing: 'Writing', speaking: 'Speaking' };
const cut = (s, n = 1990) => String(s ?? '').slice(0, n);
const rich = s => [{ text: { content: cut(s) } }];
const plain = p => (p && (p.title || p.rich_text) || []).map(t => t.plain_text).join('');
const hoje = () => new Date().toISOString();

/* ---------- sessão assinada (HMAC) ---------- */
const b64 = s => Buffer.from(s).toString('base64url');
function assinar(dados) {
  const corpo = b64(JSON.stringify({ ...dados, exp: Date.now() + 30 * 24 * 3600 * 1000 }));
  const sig = crypto.createHmac('sha256', env('SESSION_SECRET')).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}
function lerSessao(token) {
  if (!token || !env('SESSION_SECRET')) return null;
  const [corpo, sig] = String(token).split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', env('SESSION_SECRET')).update(corpo).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  const d = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  return d.exp > Date.now() ? d : null;
}

/* ---------- login Google ---------- */
async function verificarGoogle(credential) {
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw new Error('Login Google inválido');
  const t = await r.json();
  if (t.aud !== env('GOOGLE_CLIENT_ID')) throw new Error('Client ID não confere');
  if (String(t.email_verified) !== 'true') throw new Error('E-mail Google não verificado');
  return { email: t.email.toLowerCase(), nome: t.name || t.email, foto: t.picture || '', googleId: t.sub };
}

async function acharAluno(email) {
  const q = await notion(`/databases/${idNotion('TOEFL_ALUNOS_DB')}/query`, 'POST', { filter: { property: 'E-mail', email: { equals: email } }, page_size: 1 });
  return q.results[0] || null;
}

async function login(body) {
  if (!env('SESSION_SECRET')) throw new Error('Variável SESSION_SECRET vazia na Vercel');
  const g = await verificarGoogle(body.credential);
  let pg = await acharAluno(g.email);
  if (!pg) {
    pg = await notion('/pages', 'POST', {
      parent: { database_id: idNotion('TOEFL_ALUNOS_DB') },
      icon: { type: 'emoji', emoji: '🎓' },
      properties: {
        'Aluno': { title: rich(g.nome) },
        'E-mail': { email: g.email },
        'Foto': { url: g.foto || null },
        'Google ID': { rich_text: rich(g.googleId) },
        'Status': { select: { name: env('ACESSO_RESTRITO') === '1' ? 'Pendente' : 'Ativo' } },
        'Primeiro acesso': { date: { start: hoje() } },
        'Último acesso': { date: { start: hoje() } },
        'Acessos': { number: 1 },
      },
    });
  } else {
    await notion(`/pages/${pg.id}`, 'PATCH', { properties: {
      'Último acesso': { date: { start: hoje() } },
      'Acessos': { number: ((pg.properties['Acessos'] || {}).number || 0) + 1 },
      'Foto': { url: g.foto || null },
    } });
  }
  const status = (pg.properties['Status'] && pg.properties['Status'].select && pg.properties['Status'].select.name) || 'Ativo';
  if (status === 'Bloqueado' || status === 'Pendente') {
    return { bloqueado: true, status, nome: g.nome };
  }
  const nome = plain(pg.properties['Aluno']) || g.nome;
  return { token: assinar({ email: g.email, alunoId: pg.id, nome }), nome, email: g.email, foto: g.foto };
}

/* ---------- gravar resultado ---------- */
const bloco = (type, t) => ({ object: 'block', type, [type]: { rich_text: rich(t) } });
function paragrafos(texto) {
  const s = String(texto || ''); const out = [];
  for (let i = 0; i < s.length; i += 1900) out.push(bloco('paragraph', s.slice(i, i + 1900)));
  return out.length ? out : [bloco('paragraph', '(em branco)')];
}

async function enviar(body, sessao) {
  const { simulado, simId, modo, geral, duracaoMin, secoes = {} } = body;
  if (!simulado) throw new Error('Missing fields');
  const tipo = modo === 'completo' ? 'Completo' : (NOMES[Object.keys(secoes)[0]] || 'Completo');
  const num = v => (v == null || v === '' ? null : Number(v));
  const R = secoes.reading, L = secoes.listening, W = secoes.writing, S = secoes.speaking;
  const temCorrecao = !!(W && (W.textos || []).length) || !!(S && (S.gravacoes || []).length);
  const obj = Object.values(secoes).filter(s => s.total);
  const ac = obj.reduce((a, s) => a + s.acertos, 0), tot = obj.reduce((a, s) => a + s.total, 0);
  const pt = {}; Object.values(secoes).forEach(s => Object.entries(s.porTipo || {}).forEach(([k, v]) => { pt[k] = pt[k] || { a: 0, t: 0 }; pt[k].a += v.a; pt[k].t += v.t; }));
  const fracos = Object.entries(pt).filter(([, v]) => v.t && v.a / v.t < 0.6).map(([k]) => k);
  const mod2 = s => (s && s.caminho && s.caminho !== 'base') ? { select: { name: s.caminho === 'dificil' ? 'Difícil' : 'Fácil' } } : { select: null };
  const palavras = n => { const t = W && (W.textos || []).find(x => x.nome === n); return t ? t.palavras : null; };
  const links = S ? (S.gravacoes || []).map(g => g.url).filter(Boolean) : [];

  const children = [];
  for (const [k, s] of Object.entries(secoes)) {
    children.push(bloco('heading_2', `${NOMES[k]} — ${s.titulo}` + (s.banda != null ? ` · banda ${s.banda}` : '')));
    if (s.caminho && s.caminho !== 'base') children.push(bloco('bulleted_list_item', `Módulo 2: ${s.caminho === 'dificil' ? 'difícil' : 'fácil'}`));
    Object.entries(s.porTipo || {}).forEach(([n, v]) => children.push(bloco('bulleted_list_item', `${n}: ${v.a}/${v.t}`)));
    if ((s.erros || []).length) { children.push(bloco('heading_3', 'Erros')); s.erros.slice(0, 30).forEach(e => children.push(bloco('bulleted_list_item', e))); }
    (s.textos || []).forEach(t => { children.push(bloco('heading_3', `${t.nome} (${t.palavras} palavras)`)); children.push(bloco('quote', 'Prompt: ' + t.prompt)); children.push(...paragrafos(t.texto)); });
    if ((s.gravacoes || []).length) { children.push(bloco('heading_3', 'Gravações')); s.gravacoes.forEach(g => children.push(bloco('bulleted_list_item', `${g.nome} — "${g.prompt}" → ${g.url || 'sem link (aluno envia pelo WhatsApp)'}`))); }
  }

  await notion('/pages', 'POST', {
    parent: { database_id: idNotion('TOEFL_RESULTADOS_DB') },
    properties: {
      'Resultado': { title: rich(`${sessao.nome} · ${simulado}`) },
      'Aluno': { relation: [{ id: sessao.alunoId }] },
      'E-mail': { email: sessao.email },
      'Simulado': { rich_text: rich(simulado) },
      'ID simulado': { rich_text: rich(simId || '') },
      'Tipo': { select: { name: tipo } },
      'Data': { date: { start: hoje() } },
      'Reading': { number: num(R && R.banda) },
      'Listening': { number: num(L && L.banda) },
      'Geral estimado': { number: modo === 'completo' ? num(geral) : null },
      'Módulo 2 Reading': mod2(R),
      'Módulo 2 Listening': mod2(L),
      'Acertos': { number: tot ? ac : null },
      'Total objetivas': { number: tot || null },
      '% Objetivas': { number: tot ? Math.round(ac / tot * 1000) / 1000 : null },
      'Pontos fracos': { multi_select: fracos.slice(0, 10).map(name => ({ name })) },
      'Palavras e-mail': { number: palavras('Write an Email') },
      'Palavras discussão': { number: palavras('Write for an Academic Discussion') },
      'Gravações': { url: links[0] || null },
      'Duração (min)': { number: num(duracaoMin) },
      'Correção': { select: { name: temCorrecao ? 'Aguardando correção' : 'Só objetivas' } },
      'Detalhes': { rich_text: rich(JSON.stringify(pt)) },
    },
    children: children.slice(0, 100),
  });
  return { ok: true };
}

/* ---------- histórico do aluno ---------- */
async function historico(sessao) {
  const q = await notion(`/databases/${idNotion('TOEFL_RESULTADOS_DB')}/query`, 'POST', {
    filter: { property: 'E-mail', email: { equals: sessao.email } },
    sorts: [{ property: 'Data', direction: 'descending' }], page_size: 100,
  });
  return q.results.map(p => {
    const pr = p.properties; const n = k => (pr[k] && pr[k].number != null ? pr[k].number : null);
    let porTipo = {}; try { porTipo = JSON.parse(plain(pr['Detalhes']) || '{}'); } catch {}
    const d = pr['Data'] && pr['Data'].date ? pr['Data'].date.start : null;
    return {
      quando: d ? Date.parse(d) : 0, data: d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' }) : '',
      simulado: plain(pr['Simulado']), simId: plain(pr['ID simulado']),
      modo: pr['Tipo'] && pr['Tipo'].select && pr['Tipo'].select.name === 'Completo' ? 'completo' : 'habilidade',
      reading: n('Reading'), listening: n('Listening'), writing: n('Writing'), speaking: n('Speaking'),
      geralParcial: n('Geral estimado'), porTipo,
      correcao: pr['Correção'] && pr['Correção'].select ? pr['Correção'].select.name : '',
    };
  });
}

/* ---------- setup: cria as duas bases ---------- */
const sel = (nomes) => ({ select: { options: nomes.map(([name, color]) => ({ name, color })) } });
async function setup() {
  const parent = { type: 'page_id', page_id: idNotion('NOTION_PARENT_PAGE') };
  const alunos = await notion('/databases', 'POST', {
    parent, icon: { type: 'emoji', emoji: '🎓' },
    title: rich('TOEFL Alunos'),
    description: rich('Alunos da Plataforma TOEFL · cadastro automático pelo login Google'),
    properties: {
      'Aluno': { title: {} },
      'E-mail': { email: {} },
      'Status': sel([['Ativo', 'green'], ['Pendente', 'yellow'], ['Bloqueado', 'red']]),
      'Turma': sel([['Particular', 'purple'], ['Grupo', 'blue']]),
      'Meta (banda)': { number: { format: 'number' } },
      'Data da prova': { date: {} },
      'Primeiro acesso': { date: {} },
      'Último acesso': { date: {} },
      'Acessos': { number: { format: 'number' } },
      'Foto': { url: {} },
      'Google ID': { rich_text: {} },
      'Observações': { rich_text: {} },
    },
  });

  const resultados = await notion('/databases', 'POST', {
    parent, icon: { type: 'emoji', emoji: '📊' },
    title: rich('TOEFL Resultados'),
    description: rich('Um registro por simulado feito na Plataforma TOEFL'),
    properties: {
      'Resultado': { title: {} },
      'Aluno': { relation: { database_id: alunos.id, type: 'dual_property', dual_property: {} } },
      'E-mail': { email: {} },
      'Simulado': { rich_text: {} },
      'ID simulado': { rich_text: {} },
      'Tipo': sel([['Completo', 'orange'], ['Reading', 'blue'], ['Listening', 'purple'], ['Writing', 'green'], ['Speaking', 'pink']]),
      'Data': { date: {} },
      'Reading': { number: { format: 'number' } },
      'Listening': { number: { format: 'number' } },
      'Writing': { number: { format: 'number' } },
      'Speaking': { number: { format: 'number' } },
      'Geral estimado': { number: { format: 'number' } },
      'Módulo 2 Reading': sel([['Difícil', 'green'], ['Fácil', 'yellow']]),
      'Módulo 2 Listening': sel([['Difícil', 'green'], ['Fácil', 'yellow']]),
      'Acertos': { number: { format: 'number' } },
      'Total objetivas': { number: { format: 'number' } },
      '% Objetivas': { number: { format: 'percent' } },
      'Pontos fracos': { multi_select: { options: [] } },
      'Palavras e-mail': { number: { format: 'number' } },
      'Palavras discussão': { number: { format: 'number' } },
      'Gravações': { url: {} },
      'Duração (min)': { number: { format: 'number' } },
      'Correção': sel([['Aguardando correção', 'yellow'], ['Corrigido', 'green'], ['Só objetivas', 'gray']]),
      'Feedback': { rich_text: {} },
      'Detalhes': { rich_text: {} },
    },
  });

  const avisos = [];
  // Nota geral final: média das seções preenchidas (Writing e Speaking entram quando você corrige), arredondada a 0,5.
  try {
    await notion(`/databases/${resultados.id}`, 'PATCH', { properties: { 'Nota final': { formula: { expression:
      'let(v, [prop("Reading"), prop("Listening"), prop("Writing"), prop("Speaking")].filter(!empty(current)), if(empty(v), "", format(round(v.sum() / v.length() * 2) / 2)))' } } } });
  } catch (e) { avisos.push('Fórmula "Nota final" não criada: ' + e.message); }

  // Na base de alunos: renomeia a relação e cria os resumos.
  try {
    const a = await notion(`/databases/${alunos.id}`);
    const rel = Object.entries(a.properties).find(([, p]) => p.type === 'relation');
    if (rel) {
      await notion(`/databases/${alunos.id}`, 'PATCH', { properties: { [rel[0]]: { name: 'Resultados' } } });
      const roll = (prop, fn) => ({ rollup: { relation_property_name: 'Resultados', rollup_property_name: prop, function: fn } });
      await notion(`/databases/${alunos.id}`, 'PATCH', { properties: {
        'Simulados feitos': roll('Resultado', 'count'),
        'Melhor geral': roll('Geral estimado', 'max'),
        'Melhor Reading': roll('Reading', 'max'),
        'Melhor Listening': roll('Listening', 'max'),
        'Último simulado': roll('Data', 'latest_date'),
        'Para corrigir': roll('Correção', 'count_per_group'),
      } });
    }
  } catch (e) { avisos.push('Resumos na base de alunos: ' + e.message); }

  return { TOEFL_ALUNOS_DB: alunos.id, TOEFL_RESULTADOS_DB: resultados.id, alunos: alunos.url, resultados: resultados.url, avisos };
}

/* ---------- roteador ---------- */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const acao = (req.query && req.query.acao) || 'enviar';
  try {
    if (acao === 'config') return res.status(200).json({ googleClientId: env('GOOGLE_CLIENT_ID') });

    if (acao === 'setup') {
      if (!env('SETUP_KEY') || req.query.chave !== env('SETUP_KEY')) return res.status(403).json({ error: 'Chave de setup incorreta' });
      if (env('TOEFL_ALUNOS_DB') && req.query.forcar !== '1') return res.status(400).json({ error: 'As bases já estão configuradas (TOEFL_ALUNOS_DB existe). Use &forcar=1 para criar outras.' });
      if (!env('NOTION_PARENT_PAGE')) return res.status(400).json({ error: 'Falta NOTION_PARENT_PAGE' });
      return res.status(200).json(await setup());
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (acao === 'login') return res.status(200).json(await login(body));

    const sessao = lerSessao(body.token);
    if (!sessao) return res.status(401).json({ error: 'Sessão expirada. Entre de novo com o Google.' });
    if (acao === 'enviar') return res.status(200).json(await enviar(body, sessao));
    if (acao === 'historico') return res.status(200).json({ itens: await historico(sessao) });
    return res.status(404).json({ error: 'Ação desconhecida' });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
