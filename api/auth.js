// Recebe o login do Google, confere se o e-mail é autorizado e abre a sessão.
const { handler, send, readJson, verifyGoogleCredential, setSessionCookie, accountFor } = require('./_lib');
module.exports = handler(['POST'], async (req, res) => {
  const { credential } = await readJson(req);
  const email = await verifyGoogleCredential(credential);
  setSessionCookie(res, email);
  send(res, 200, { email, account: accountFor(email) });
});
