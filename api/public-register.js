// Recebe a inscrição da página pública, grava como "Pendente" e cria o pagamento no Mercado Pago.
const crypto = require('crypto');
const { handler, send, readJson, httpError } = require('./_lib');
const P = require('./_public');

const clean = (v, max = 300) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

module.exports = handler(['POST'], async (req, res) => {
  const body = await readJson(req);
  if (body.website) throw httpError(400, 'Envio inválido.'); // campo-isca contra robôs
  const a = body.answers || {};

  const account = P.publicAccount();
  const ev = await P.findEventBySlug(account, body.slug);
  if (!ev) throw httpError(404, 'As inscrições para este evento estão encerradas.');
  const event = ev.obj;
  const view = P.publicEventView(event, null);

  const short = l => (l.length > 70 ? l.slice(0, 67) + '…' : l);
  const qOf = t => view.questions.find(q => q.type === t);
  const rawX = a.extras && typeof a.extras === 'object' ? a.extras : {};
  const attendee = clean(rawX[qOf('name').id] ?? a.name, 120).replace(/\s+/g, ' ');
  const email = clean(rawX[qOf('email').id] ?? a.email, 160).toLowerCase();
  const phone = clean(rawX[qOf('phone').id] ?? a.phone, 40);
  if (attendee.split(' ').length < 2) throw httpError(400, 'Informe seu nome completo.');
  if (phone.replace(/\D/g, '').length < 10) throw httpError(400, 'Informe seu WhatsApp com DDD.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'Informe um e-mail válido.');
  const raw = rawX;
  const byId = Object.fromEntries(view.questions.map(q => [q.id, q]));
  const answersById = {};
  for (const q of view.questions) {
    const v = raw[q.id];
    if (q.type === 'multi') answersById[q.id] = (Array.isArray(v) ? v : []).map(x => clean(x, 200)).filter(x => q.options.includes(x));
    else if (q.type === 'declaration') answersById[q.id] = v === true;
    else answersById[q.id] = clean(v, 1500);
  }
  const answers = []; // [pergunta, resposta] na ordem do formulário
  for (const q of view.questions) {
    if (['info', 'section'].includes(q.type) || P.IDENTITY.includes(q.type) || !P.isVisible(q, byId, answersById)) continue;
    const v = answersById[q.id];
    const empty = q.type === 'multi' ? !v.length : q.type === 'declaration' ? !v : !v;
    if (q.required && empty) throw httpError(400, q.type === 'declaration' ? `Marque a confirmação: ${short(q.label)}` : `Responda: ${short(q.label)}`);
    if (empty) continue;
    if (['select', 'yesno'].includes(q.type) && !q.options.includes(v)) throw httpError(400, `Resposta inválida em: ${short(q.label)}`);
    if (q.type === 'number' && !/^\d{1,3}([.,]\d+)?$/.test(v)) throw httpError(400, `Informe um número em: ${short(q.label)}`);
    answers.push([q.label, q.type === 'multi' ? v.join(', ') : q.type === 'declaration' ? 'Confirmado ✓' : v]);
  }
  const regs = await P.loadType(account, 'Inscrições');
  const lot = P.pickLot(event, regs);
  if (!lot) throw httpError(409, 'As vagas deste evento esgotaram. 💛');
  if (body.lotId && body.lotId !== lot.id) throw httpError(409, `O lote mudou: agora é ${lot.name} (${P.money(lot.price)}). Confira e envie de novo.`);
  const { coupon, price, discount } = P.applyCoupon(event, regs, lot, body.coupon);

  const now = new Date().toISOString();
  const id = 'web-' + crypto.randomUUID();
  const notes = answers.map(([k, v]) => `${short(k)}: ${v}`).join(' · ');
  const registration = {
    id, attendee, email, phone, eventId: event.id, eventName: event.name, lot: lot.name, lotId: lot.id,
    amount: price, paymentDate: '', paymentStatus: 'Pendente', paymentMethod: 'Mercado Pago',
    ...(coupon ? { couponCode: coupon.code, originalAmount: lot.price, discount } : {}),
    notes, answers: answers.map(([question, answer]) => ({ question, answer })),
    created: now, createdAt: now, createdBy: 'Inscrição online', source: 'Inscrição online', transactionId: null
  };

  if (price <= 0) {
    // Cupom de 100%: vaga confirmada como cortesia, sem passar pelo Mercado Pago.
    Object.assign(registration, { paymentStatus: 'Pago', paymentDate: P.todayBR(), paymentMethod: 'Cortesia (cupom)', amount: 0 });
    await P.saveRecord(account, 'registrations', registration, { isNew: true });
    return send(res, 200, { free: true, registrationId: id });
  }
  const origin = P.siteOrigin(req);
  const back = s => `${origin}/inscricao/${view.slug}?status=${s}&r=${encodeURIComponent(id)}`;
  const pref = await P.mp('/checkout/preferences', 'POST', {
    items: [{ id: lot.id, title: `${event.name} — ${lot.name}${coupon ? ' (cupom ' + coupon.code + ')' : ''}`.slice(0, 250), quantity: 1, currency_id: 'BRL', unit_price: price }],
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
