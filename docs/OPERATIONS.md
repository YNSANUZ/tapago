# Operação e publicação do TáPago

## Ambientes e segredos

- Use um projeto Supabase dedicado ao TáPago. Nunca conecte outro site ou projeto Supabase existente.
- No browser, configure somente `VITE_SUPABASE_URL` e a chave pública `VITE_SUPABASE_ANON_KEY` (ou publishable key). RLS precisa permanecer habilitada; `service_role` nunca vai ao navegador, CI ou Git.
- Cadastre Google OAuth como cliente exclusivo do TáPago. Configure a URL de retorno exibida pelo Supabase e permita `https://saiunodf.com/tapago/` em Site URL/redirect URLs.
- Configure o `.env` apenas em ambiente local e variáveis de ambiente privadas no processo de build/publicação. O `.env.example` fica sem valores.

## Banco e validação

As migrações em `supabase/migrations/` são a fonte revisável do esquema. Rode `npm ci`, `npm test`, `npm run build` e `npm run test:e2e`. Os testes de SQL executam em PGlite e não aplicam migrações em uma conta remota. Ao provisionar um novo projeto exclusivo, inspecione as migrações e aplique-as somente nesse projeto; valide Google Auth, duas sessões independentes, RLS, Realtime, convite, confirmação e página pública antes de habilitar uso real.

## Publicação no site Saiu no DF

1. Confirme a origem atual e o hash da configuração de Hostinger; faça backup datado dos arquivos existentes que seriam afetados. A publicação fica limitada a `public_html/portal/tapago/`.
2. Gere `npm run build` com a URL e a chave pública do projeto dedicado, e copie somente o conteúdo de `dist/` para essa pasta. Não altere `public_html/portal/contas/`, `.htaccess` do portal ou outros arquivos compartilhados.
3. Verifique `https://saiunodf.com/tapago/`, recarga em `/tapago/<slug>`, login Google, convite, fluxo de confirmação, histórico, link público e visualização em celular.
4. Compare os hashes remotos aos artefatos publicados e confirme que `/contas/` continua com os hashes anteriores.

## Reversão

Remova apenas os arquivos novos de `public_html/portal/tapago/` e restaure o backup datado daquela mesma pasta. Não restaure snapshots antigos da raiz compartilhada. Desative o link público no aplicativo antes de excluir o projeto Supabase; preserve os registros e o projeto até validar a reversão.

## Limitações até provisionar o ambiente

Sem variáveis Supabase o app abre a prévia fictícia em memória. Isso não grava nem sincroniza dados. Google Auth, compartilhamento entre pessoas, link público e Realtime exigem projeto exclusivo configurado e teste real das credenciais OAuth.
