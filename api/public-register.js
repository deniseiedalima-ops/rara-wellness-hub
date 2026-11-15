// Recebe a inscrição da página pública, grava como "Pendente" e cria o pagamento no Mercado Pago.
const crypto = require('crypto');
const { handler, send, readJson, httpError } = require('./_lib');
const P = require('./_public');

const clean = (v, max = 300) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const AGE = ['Até 19', '20-25', '26-35', '36-45', '46+'];
const HOW = ['Instagram', 'Indicação de amiga', 'WhatsApp', 'Parceira / marca', 'Outro'];

module.exports = handler(['POST'], async (req, res) => {
  const body = await readJson(req);
  if (body.website) throw httpError(400, 'Envio inválido.'); // campo-isca contra robôs
  const a = body.answers || {};
  const attendee = clean(a.name, 120), email = clean(a.email, 160).toLowerCase(), phone = clean(a.phone, 40);
  if (attendee.split(/\s+/).length < 2) throw httpError(400, 'Informe seu nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Informe um e-mail válido.');
  if (phone.replace(/\D/g, '').length < 10) throw httpError(400, 'Informe seu WhatsApp com DDD.');
  if (!AGE.includes(a.ageRange)) throw httpError(400, 'Escolha sua faixa etária.');
  if (!a.consent) throw httpError(400, 'É preciso concordar com o uso dos dados para a inscrição.');

  const account = P.publicAccount();
  const ev = await P.findEventBySlug(account, body.slug);
  if (!ev) throw httpError(404, 'As inscrições para este evento estão encerradas.');
  const event = ev.obj;
  const view = P.publicEventView(event, null);

  const extras = {};
  for (const q of view.questions) {
    const v = clean((a.extras || {})[q.id], 1000);
    if (q.required && !v) throw httpError(400, `Responda: ${q.label}`);
    if (q.type === 'select' && v && !q.options.includes(v)) throw httpError(400, `Resposta inválida em: ${q.label}`);
    if (v) extras[q.label] = v;
  }

  const regs = await P.loadType(account, 'Inscrições');
  const lot = P.pickLot(event, regs);
  if (!lot) throw httpError(409, 'As vagas deste evento esgotaram. 💛');
  if (body.lotId && body.lotId !== lot.id) throw httpError(409, `O lote mudou: agora é ${lot.name} (${P.money(lot.price)}). Confira e envie de novo.`);

  const now = new Date().toISOString();
  const id = 'web-' + crypto.randomUUID();
  const dietary = clean(a.dietary, 300), how = HOW.includes(a.howFound) ? a.howFound : '';
  const notes = [
    `Faixa etária: ${a.ageRange}`,
    dietary ? `Restrição alimentar: ${dietary}` : '',
    how ? `Como conheceu: ${how}` : '',
    ...Object.entries(extras).map(([k, v]) => `${k}: ${v}`)
  ].filter(Boolean).join(' · ');
  const registration = {
    id, attendee, email, phone, eventId: event.id, eventName: event.name, lot: lot.name, lotId: lot.id,
    amount: lot.price, paymentDate: '', paymentStatus: 'Pendente', paymentMethod: 'Mercado Pago',
    notes, answers: { ageRange: a.ageRange, dietary, howFound: how, extras },
    created: now, createdAt: now, createdBy: 'Inscrição online', source: 'Inscrição online', transactionId: null
  };

  const origin = P.siteOrigin(req);
  const back = s => `${origin}/inscricao/${view.slug}?status=${s}&r=${encodeURIComponent(id)}`;
  const pref = await P.mp('/checkout/preferences', 'POST', {
    items: [{ id: lot.id, title: `${event.name} — ${lot.name}`.slice(0, 250), quantity: 1, currency_id: 'BRL', unit_price: lot.price }],
    payer: { name: attendee.split(' ')[0], surname: attendee.split(' ').slice(1).join(' '), email },
    external_reference: id,
    metadata: { registration_id: id },
    notification_url: `${origin}/api/mp-webhook`,
    back_urls: { success: back('ok'), pending: back('pendente'), failure: back('erro') },
    auto_return: 'approved',
    statement_descriptor: 'RARA WELLNESS',
    payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
    expires: true,
    expiration_date_to: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString()
  });
  registration.mpPreferenceId = pref.id;
  await P.saveRecord(account, 'registrations', registration, { isNew: true });

  const url = P.isTestToken() ? (pref.sandbox_init_point || pref.init_point) : pref.init_point;
  if (!url) throw httpError(502, 'O Mercado Pago não devolveu o link de pagamento.');
  send(res, 200, { paymentUrl: url, registrationId: id });
});
