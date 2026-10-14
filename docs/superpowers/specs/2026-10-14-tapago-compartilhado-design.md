# TáPago — backend compartilhado e publicação

## Objetivo

Transformar o protótipo TáPago em um aplicativo web responsivo que várias pessoas possam usar simultaneamente, com login Google, grupos privados, atualização em tempo real, histórico confiável e página pública agregada. Entregar um repositório GitHub público próprio e, quando as verificações de produção permitirem, o link curto `https://saiunodf.com/tapago/`.

## Limites e isolamento

- O TáPago terá repositório próprio `YNSANUZ/tapago`; o repositório raiz atual e os demais aplicativos não entram no push.
- Não reutilizar banco, autenticação, configuração ou dados de NEXO Contas nem qualquer projeto Supabase já existente.
- Desenvolver primeiro contra Supabase local. Produção terá projeto Supabase dedicado em organização separada, após verificar disponibilidade do plano, custo e limites. Nenhum projeto existente será alterado.
- Hospedar apenas os arquivos públicos do TáPago em `/tapago/`. Não editar `/contas/`, dados do portal, rotas globais ou arquivos partilhados. Se a rota exigir mudança fora da nova pasta, preparar backup e alteração isolada e verificar antes de aplicar.
- O repositório público contém código, migrações, testes, documentação pública e `.env.example`; nunca credenciais, tokens, dados reais, backups ou a documentação interna geral do Saiu no DF.
- Dados de demonstração do `localStorage` não serão migrados para a nuvem.

## Caminho de uso

1. Uma pessoa entra com Google e cria uma lista (taxa, contas domésticas, outra lista ou gastos pessoais recorrentes).
2. A administradora cadastra participantes por nome e valor, inclusive antes de eles terem conta. Cada perfil sem conta continua sem acesso autenticado.
3. Para vincular alguém, a administradora cria um convite individual ligado ao e-mail convidado e compartilha o link. O link tem token aleatório de uso único, guardado apenas em hash no banco, expira em sete dias e pode ser revogado. A aceitação exige login Google com o e-mail verificado correspondente; nome igual nunca concede acesso. O aceite vincula o UID do provedor ao perfil existente, preservando o histórico. Depois disso a foto de perfil Google substitui o avatar neutro no mesmo tamanho.
4. Ao voltar a entrar, a pessoa vê seus grupos ativos. Remover alguém revoga o acesso atual ao grupo e ao histórico; confirmações passadas continuam registradas.
5. Participante consulta o grupo, acessa o histórico autorizado e pode enviar “Já paguei”. O aviso é separado do estado pago e aparece para administradores. A administradora confirma ou rejeita o aviso; só a confirmação altera o total recebido.
6. Mudanças autorizadas são persistidas no banco e notificadas aos membros conectados; todos atualizam a tela a partir do registro salvo no banco. A página pública recebe somente atualizações agregadas.

## Arquitetura

- Frontend web estático, preservando a direção visual aprovada e extraindo módulos menores do JavaScript atual quando necessário.
- Supabase Auth para Google OAuth; PostgreSQL como fonte de verdade; RLS em todas as tabelas expostas; funções RPC transacionais para convites, aceite, aviso, confirmação, edição monetária e criação idempotente de períodos. Supabase Realtime notifica clientes autorizados. Mensagens de tempo real não substituem registros persistidos.
- Tabelas conceituais: `profiles`, `groups`, `memberships`, `invitations`, `fee_participants`, `monthly_contributions`, `payment_notices`, `payment_events`, `expense_templates`, `expense_occurrences` e `public_shares`. IDs de usuário são UIDs autenticados; valores monetários são `integer` em centavos; data/hora são timestamps com timezone.
- Mudanças persistentes são atômicas e rejeitam chamadas sem papel/pertencimento apropriado. Administrador cria grupo, convida/remove integrantes, altera valores futuros e atuais ainda não confirmados, e confirma/rejeita avisos. Participante lê somente seus grupos e respectivos históricos e pode registrar seu próprio aviso. Leitura pública não concede associação.
- Perfil Google e e-mail são privados. Nunca salvar token OAuth do Google. O avatar usa URL do perfil autenticado apenas em páginas de membros.

## Página pública

- A administradora ativa ou desativa uma página pública por grupo. Slug/token é aleatório, exclusivo e revogável; o identificador interno do grupo não serve como autorização.
- `/tapago/{slug}` apresenta nome e descrição do grupo, vencimento, totais previstos/recebidos/pendentes e quantidade paga. A chave PIX só aparece se estiver habilitada para publicação pública.
- Não expõe nomes, e-mails, avatares, valores individuais, avisos, autores, confirmações nem histórico mensal. A consulta pública é uma função/projeção com campos agregados permitidos e RLS; o cliente anônimo não assina tabelas privadas.
- Atualização pública em tempo real contém somente resumo agregado. Link pode ser revogado sem remover o grupo ou afetar membros.

