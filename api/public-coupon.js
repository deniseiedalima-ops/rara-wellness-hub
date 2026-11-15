// Confere um cupom e devolve o novo valor (sem revelar outros cupons).
const { handler, send, readJson, httpError } = require('./_lib');
const P = require('./_public');
module.exports = handler(['POST'], async (req, res) => {
  const { slug, code } = await readJson(req);
  if (!code || String(code).length > 40) throw httpError(400, 'Digite o código do cupom.');
  const account = P.publicAccount();
  const ev = await P.findEventBySlug(account, slug);
  if (!ev) throw httpError(404, 'Inscrições encerradas.');
  const regs = await P.loadType(account, 'Inscrições');
  const lot = P.pickLot(ev.obj, regs);
  if (!lot) throw httpError(409, 'As vagas deste evento esgotaram. 💛');
  const r = P.applyCoupon(ev.obj, regs, lot, code);
  send(res, 200, { code: r.coupon.code, original: lot.price, discount: r.discount, price: r.price,
    label: r.coupon.kind === 'percent' ? `${String(r.coupon.value).replace('.', ',')}% de desconto` : `${P.money(r.discount)} de desconto` });
});
