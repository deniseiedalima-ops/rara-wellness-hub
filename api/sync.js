// Grava no Notion um lote de alterações feitas no site (até 8 por chamada).
const { handler, send, readJson, requireSession, ensureSchema, applyOp, httpError } = require('./_lib');
module.exports = handler(['POST'], async (req, res) => {
  const { account } = requireSession(req);
  const { ops } = await readJson(req);
  if (!Array.isArray(ops) || !ops.length) throw httpError(400, 'Nenhuma alteração enviada.');
  if (ops.length > 8) throw httpError(400, 'Envie no máximo 8 alterações por vez.');
  const { titleName } = await ensureSchema();
  const results = [];
  for (const op of ops) {
    try {
      results.push(await applyOp(op, account, titleName));
    } catch (e) {
      if (e.status && e.status < 500 && e.status !== 413) throw e;
      results.push({ key: op && op.key, ok: false, error: e.message });
      if (e.status === 502 || e.status === 503) break; // problema no Notion: para o lote
    }
  }
  send(res, 200, { results });
});
