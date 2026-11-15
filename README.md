# RARA Management Hub — login Google + banco de dados no Notion

## O que mudou nesta versão

- **Login com Google**: só os e-mails autorizados entram (ex.: `rarawellnessclub@gmail.com`).
- **Banco de dados no Notion**: cada lançamento, inscrição, compra, ideia, evento, post, link, checklist e parceiro vira uma linha numa tabela do Notion.
- **Dados por login**: cada conta vê e grava somente os próprios dados. Quem entra com o mesmo login, em qualquer aparelho, vê as mesmas informações.
- **Nenhum dado é apagado**:
  - O navegador continua guardando tudo, como antes. O site só *copia* os dados para o Notion.
  - Ao abrir o site, ele guarda automaticamente as 5 últimas versões dos dados deste navegador.
  - Antes da primeira sincronização, é feita mais uma cópia de segurança.
  - Excluir algo no site **não apaga a linha no Notion**: ela só fica marcada na coluna **Excluído**, com todos os dados preservados.
  - Se o mesmo registro foi editado em dois aparelhos, vale a versão do Notion, e a versão do navegador fica guardada como backup.
  - Novos botões: **Baixar backup completo** e **Restaurar / juntar backup**. Restaurar só acrescenta o que estiver faltando e nunca apaga nem sobrescreve.
- **Quem lançou cada dado**:
  - Na primeira vez que o site é aberto em cada aparelho, ele pergunta "Quem está usando?" (Denise ou Maria Eduarda) e guarda a resposta naquele aparelho.
  - Dá para trocar clicando no nome no topo do site.
  - Cada registro novo mostra "Lançado por" e, quando editado, "editado por", com data e hora. Isso aparece no site e nas colunas **Lançado por / Editado por** do Notion.
  - O que já existia antes desta função aparece como "Lançado antes do controle de autoria".
- O código antigo do Supabase foi removido. Ele substituía os dados do navegador ao conectar.

## Arquivos do projeto (todos na raiz do projeto da Vercel)

```
index.html      → o painel (área interna)
inscricao.html  → página pública de inscrição das clientes
api/            → funções do servidor (login, Notion e Mercado Pago)
vercel.json     → tempo máximo das funções
README.md       → este guia
```

---

## Passo 1 — Criar a conta Gmail `rarawellnessclub@gmail.com`

1. Abra uma **janela anônima** e acesse https://accounts.google.com/signup
2. Preencha **Nome:** `RARA` e **Sobrenome:** `Wellness Club`. Depois, informe a data de nascimento e o gênero.
3. Em "Como você quer fazer login", escolha **Criar seu próprio endereço do Gmail** e digite `rarawellnessclub`.
   - Se o nome já estiver em uso, escolha outro (ex.: `rarawellnessclub.oficial`) e use esse endereço em todos os passos abaixo.
4. Crie uma senha forte e guarde-a num lugar seguro.
5. Confirme o número de celular (de Denise ou Maria Eduarda) e coloque um e-mail de recuperação.
6. Aceite os termos.
7. Recomendado: ative a verificação em duas etapas em https://myaccount.google.com/security

## Passo 2 — Criar o "ID do cliente" do login Google (gratuito)

Entre no Google com a conta `rarawellnessclub@gmail.com`.

1. Acesse https://console.cloud.google.com
2. No topo, clique em **Selecionar projeto → Novo projeto**. Use o nome `RARA Hub` e clique em **Criar**. Depois, selecione o projeto criado.
3. No menu, vá em **APIs e serviços → Tela de consentimento OAuth** (às vezes aparece como **Google Auth Platform**) e clique em **Começar**:
   - **Nome do app:** `RARA Hub` · **E-mail de suporte:** `rarawellnessclub@gmail.com`
   - **Público:** Externo
   - **Dados de contato:** `rarawellnessclub@gmail.com` → aceite e clique em **Criar**
