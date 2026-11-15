// Informa ao site se o login e o Notion já foram configurados na Vercel.
const { handler, send } = require('./_lib');
module.exports = handler(['GET'], async (req, res) => {
  const has = n => !!String(process.env[n] || '').trim();
  send(res, 200, {
    googleClientId: has('GOOGLE_CLIENT_ID') ? process.env.GOOGLE_CLIENT_ID.trim() : null,
    ready: ['GOOGLE_CLIENT_ID', 'ALLOWED_EMAILS', 'SESSION_SECRET', 'NOTION_TOKEN', 'NOTION_DATABASE_ID'].every(has),
    missing: ['GOOGLE_CLIENT_ID', 'ALLOWED_EMAILS', 'SESSION_SECRET', 'NOTION_TOKEN', 'NOTION_DATABASE_ID'].filter(n => !has(n))
  });
});
