// Encerra a sessão. Não apaga nenhum dado.
const { handler, send, clearSessionCookie } = require('./_lib');
module.exports = handler(['POST'], async (req, res) => {
  clearSessionCookie(res);
  send(res, 200, { ok: true });
});
