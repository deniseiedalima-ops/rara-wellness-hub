// Dados públicos de um evento para a página de inscrição (sem login).
const { handler, send, httpError } = require('./_lib');
const P = require('./_public');
module.exports = handler(['GET'], async (req, res) => {
  const slug = String((req.query && req.query.slug) || new URL(req.url, 'http://x').searchParams.get('slug') || '');
  if (!slug) throw httpError(400, 'Evento não informado.');
  const account = P.publicAccount();
  const ev = await P.findEventBySlug(account, slug);
  if (!ev) throw httpError(404, 'Inscrições não encontradas ou encerradas para este evento.');
  const regs = await P.loadType(account, 'Inscrições');
  const lot = P.pickLot(ev.obj, regs);
  res.setHeader('Cache-Control', 'no-store');
  send(res, 200, P.publicEventView(ev.obj, lot));
});
