# RARA | Management Hub

## Navegação
- As abas principais funcionam como navegação interna e também atualizam a rota na barra de endereço (`#dashboard`, `#finance`, etc.).
- As páginas internas de cada evento mantêm a seleção ao adicionar tarefas.

## O que está incluído
- Dashboard com contador para The Soft Reset (05/12/2026).
- Financeiro: receitas, despesas, categorias, status, fluxo mensal e exportação CSV.
- Ideias: mural por categorias.
- Eventos: cadastro de eventos, páginas internas e checklists por página.
- Instagram: banco de ideias, formato, pilar, data de publicação, status e link do post.
- Checklist: subabas/cadernos com post-its, descrição, prioridade, prazo e conclusão; tarefas pendentes aparecem no Dashboard.
- Links: biblioteca de links salvos com título, URL, categoria, observação, busca, copiar e abrir em nova aba.

## Abrir localmente
Abra `index.html` em um navegador. No modo local, os dados ficam salvos no navegador usado.

## Publicar na Vercel
1. Crie um repositório GitHub e envie `index.html` e `supabase-setup.sql`.
2. Na Vercel, importe o repositório. Para este protótipo estático, não é necessário build command; o `index.html` será servido na raiz.
3. Crie um projeto no Supabase e execute `supabase-setup.sql` no SQL Editor.
4. Copie Project URL e a chave pública anon/publishable.
5. Abra o app, clique em “Configurar sincronização online” e informe as credenciais.

## ATENÇÃO — antes de usar com informações reais
Esta entrega é um protótipo funcional de interface e gestão. A sincronização Supabase está preparada, mas a autenticação de Denise e Maria Eduarda ainda precisa ser implementada antes de abrir o acesso pela internet. Não habilite políticas públicas/anon para dados financeiros. Use Supabase Auth, convide as duas contas e restrinja as policies a usuários autenticados autorizados. Não compartilhe a chave `service_role`.
