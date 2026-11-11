# Prompt para continuar em um chat novo

Copie o bloco abaixo no novo chat, aberto nesta mesma pasta, e troque os "[preencher]" pelos seus feedbacks.

```text
Continuando o meu gerenciador de tarefas "Minha lista de afazeres" (PWA pessoal, alternativa ao Microsoft To Do).

Antes de mudar qualquer coisa, leia o README.md desta pasta (principalmente "Estado do projeto", da v19 para trás), este PROXIMO-CHAT.md e o memory do projeto.

Onde paramos (11/11/2026):
- v19 publicada em https://brunoignr-code.github.io/tarefas/: "Só esta vez" ao mudar dia ou hora de uma tarefa que se repete (adiar pelo menu, deslizar ou notificação vale só para a ocorrência; campo novo opcional `occurrence`), Quinzenal no Repetir e no texto digitado, rodapé da janela cabendo no celular.
- 11/11: migradas do To Do 33 tarefas abertas (título e data) das listas com o mesmo nome; backup e ids para desfazer em C:\Python - local\backups-afazeres.
- v18: anotar abre a tarefa (opção em Config. › Geral), tarefa nova no topo e a tela rola até ela, pergunta "Sair sem salvar?" (Fechar, Esc, voltar do Android; Concluir/Pular salvam antes) e seletor de data e horário no modelo do To Do no Android (abas Data e Horário, relógio de ponteiro de 24 h).
- v17 corrige um defeito da v15/v16 (o sw.js com import prendia aparelhos antigos na v14.5). Regra: nunca usar import no sw.js; depois de mudar js/rules.js, sync-core.js, push-core.js ou actions-core.js, rodar `python tools/build_sw.py`.
- v16: entrar com Google (Config. › Conta › Ligar conta Google; nos outros aparelhos, "Entrar com Google") e backup diário no Google Drive feito pelo servidor depois das 3h, guardando os 30 últimos (Config. › Dados: conectar, fazer backup agora, restaurar, desconectar). Projeto Google Cloud "minha-lista-de-afazeres", app "Em produção", segredo GOOGLE_CLIENT_SECRET já cadastrado no Worker da Cloudflare.
- v15: Concluir/Adiar/Amanhã na notificação sem abrir o app; tarefa recém-anotada aparece destacada; Salvar grande no rodapé da janela da tarefa (Concluir menor); seletor único de dia e hora com abas Dia e Hora.
- v14 (design aprovado no Claude Design): tema único Folha com Modo (claro, escuro, automático) e 8 cores de destaque, logo 3 "Folha de papel", campo "Anotar…" fixo, Hoje com seções, Config. em subtelas, deslizar adia para amanhã.
- APK Android (TWA) 1.3 em C:\Python - local\apk-afazeres (chave em C:\Python - local\chaves-android, fora do repositório). Atualiza pela web; só precisa reinstalar se mudar algo de Android.
- Comecei do zero em 9/11 (tarefas apagadas, listas mantidas) e estou usando no note e em 2 celulares Android (um A55).
- Combinado: app simples (lembrete, repetição, listas, grupos, etapas), custo zero.

Ainda não confirmado no celular real: a v19 ("Só desta vez?", Amanhã da notificação mantendo a série), a v18 (anotar abrindo a tarefa, "Sair sem salvar?" no gesto de voltar, rolagem até a tarefa nova, relógio com o dedo), a atualização da v14.5 para a v17, o login com Google e o backup no Drive com a minha conta, os botões da notificação sem abrir o app e o APK instalado.

Regras:
- App no GitHub Pages; o servidor (server/worker.js) roda na Cloudflare e é implantado à parte, pelo painel no meu Chrome (endpoint /content, que mantém o banco D1, o cron e o segredo). Avise antes de mudar o formato dos dados ou o login, porque já há tarefas reais sincronizando.
- Não apague nem sobrescreva minhas tarefas. Teste só com dados descartáveis e limpe depois. Não coloque tarefas, senhas, segredos ou arquivos JSON de backup no repositório.
- Não peça nem guarde minha senha nem segredos; aceites de termos e logins são comigo.
- Ao testar atualizações, simule também um aparelho com a versão antiga já instalada, não só a instalação do zero.
- Entregue em lotes prontos e publicados, e diga claramente o que não foi testado no celular real.

Meus feedbacks de uso real:

Versão que aparece no rodapé de Config. de cada aparelho:
- [preencher]

O que funcionou bem:
- [preencher]

Bugs (aparelho, o que fiz, o que aconteceu):
- [preencher]

Login com Google e backup no Drive:
- [preencher]

Notificações (chegou com o app fechado? Concluir e Amanhã funcionaram sem abrir o app?):
- [preencher]

Atritos no dia a dia:
- [preencher]

O que senti falta, em ordem de prioridade:
- [preencher]

Visual:
- [preencher]

Primeiro organize os feedbacks por prioridade, me diga o que corrigir agora e o que fica para depois. Depois siga com o mais importante.
```