4. Em **Público**, clique em **Publicar app**. O login usa só nome e e-mail, então não precisa de verificação do Google.
   - Outra opção é deixar em "Teste" e incluir cada e-mail que vai entrar em **Usuários de teste**.
5. Vá em **Clientes → Criar cliente**:
   - **Tipo de aplicativo:** Aplicativo da Web · **Nome:** `RARA Hub site`
   - **Origens JavaScript autorizadas:** clique em **Adicionar URI** e cole o endereço do site, por exemplo `https://seu-site.vercel.app`. Se tiver domínio próprio, adicione também.
   - Clique em **Criar** e copie o **ID do cliente**, que termina em `.apps.googleusercontent.com`. A chave secreta não é necessária.

## Passo 3 — Conectar o Notion (o banco já foi criado)

O banco **RARA · Dados**, com todas as colunas e visualizações, já está pronto no Notion da conta `rarawellnessclub@gmail.com`:
- Página: https://app.notion.com/p/419ead68160481b8be7fef76d13a876c
- Banco: https://app.notion.com/p/419ead681604816ca3feef0cbe6cfb61
- ID do banco (para a Vercel): `419ead681604816ca3feef0cbe6cfb61`

1. Com a conta da RARA logada no Notion, acesse https://www.notion.so/profile/integrations e clique em **+ Nova integração**:
   - **Nome:** `RARA Hub` · **Workspace:** Espaço de Rara Wellness Club · **Tipo:** Interna → **Salvar**.
   - Na aba **Configuração**, mantenha marcadas as opções **Ler conteúdo**, **Atualizar conteúdo** e **Inserir conteúdo**.
   - Clique em **Mostrar** ao lado de **Segredo de integração interna** e copie o código (começa com `ntn_`). Não compartilhe com ninguém.
2. Abra a página **RARA Hub** (link acima). No canto superior direito, clique em **•••** → **Conexões** → procure **RARA Hub** → **Confirmar**.
   - Ao conectar a página, o banco que está dentro dela também fica acessível.

## Passo 4 — Configurar a Vercel

1. No projeto da Vercel, vá em **Settings → Environment Variables** e crie as variáveis abaixo (marque Production, Preview e Development):

| Nome | Valor |
|---|---|
| `GOOGLE_CLIENT_ID` | o ID do cliente do Passo 2 |
| `ALLOWED_EMAILS` | `rarawellnessclub@gmail.com` (para mais de um e-mail, separe por vírgula) |
| `SESSION_SECRET` | uma sequência longa e aleatória com 40 caracteres ou mais (não compartilhe) |
| `NOTION_TOKEN` | o segredo `ntn_...` do Passo 3 |
| `NOTION_DATABASE_ID` | `419ead681604816ca3feef0cbe6cfb61` |
| `SHARED_WORKSPACE` | *(opcional)* deixe vazio. Se Denise e Maria Eduarda forem entrar com e-mails pessoais diferentes e quiserem ver os mesmos dados, coloque `rarawellnessclub@gmail.com` aqui. |

2. Envie os arquivos desta pasta para o projeto: `index.html`, a pasta `api/` e `vercel.json`. Faça isso do mesmo jeito que o site é publicado hoje (GitHub ou upload). A pasta `api/` precisa ficar **ao lado** do `index.html`.
3. Vá em **Deployments → ••• → Redeploy**.

## Passo 5 — Primeira sincronização (no navegador que tem os dados)

**Faça isso no computador ou celular onde as inscrições e os pagamentos foram registrados.**

1. Abra o site publicado. No menu lateral, clique em **Baixar backup completo** e guarde o arquivo `.json`.
2. Clique em **Conta & sincronização → Fazer login com o Google** e entre com `rarawellnessclub@gmail.com`.
3. Aguarde até aparecer **Sincronizado**. Na primeira vez, todos os registros são enviados, o que leva cerca de 1 minuto. Dá para usar o site enquanto isso.
4. Confira no Notion: filtre **Tipo = Financeiro**. Devem aparecer **46 linhas**, com receitas de **R$ 2.619,76** e despesas de **R$ 4.827,04** (valores do CSV de 15/11).
5. Nos outros aparelhos, basta entrar com o mesmo login: os dados aparecem.
   - Se algum outro aparelho tiver registros que só existem nele, eles também são enviados quando a pessoa entrar.

