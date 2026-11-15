// Situação de uma inscrição (usado na tela de retorno do pagamento).
const { handler, send, httpError } = require('./_lib');
const P = require('./_public');
module.exports = handler(['GET'], async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const id = String(q.r || '');
  if (!/^web-[0-9a-f-]{36}$/.test(id)) throw httpError(400, 'Inscrição inválida.');
  const row = await P.findRecord(P.publicAccount(), 'registrations', id);
  if (!row) throw httpError(404, 'Inscrição não encontrada.');
  send(res, 200, { status: row.obj.paymentStatus, firstName: String(row.obj.attendee || '').split(' ')[0] });
});
