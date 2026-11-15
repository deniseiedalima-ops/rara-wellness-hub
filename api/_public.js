// Funções da área pública (página de inscrição) e do Mercado Pago.
const crypto = require('crypto');
const lib = require('./_lib');
const { httpError, env, ensureSchema, queryAccount, applyOp } = lib;

const TZ = 'America/Fortaleza';
const PENDING_HOLD_MIN = 60; // inscrição pendente segura a vaga por 60 minutos

function publicAccount() {
  const explicit = String(process.env.PUBLIC_ACCOUNT || process.env.SHARED_WORKSPACE || '').trim().toLowerCase();
  if (explicit) return explicit;
  const first = env('ALLOWED_EMAILS').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)[0];
  if (!first) throw httpError(500, 'Configure ALLOWED_EMAILS na Vercel.');
  return first;
}
function todayBR() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); // AAAA-MM-DD
}
function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function readRows(pages) {
  const out = [];
  for (const p of pages) {
    const r = lib.pageToRecord(p);
    if (r.deleted || !r.json) continue;
    try { out.push({ ...r, obj: JSON.parse(r.json) }); } catch { /* ignora linha ilegível */ }
  }
  return out;
}
async function loadType(account, tipo) {
  return readRows(await queryAccount(account, { property: 'Tipo', select: { equals: tipo } }));
}
async function findEventBySlug(account, slug) {
  const events = await loadType(account, 'Eventos');
  const want = slugify(slug);
  return events.find(e => e.obj && e.obj.form && e.obj.form.enabled && slugify(e.obj.form.slug || e.obj.name) === want) || null;
}
function countsByLot(event, registrations) {
  const now = Date.now();
  const counts = {};
  for (const r of registrations) {
    const x = r.obj || {};
    if (x.eventId !== event.id) continue;
    const paid = x.paymentStatus === 'Pago';
    const holding = x.paymentStatus === 'Pendente' && x.source === 'Inscrição online' && x.created &&
      now - Date.parse(x.created) < PENDING_HOLD_MIN * 60000;
    if (!paid && !holding) continue;
    const key = x.lotId || x.lot;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
// Primeiro lote ainda válido (dentro da data e com vagas).
function pickLot(event, registrations) {
  const lots = (event.form && Array.isArray(event.form.lots)) ? event.form.lots : [];
  const counts = countsByLot(event, registrations);
  const today = todayBR();
  for (const lot of lots) {
    const price = Number(lot.price);
    if (!lot.name || !Number.isFinite(price) || price <= 0) continue;
    if (lot.until && today > lot.until) continue;
    const limit = Number(lot.limit) || 0;
    const sold = (counts[lot.id] || 0) + (lot.id !== lot.name ? (counts[lot.name] || 0) : 0);
    if (limit > 0 && sold >= limit) continue;
    return { id: lot.id, name: lot.name, price, until: lot.until || '', remaining: limit > 0 ? limit - sold : null };
  }
  return null;
}
function publicEventView(event, lot) {
  const f = event.form || {};
  return {
    name: event.name, date: event.date || '', place: event.place || '',
    description: f.pageText || event.description || '',
    slug: slugify(f.slug || event.name),
    lot: lot ? { id: lot.id, name: lot.name, price: lot.price, until: lot.until, lastSpots: lot.remaining != null && lot.remaining <= 5 ? lot.remaining : null } : null,
    questions: (Array.isArray(f.questions) ? f.questions : []).filter(q => q && q.label).map(q => ({
      id: String(q.id), label: String(q.label).slice(0, 200), type: ['text', 'textarea', 'select'].includes(q.type) ? q.type : 'text',
      options: q.type === 'select' ? String(q.options || '').split(';').map(s => s.trim()).filter(Boolean).slice(0, 30) : [],
      required: !!q.required
    })),
    successMessage: f.successMessage || '',
    groupLink: /^https?:\/\//.test(f.groupLink || '') ? f.groupLink : ''
  };
}

// ---------- registros gravados pelo servidor ----------
const fmtWhen = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
};
function summaryFor(collection, x) {
  const by = x.createdBy ? `${x.createdBy} · ${fmtWhen(x.createdAt || x.created || new Date().toISOString())}` : '';
  const editedBy = x.updatedBy ? `${x.updatedBy} · ${fmtWhen(x.updatedAt)}` : '';
  if (collection === 'registrations') {
    return { title: x.attendee, date: x.paymentDate || String(x.created || '').slice(0, 10), amount: x.amount, status: x.paymentStatus,
      event: x.eventName, category: x.lot, detail: [x.phone, x.email].filter(Boolean).join(' · '), by, editedBy };
  }
  return { title: x.description, date: x.date, amount: x.amount, status: x.status, event: x.event, category: x.category,
    detail: x.type === 'income' ? 'Receita' : 'Despesa', by, editedBy };
}
async function saveRecord(account, collection, obj, { isNew } = {}) {
  const { titleName } = await ensureSchema();
  const json = JSON.stringify(obj);
  const op = {
    action: 'upsert', collection, key: collection + ':' + obj.id, json,
    hash: 'srv-' + crypto.createHash('sha1').update(json).digest('hex').slice(0, 16),
    summary: summaryFor(collection, obj)
  };
  if (isNew) { op.known = 'absent'; op.ordem = Date.now(); }
  return applyOp(op, account, titleName);
}
async function findRecord(account, collection, id) {
  const pages = await queryAccount(account, { property: 'Chave', rich_text: { equals: collection + ':' + id } });
  const rows = readRows(pages);
  rows.sort((a, b) => String(b.edited).localeCompare(String(a.edited)));
  return rows[0] || null;
}
async function softDelete(account, collection, id) {
  return applyOp({ action: 'delete', collection, key: collection + ':' + id }, account);
}

// ---------- Mercado Pago ----------
async function mp(path, method = 'GET', body) {
  const token = env('MP_ACCESS_TOKEN');
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  if (method === 'POST') headers['X-Idempotency-Key'] = crypto.randomUUID();
  const r = await fetch('https://api.mercadopago.com' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Mercado Pago', r.status, j);
    const e = httpError(502, r.status === 401 ? 'O Mercado Pago recusou a credencial. Confira MP_ACCESS_TOKEN na Vercel.' : 'Não foi possível falar com o Mercado Pago agora. Tente novamente em instantes.');
    e.mpStatus = r.status;
    throw e;
  }
  return j;
}
function isTestToken() { return /^TEST-/.test(String(process.env.MP_ACCESS_TOKEN || '').trim()); }
function siteOrigin(req) {
  const fixed = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (fixed) return fixed;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return 'https://' + host;
}
function methodLabel(p) {
  if (p.payment_method_id === 'pix' || p.payment_type_id === 'bank_transfer') return 'Pix';
  if (p.payment_type_id === 'credit_card') return 'Cartão de crédito' + (p.installments > 1 ? ` (${p.installments}x)` : '');
  if (p.payment_type_id === 'debit_card') return 'Cartão de débito';
  if (p.payment_type_id === 'account_money') return 'Saldo Mercado Pago';
  return 'Mercado Pago';
}
const money = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

module.exports = {
  publicAccount, todayBR, slugify, loadType, findEventBySlug, pickLot, publicEventView, countsByLot,
  saveRecord, findRecord, softDelete, mp, isTestToken, siteOrigin, methodLabel, money, fmtWhen
};
