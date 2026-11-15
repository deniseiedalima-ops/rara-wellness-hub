// Aviso do Mercado Pago. Nunca confia no conteúdo recebido: consulta o pagamento direto na API.
const { send } = require('./_lib');
const P = require('./_public');

function paymentIdFrom(req) {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const type = b.type || q.type || q.topic || '';
  if (type && !/payment/.test(type)) return null;
  const id = (b.data && b.data.id) || q['data.id'] || q.id || '';
  return /^\d{3,20}$/.test(String(id)) ? String(id) : null;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { error: 'Método não permitido.' });
    if (req.method === 'POST' && typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch { req.body = {}; } }
    const paymentId = paymentIdFrom(req);
    if (!paymentId) return send(res, 200, { ignored: true });
    const p = await P.mp('/v1/payments/' + paymentId);
    const regId = String(p.external_reference || '');
    if (!regId.startsWith('web-')) return send(res, 200, { ignored: true });
    const account = P.publicAccount();
    const row = await P.findRecord(account, 'registrations', regId);
    if (!row) return send(res, 200, { ignored: 'inscrição não encontrada' });
    const reg = row.obj;
    const now = new Date().toISOString();
    const txId = 'income-' + regId;

    if (p.status === 'approved') {
      if (reg.paymentStatus === 'Pago' && reg.mpPaymentId === String(p.id)) return send(res, 200, { ok: true, already: true });
      if (reg.paymentStatus === 'Pago' && reg.transactionId) {
        // Já confirmado à mão no painel: só anota o pagamento, sem lançar a receita de novo.
        Object.assign(reg, { mpPaymentId: String(p.id), mpStatus: p.status });
        await P.saveRecord(account, 'registrations', reg);
        return send(res, 200, { ok: true, manual: true });
      }
      const gross = Number(p.transaction_amount) || reg.amount;
      const net = Number(p.transaction_details && p.transaction_details.net_received_amount) || gross;
      const paidDate = new Date(p.date_approved || now).toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' });
      const method = P.methodLabel(p);
      Object.assign(reg, {
        paymentStatus: 'Pago', paymentDate: paidDate, paymentMethod: method, amount: gross,
        mpPaymentId: String(p.id), mpStatus: p.status, transactionId: txId, updatedBy: 'Mercado Pago', updatedAt: now
      });
      await P.saveRecord(account, 'registrations', reg);
      await P.saveRecord(account, 'transactions', {
        id: txId, type: 'income', amount: net, date: paidDate, category: 'Inscrição', status: 'Pago/Recebido',
        description: `Inscrição — ${reg.attendee} (${reg.lot})`, event: reg.eventName,
        notes: `Inscrição online · ${method} · Valor pago ${P.money(gross)} · Líquido recebido ${P.money(net)} · Mercado Pago nº ${p.id}`,
        createdBy: 'Mercado Pago', createdAt: now
      });
      return send(res, 200, { ok: true });
    }
    if (['refunded', 'charged_back', 'cancelled'].includes(p.status) && reg.mpPaymentId === String(p.id)) {
      Object.assign(reg, { paymentStatus: p.status === 'cancelled' ? 'Pendente' : 'Reembolsado', mpStatus: p.status, transactionId: null, updatedBy: 'Mercado Pago', updatedAt: now });
      await P.saveRecord(account, 'registrations', reg);
      await P.softDelete(account, 'transactions', txId);
      return send(res, 200, { ok: true });
    }
    if (reg.paymentStatus !== 'Pago' && reg.mpStatus !== p.status) {
      reg.mpStatus = p.status;
      await P.saveRecord(account, 'registrations', reg);
    }
    send(res, 200, { ok: true });
  } catch (e) {
    if (e.mpStatus === 404) return send(res, 200, { ignored: 'pagamento inexistente' });
    console.error('Webhook Mercado Pago:', e);
    send(res, 500, { error: 'falha temporária' }); // o Mercado Pago tenta de novo
  }
};
