// Lê do Notion todos os registros do login atual.
const { handler, send, requireSession, ensureSchema, queryAccount, pageToRecord } = require('./_lib');
module.exports = handler(['GET'], async (req, res) => {
  const { account } = requireSession(req);
  await ensureSchema();
  const pages = await queryAccount(account);
  send(res, 200, { account, records: pages.map(pageToRecord).filter(r => r.key) });
});