## Dicas para o Notion

- O banco já vem com as abas **💰 Financeiro, 🎟️ Inscrições, 🛍️ Compras, 📅 Eventos, 🤝 Parceiros, 🗂️ Tudo (ativos)** e **🗑️ Excluídos (recuperação)**, sem as colunas técnicas.
- Não edite nem apague as colunas técnicas **Dados, Hash, Chave, Conta, Ordem e Excluído**: o site depende delas.
- **Edite os registros pelo site.** As colunas visíveis do Notion são um espelho: mudanças feitas direto no Notion não voltam para o site.
- Para recuperar algo excluído, use o backup `.json` em **Restaurar / juntar backup**, ou desmarque **Excluído** no Notion e peça ajuda para reimportar.

## Se algo der errado

- **"O login ainda não foi configurado"**: falta alguma variável na Vercel, ou o redeploy não foi feito.
- **Botão do Google não aparece / erro "origin_mismatch"**: o endereço do site não está em *Origens JavaScript autorizadas* (Passo 2.5).
- **"O Notion não encontrou o banco"**: a integração não foi adicionada em **Conexões** na página RARA Hub (Passo 3.2).
- Em qualquer erro, os dados **continuam salvos no navegador**. Corrija a configuração e clique em **Sincronizar agora**.

---

## Página de inscrição para clientes + pagamento Mercado Pago

Cada evento pode ter uma página pública, por exemplo `https://rara-wellness-hub.vercel.app/inscricao/the-soft-reset`. A cliente vê só essa página: as informações do evento, o formulário e o pagamento por Pix ou cartão de crédito no Mercado Pago. O painel interno não aparece para ela.

**Como funciona**
1. A cliente preenche o formulário do evento. Nome, WhatsApp e e-mail são sempre pedidos; o resto vocês montam (veja "Montar o formulário").
2. Ela é levada ao Mercado Pago com o preço do lote atual. O preço é sempre calculado pelo servidor, então não dá para alterar.
3. A inscrição aparece na hora em **Inscrições** como *Pendente* e marcada como "online".
4. Quando o pagamento é aprovado, o Mercado Pago avisa o site sozinho:
   - a inscrição vira **Pago**;
   - a receita entra no **Financeiro** com o valor **líquido** recebido. As observações guardam o valor pago e o número do pagamento.
5. Se houver reembolso, a inscrição fica como *Reembolsado* e a receita é marcada como excluída. Ela continua guardada no Notion.

**Lotes**
- A página mostra o primeiro lote que ainda tem vagas e está dentro da data.
- Ao esgotar ou vencer, passa sozinha para o próximo.
- Uma inscrição que está pagando segura a vaga por 60 minutos.
- Quando todos os lotes acabam, a página mostra "Vagas esgotadas".

**Configurar um evento**
1. No painel, vá em **Eventos**, escolha o evento e clique em **Criar página** (ou **Configurar**).
2. Marque **Inscrições abertas** e confira o endereço.
3. Escreva o texto de apresentação.
4. Cadastre os lotes (nome, preço, vagas, data final) e monte o formulário.
5. Opcional: escreva uma mensagem de confirmação e coloque o link do grupo de WhatsApp.
6. Clique em **Salvar**. Use **Copiar link** para colocar na bio do Instagram ou mandar no WhatsApp.
- O painel precisa estar conectado em **Conta & sincronização** para a página receber as configurações.


**Mensagem inicial**

É o texto que aparece no topo da página, antes das perguntas. Cada evento já começa com o texto da RARA ("Uma experiência para desacelerar…"), com data, horário, local e formas de pagamento. Edite à vontade para cada evento.