## Valores e histórico

- Contribuições são armazenadas em centavos e associadas a um grupo, participante e mês. Totais são derivados da soma dos registros do mês, não de contadores incrementais.
- A edição de valor não altera períodos encerrados/confirmados. Cada confirmação grava valor confirmado, data/hora e UID/nome de exibição do autor como evento append-only. Edição posterior do valor padrão nunca reescreve evento ou snapshot anterior.
- O histórico mensal e seus detalhes são acessíveis somente aos integrantes autorizados. Registros históricos de pagamentos não são deletados ao remover perfil.
- Cada despesa recorrente tem um período por mês, com unicidade `(expense_id, year_month)`. A criação do período é idempotente: ao entrar no novo ciclo no dia configurado, o pagamento inicia como pendente; se já estiver pendente não se cria duplicata nem contador `+1`. Períodos antigos permanecem no histórico. Datas usam `America/Sao_Paulo` e vencimentos 29–31 se ajustam ao último dia do mês.

## Interação e estados

- A primeira versão cobre convites, aceite, avisos de pagamento, confirmação/rejeição, atualizações de grupo e atividade recente para ações financeiras. Não inclui chat livre, pagamentos bancários/PIX automáticos ou processamento de dinheiro.
- Status: pago `#16834A`, pendente `#969696`, vence hoje `#C77708`, vencido `#D23D3D`; texto acompanha cor. Interface branca, minimalista, responsiva, sem gradientes, cartões coloridos ou dashboards complexos.
- A reconexão carrega o estado persistido mais recente e restabelece a assinatura. Se Realtime falhar, leituras e gravações continuam por HTTPS e a interface informa o estado de conexão sem declarar atualização ao vivo.

## Operação e publicação

- Supabase CLI/local será a base para migrações repetíveis e teste das políticas. Segredos locais entram em `.env`, ignorado por Git; apenas nomes vazios aparecem em `.env.example`.
- Publicação do repositório GitHub é separada da publicação do site. O código e migrações serão revisados para segredos e arquivos da pasta pai antes do push público.
- Publicação de `https://saiunodf.com/tapago/` exige confirmar a rota/raiz ativa, baixar e calcular hash dos arquivos atuais afetados, criar backup datado, preparar nova pasta e publicar somente arquivos do TáPago. Nenhum arquivo de `/contas/` será sobrescrito. Validar URL em celular/computador, OAuth, RLS, página pública, histórico e respostas HTTP após deploy; registrar rollback.
- A configuração do provedor Google no Supabase requer Client ID/Secret e URLs de callback do domínio final. Segredos são configurados no painel/ambiente e nunca entram no Git. Email de convite será inicialmente compartilhado pelo administrador por link, sem integração de envio externo.

## Critérios de aceitação

1. Duas sessões autenticadas independentes veem o mesmo grupo e recebem mudanças persistidas sem recarregar manualmente.
2. Login Google e entrada por convite validam token único, expiração, revogação e e-mail; nomes iguais com e-mail diferente não vinculam contas.
3. Participante não consegue editar valores nem confirmar; pode criar seu aviso uma vez por período. Administrador consegue confirmar/rejeitar; atualizações e totais refletem de forma idempotente.
4. Exemplo de dez participantes (sete × R$ 50, três × R$ 30) soma R$ 440; cálculos continuam corretos para valores não inteiros em reais, pois são centavos.
5. Confirmação guarda valor, data e autor. Alterar o valor futuro não muda meses históricos.
6. Novo período recorrente aparece pendente no mês do vencimento; execução repetida não duplica período. Um período pendente anterior não aumenta contagem.
7. Cliente anônimo não lê tabelas privadas nem identificadores pessoais, mas consegue ver o resumo agregado e suas atualizações; revogar slug bloqueia o acesso público.
8. `/contas/` responde como antes e não recebe arquivos/rotas compartilhadas do TáPago.
9. Repositório público contém somente arquivos TáPago revisados, sem segredos ou dados reais. Link publicado serve a aplicação e os principais fluxos funcionam em largura móvel e desktop.

## Riscos e decisões operacionais

- A conta do Supabase ainda precisa ser conferida para confirmar limite de projeto e custo da organização dedicada; não reutilizar projeto existente.
- OAuth Google e acesso ao Hostinger podem exigir configuração pelo titular; se credenciais administrativas não estiverem disponíveis, concluir tudo localmente e preparar artefatos e instruções sem inventar segredo.
- Regras de reembolso e pagamento parcial ficam fora da primeira versão; confirmações são totais por participante.
- O caminho `/tapago/` é tratado como pedido de publicação no domínio `saiunodf.com`; toda publicação obedece o procedimento de backup/validação do manual e preserva NEXO Contas.
