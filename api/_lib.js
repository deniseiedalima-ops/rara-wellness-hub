// Funções compartilhadas pelas rotas /api do RARA Hub (Vercel).
// Arquivos que começam com "_" não viram rotas públicas na Vercel.
const crypto = require('crypto');

const NOTION_VERSION = '2022-06-28';
const COOKIE = 'rara_session';
const SESSION_DAYS = 30;

const TYPE_LABEL = {
  transactions: 'Financeiro',
  registrations: 'Inscrições',
  purchases: 'Compras',
  ideas: 'Ideias',
  events: 'Eventos',
  posts: 'Instagram',
  links: 'Links',
  checklists: 'Checklist',
  partners: 'Parceiros'
};
const COLLECTIONS = Object.keys(TYPE_LABEL);

// ---------- utilidades HTTP ----------
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function env(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw httpError(500, `Configuração incompleta na Vercel: falta a variável ${name}.`);
  return String(v).trim();
}
function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function handler(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) throw httpError(405, 'Método não permitido.');
      if (req.method === 'POST' && !String(req.headers['content-type'] || '').includes('application/json')) {
        throw httpError(415, 'Envie os dados em JSON.');
      }
      await fn(req, res);
    } catch (e) {
      if (!e.status || e.status >= 500) console.error(e);
      send(res, e.status || 500, { error: e.message || 'Erro interno.' });
    }
  };
}
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- sessão (cookie assinado) ----------
function hmac(body) {
  return crypto.createHmac('sha256', env('SESSION_SECRET')).update(body).digest('base64url');
}
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + hmac(body);
}
function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(hmac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.email || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignora */ }
    }
  });
  return out;
}
function allowedEmails() {
  return env('ALLOWED_EMAILS').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
// Cada login guarda os próprios dados. Se SHARED_WORKSPACE estiver definida,
// todos os e-mails autorizados passam a usar o mesmo espaço de dados.
function accountFor(email) {
  const shared = String(process.env.SHARED_WORKSPACE || '').trim().toLowerCase();
  return shared || email;
}
function requireSession(req) {
  const s = verifySession(parseCookies(req)[COOKIE]);
  if (!s) throw httpError(401, 'Sessão expirada. Entre novamente com o Google.');
  if (!allowedEmails().includes(s.email)) throw httpError(403, 'Este e-mail não tem acesso ao RARA Hub.');
  return { email: s.email, account: accountFor(s.email) };
}
function setSessionCookie(res, email) {
  const maxAge = SESSION_DAYS * 24 * 3600;
  const token = signSession({ email, exp: Date.now() + maxAge * 1000 });
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

// ---------- login Google ----------
async function verifyGoogleCredential(credential) {
  if (!credential || typeof credential !== 'string') throw httpError(400, 'Login do Google ausente.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw httpError(401, 'Não foi possível validar o login do Google. Tente novamente.');
  const c = await r.json();
  if (c.aud !== env('GOOGLE_CLIENT_ID')) throw httpError(401, 'Login do Google emitido para outro aplicativo.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(c.iss)) throw httpError(401, 'Emissor do login inválido.');
  if (!(c.email_verified === true || c.email_verified === 'true')) throw httpError(401, 'O e-mail do Google ainda não foi verificado.');
  if (Number(c.exp) * 1000 < Date.now()) throw httpError(401, 'Login do Google expirado. Tente novamente.');
  const email = String(c.email || '').toLowerCase();
  if (!allowedEmails().includes(email)) throw httpError(403, `O e-mail ${email} não está autorizado a acessar o RARA Hub.`);
  return email;
}

// ---------- Notion ----------
let lastNotionCall = 0;
const MIN_GAP_MS = Number(process.env.NOTION_MIN_GAP_MS || 340); // ~3 chamadas/s (limite do Notion)
function notionMessage(status, j) {
  if (status === 401) return 'O Notion recusou a chave. Confira a variável NOTION_TOKEN na Vercel.';
  if (status === 404) return 'O Notion não encontrou o banco de dados. Confira NOTION_DATABASE_ID e se a integração foi adicionada ao banco (••• → Conexões).';
  if (status === 403) return 'A integração do Notion não tem permissão para editar este banco. Adicione-a em ••• → Conexões.';
  return 'Erro do Notion: ' + (j && j.message ? j.message : 'status ' + status);
}
async function notion(path, method = 'GET', body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = Math.max(0, lastNotionCall + MIN_GAP_MS - Date.now());
    if (wait) await sleep(wait);
    lastNotionCall = Date.now();
    const r = await fetch('https://api.notion.com/v1/' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + env('NOTION_TOKEN'),
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const ra = Number(r.headers.get('retry-after'));
      await sleep((Number.isFinite(ra) && ra > 0 ? ra : attempt + 1) * 1000);
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = httpError(502, notionMessage(r.status, j));
      e.notionStatus = r.status;
      throw e;
    }
    return j;
  }
  throw httpError(503, 'O Notion está ocupado. Tente sincronizar novamente em alguns segundos.');
}

const REQUIRED_PROPS = {
  'Chave': { rich_text: {} },
  'Conta': { rich_text: {} },
  'Tipo': { select: { options: COLLECTIONS.map(c => ({ name: TYPE_LABEL[c] })) } },
  'Data': { date: {} },
  'Valor': { number: { format: 'real' } },
  'Status': { rich_text: {} },
  'Evento': { rich_text: {} },
  'Categoria': { rich_text: {} },
  'Detalhe': { rich_text: {} },
  'Lançado por': { rich_text: {} },
  'Editado por': { rich_text: {} },
  'Ordem': { number: {} },
  'Hash': { rich_text: {} },
  'Excluído': { checkbox: {} },
  'Dados': { rich_text: {} }
};
let schemaCache = null;
async function ensureSchema() {
  if (schemaCache) return schemaCache;
  const db = await notion('databases/' + databaseId());
  const props = db.properties || {};
  const titleName = Object.keys(props).find(k => props[k].type === 'title');
  if (!titleName) throw httpError(500, 'O banco do Notion precisa ter uma coluna de título.');
  const missing = {};
  for (const [name, def] of Object.entries(REQUIRED_PROPS)) {
    const type = Object.keys(def)[0];
    if (!props[name]) missing[name] = def;
    else if (props[name].type !== type) {
      throw httpError(500, `A coluna "${name}" do Notion precisa ser do tipo ${type}. Renomeie ou apague essa coluna e tente de novo.`);
    }
  }
  if (Object.keys(missing).length) await notion('databases/' + databaseId(), 'PATCH', { properties: missing });
  schemaCache = { titleName };
  return schemaCache;
}
function databaseId() {
  // Aceita o ID puro ou o link inteiro copiado do navegador.
  const raw = env('NOTION_DATABASE_ID');
  const m = raw.replace(/-/g, '').match(/[0-9a-f]{32}/i);
  if (!m) throw httpError(500, 'NOTION_DATABASE_ID inválido. Cole o ID de 32 caracteres do banco.');
  return m[0];
}
function plain(prop) {
  if (!prop) return '';
  const arr = prop.rich_text || prop.title || [];
  return arr.map(t => t.plain_text || (t.text && t.text.content) || '').join('');
}
function text(v) {
  const s = String(v == null ? '' : v);
  if (!s) return [];
  return [{ type: 'text', text: { content: Array.from(s).slice(0, 1900).join('') } }];
}
function chunks(s) {
  const chars = Array.from(String(s || ''));
  const out = [];
  for (let i = 0; i < chars.length; i += 1900) out.push({ type: 'text', text: { content: chars.slice(i, i + 1900).join('') } });
  if (out.length > 100) throw httpError(413, 'Um registro ficou grande demais para o Notion (limite ~190 mil caracteres).');
  return out;
}
function pageToRecord(page) {
  const p = page.properties || {};
  return {
    pageId: page.id,
    key: plain(p['Chave']),
    json: plain(p['Dados']),
    hash: plain(p['Hash']),
    deleted: !!(p['Excluído'] && p['Excluído'].checkbox),
    ordem: p['Ordem'] ? p['Ordem'].number : null,
    edited: page.last_edited_time || ''
  };
}
async function queryAccount(account, extraFilter) {
  const filter = extraFilter
    ? { and: [{ property: 'Conta', rich_text: { equals: account } }, extraFilter] }
    : { property: 'Conta', rich_text: { equals: account } };
  const results = [];
  let cursor;
  do {
    const body = { filter, page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const j = await notion('databases/' + databaseId() + '/query', 'POST', body);
    results.push(...(j.results || []));
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return results.filter(p => !p.archived && !p.in_trash);
}
function validDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function buildProps(op, account, titleName) {
  const s = op.summary || {};
  const amount = s.amount === '' || s.amount == null ? null : Number(s.amount);
  const props = {
    [titleName]: { title: text(s.title || op.key) },
    'Chave': { rich_text: text(op.key) },
    'Conta': { rich_text: text(account) },
    'Tipo': { select: { name: TYPE_LABEL[op.collection] } },
    'Data': { date: validDate(s.date) ? { start: s.date } : null },
    'Valor': { number: Number.isFinite(amount) ? amount : null },
    'Status': { rich_text: text(s.status) },
    'Evento': { rich_text: text(s.event) },
    'Categoria': { rich_text: text(s.category) },
    'Detalhe': { rich_text: text(s.detail) },
    'Lançado por': { rich_text: text(s.by) },
    'Editado por': { rich_text: text(s.editedBy) },
    'Hash': { rich_text: text(op.hash) },
    'Excluído': { checkbox: false },
    'Dados': { rich_text: chunks(op.json) }
  };
  if (Number.isFinite(op.ordem)) props['Ordem'] = { number: op.ordem };
  return props;
}
function validateOp(op) {
  if (!op || typeof op !== 'object') throw httpError(400, 'Operação inválida.');
  if (!['upsert', 'delete'].includes(op.action)) throw httpError(400, 'Ação inválida.');
  if (!COLLECTIONS.includes(op.collection)) throw httpError(400, 'Tipo de registro inválido.');
  if (typeof op.key !== 'string' || !op.key.startsWith(op.collection + ':') || op.key.length > 300) throw httpError(400, 'Chave inválida.');
  if (op.action === 'upsert') {
    if (typeof op.json !== 'string') throw httpError(400, 'Dados ausentes.');
    try { JSON.parse(op.json); } catch { throw httpError(400, 'Dados com formato inválido.'); }
    if (typeof op.hash !== 'string') throw httpError(400, 'Hash ausente.');
  }
}
async function findPages(account, key) {
  return queryAccount(account, { property: 'Chave', rich_text: { equals: key } });
}
// Aplica uma operação. Nada é apagado do Notion: exclusões feitas no site
// apenas marcam a linha como "Excluído", mantendo os dados para recuperação.
async function applyOp(op, account, titleName) {
  validateOp(op);
  if (op.action === 'delete') {
    const pages = await findPages(account, op.key);
    for (const p of pages) {
      await notion('pages/' + p.id, 'PATCH', { properties: { 'Excluído': { checkbox: true }, 'Hash': { rich_text: text('excluido') } } });
    }
    return { key: op.key, ok: true };
  }
  const properties = buildProps(op, account, titleName);
  let pages = op.known === 'absent' ? [] : await findPages(account, op.key);
  if (pages.length) {
    pages.sort((a, b) => String(b.last_edited_time).localeCompare(String(a.last_edited_time)));
    if (!Number.isFinite(op.ordem) && pages[0].properties && pages[0].properties['Ordem'] && pages[0].properties['Ordem'].number == null) {
      properties['Ordem'] = { number: Date.now() };
    }
    await notion('pages/' + pages[0].id, 'PATCH', { properties });
    return { key: op.key, ok: true, pageId: pages[0].id };
  }
  const page = await notion('pages', 'POST', { parent: { database_id: databaseId() }, properties });
  return { key: op.key, ok: true, pageId: page.id };
}

module.exports = {
  COLLECTIONS, TYPE_LABEL, httpError, env, send, handler, readJson,
  requireSession, setSessionCookie, clearSessionCookie, verifyGoogleCredential, accountFor,
  ensureSchema, queryAccount, pageToRecord, applyOp, buildProps, signSession, verifySession,
  _resetForTests() { schemaCache = null; lastNotionCall = 0; }
};
