// Retorna quem está logado (ou 401).
const { handler, send, requireSession } = require('./_lib');
module.exports = handler(['GET'], async (req, res) => {
  send(res, 200, requireSession(req));
});