**Montar o formulário**

Cada evento já começa com o modelo da RARA, dividido em quatro seções:
1. **Informações pessoais:** nome completo, WhatsApp, e-mail e idade.
2. **Experiência RARA:** o que espera viver e como conheceu a RARA.
3. **Alimentação e cuidados:** restrição alimentar (Sim/Não) e, se a resposta for Sim, "qual (quais) seria(m)?".
4. **Confirmação de inscrição e pagamento:** as duas declarações para marcar e, logo depois, o botão de pagamento.

O que dá para fazer:
- Editar, apagar, reordenar (↑ ↓) e criar perguntas e seções.
- As perguntas de **nome, WhatsApp e e-mail** podem ter o texto e a posição alterados, mas não podem ser apagadas, porque o pagamento precisa delas.

Tipos disponíveis:
- **Seção:** título e descrição; cada seção vira um bloco na página.
- **Resposta curta**, **Resposta longa** ou **Número**
- **Escolha única** ou **Várias escolhas:** separe as opções com `;`.
- **Sim / Não**
- **Declaração:** uma caixinha para marcar.
- **Texto informativo:** um bloco de texto sem resposta.

Para uma pergunta só aparecer quando outra tiver certa resposta, use **"Mostrar só se a pergunta… tiver a resposta…"**.

**Cupons de desconto**

Em cada evento, na janela **Configurar**, cadastre:
- o código (ex.: `RARA10`);
- o desconto em % ou em R$;
- se quiser, um limite de usos e uma data de validade.

Na página, a cliente digita o cupom e clica em **Aplicar**. O valor muda na hora, e o Mercado Pago já cobra com o desconto. Os códigos nunca aparecem para quem não os tem.

Um cupom de **100%** confirma a vaga como **cortesia**, sem passar pelo pagamento.

Na aba Inscrições aparecem o cupom usado e o valor original.

**Aba Inscrições e Dashboard**
- Todas as inscrições ficam na aba **Inscrições**, tanto as online quanto as manuais.
- Os filtros disponíveis são: evento, status (Pago, Pendente ou Reembolsado), origem (online ou manual), período (de/até), valor (de/até) e busca por participante.
- A lista pode ser ordenada por data, por valor ou por nome.
- O PDF baixado respeita os filtros escolhidos.
- O **Dashboard** mostra um resumo: inscritas, pagas, pendentes, valor recebido, as últimas inscrições e o total por evento.

### Passo extra — credencial do Mercado Pago (uma vez só)
1. Entre na conta Mercado Pago da RARA e acesse https://www.mercadopago.com.br/developers/panel/app
2. Clique em **Criar aplicação**:
   - **Nome:** `RARA Hub`
   - **Tipo de solução:** Pagamentos online
   - **Produto:** Checkout Pro
   - Clique em **Criar aplicação**.
3. Na aplicação, abra **Credenciais de produção**.
   - Se o Mercado Pago pedir, preencha os dados do negócio e ative as credenciais.
4. Copie o **Access Token**, que começa com `APP_USR-`. **Não compartilhe com ninguém.**
5. Na Vercel, abra **Settings → Environment Variables** e crie `MP_ACCESS_TOKEN` com esse valor (tipo Secret, ambiente Production).
6. Não precisa configurar webhooks no Mercado Pago: o site informa o endereço de aviso em cada pagamento.

**Teste recomendado antes de divulgar:**
- Crie um evento de teste com um lote de R$ 1,00 e faça uma inscrição pagando por Pix.
- Confira se ela vira **Pago** e entra no Financeiro.
- Depois, exclua o teste no painel.

**Arquivos novos desta parte:** `inscricao.html` e, dentro de `api/`, os arquivos `_public.js`, `public-event.js`, `public-register.js`, `public-coupon.js`, `public-status.js` e `mp-webhook.js`. O `vercel.json` também mudou.
