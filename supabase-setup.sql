-- RARA Wellness Club | Supabase setup
-- 1) Execute este SQL no Supabase > SQL Editor.
-- 2) Crie usuários para Denise e Maria Eduarda em Authentication > Users.
-- 3) Faça login no app (a etapa de autenticação deve ser adicionada antes de uso público).
-- IMPORTANTE: esta versão inicial usa uma linha de workspace compartilhada.
-- Restrinja SELECT/INSERT/UPDATE a usuários autenticados antes de publicar com dados reais.

create table if not exists public.rara_workspace (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.rara_workspace enable row level security;

-- Política temporária de configuração: permite acesso a usuários autenticados.
-- A aplicação deve implementar login Supabase Auth para ambas as administradoras.
create policy "Authenticated users can read RARA workspace"
on public.rara_workspace for select
to authenticated using (true);

create policy "Authenticated users can insert RARA workspace"
on public.rara_workspace for insert
to authenticated with check (true);

create policy "Authenticated users can update RARA workspace"
on public.rara_workspace for update
to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.rara_workspace;
