# Minha lista de afazeres

Gerenciador pessoal de tarefas com quatro campos independentes: Quando, Até, Repetir e Lembrar.
O escopo e as regras (R1 a R12) estão no [documento de escopo](https://claude.ai/artifact/2c4hW8AsWTP1yRBnESSNKY).

Não há etapa de build nem dependências: são arquivos estáticos em HTML, CSS e JavaScript.

## Rodar no PC

Na pasta do projeto:

```bash
python -m http.server 8765 --bind 127.0.0.1
```

- App: http://localhost:8765/
- Testes das regras: http://localhost:8765/tests/index.html
- Testes do servidor (worker com SQLite em memória no lugar do D1): http://localhost:8765/tests/worker-harness.html

## Instalar no Android

O Chrome no Android só instala o app e permite o uso offline se ele estiver em HTTPS.

1. Publique esta pasta em uma hospedagem estática, como GitHub Pages ou Cloudflare Pages.
2. Abra o endereço no Chrome do celular.
3. No menu do Chrome, toque em "Adicionar à tela inicial" ou "Instalar app".
4. Em Config., no app, toque em "Ativar notificações".

A hospedagem guarda só o código. As tarefas ficam no aparelho.

### App Android (APK, desde 9/11)

A pasta `android/` gera um APK do tipo TWA (Trusted Web Activity): ele abre o endereço publicado dentro do Chrome, em tela cheia, com ícone, nome e notificações próprios. O conteúdo continua vindo do GitHub Pages, então **cada publicação chega ao celular sozinha, sem reinstalar**. Só é preciso instalar um APK novo quando mudar algo em `android/` (ícone, atalhos, versão).

- **Instalar:** copie `C:\Python - local\apk-afazeres\afazeres-1.0-twa.apk` para o celular e abra-o (o Android pede para permitir "instalar apps desconhecidos" para o app de Arquivos), ou, com o cabo e a depuração USB ligada, rode `adb install -r` com esse arquivo.
- **Dados:** o TWA usa o armazenamento do Chrome do próprio celular. Se você já usava o app pelo Chrome nesse celular, o login, as tarefas e "Receber neste aparelho" continuam valendo.
- **Tela cheia:** depende de `https://brunoignr-code.github.io/.well-known/assetlinks.json` (repositório `brunoignr-code.github.io`), que traz o SHA-256 da chave. Se a barra de endereço aparecer no topo, a verificação falhou.
- **Chave de assinatura:** `C:\Python - local\chaves-android\` (fora do repositório). Faça backup dessa pasta. Sem ela não dá para atualizar o app sem desinstalar e refazer o `assetlinks.json`.
- **Compilar:** na pasta `android/`, com `JAVA_HOME` apontando para o Java do Android Studio (`C:\Program Files\Android\Android Studio\jbr`), rode `gradlew.bat assembleRelease`. O APK sai em `android/app/build/outputs/apk/release/`. Suba `versionCode` em `android/app/build.gradle.kts` a cada APK novo.
- **Ícones:** `python tools/gerar_icones.py`, na pasta `android/`, a partir de `icons/icon-diamante-512.png`.

## Temas

Em Config., escolha entre Barquinho (claro, padrão), Diamante (escuro), Folha (claro), Marca-texto (claro) ou Sistema, que alterna entre Diamante e Barquinho.
No Marca-texto, dá para trocar a cor do destaque por uma das oito sugestões ou por qualquer outra.

As fontes ficam em `fonts/` para funcionar offline: Bitter, Manrope, Nunito, Figtree e Bricolage Grotesque, do Google Fonts (licença SIL Open Font License).

Os botões de funções que não serão feitas (Google Agenda, Importar do To Do, Hábitos, Pomodoro, listas compartilhadas) saíram na v12.

## Sincronização

Em Config. > Sincronização, crie a conta no aparelho que tem os dados e entre com ela nos outros. Entrar substitui as tarefas locais do aparelho pelas da sincronização.

O servidor (`server/worker.js`) roda em Cloudflare Workers com banco D1. A senha não sai do aparelho: ele envia ao servidor uma prova derivada com PBKDF2 (600 mil iterações). O servidor guarda só o hash dessa prova e das sessões, e bloqueia novas tentativas por 15 minutos após 5 erros. As tarefas ficam no banco sem criptografia de ponta a ponta. Na edição do mesmo campo em dois aparelhos, a mais recente vence.

## Lembretes com o app fechado

Em Config. > Lembretes com o app fechado, marque "Receber neste aparelho" em cada aparelho. É preciso estar conectado na sincronização.

- A cada minuto, um Cron Trigger do Worker procura os avisos vencidos e manda um push **sem conteúdo** para cada aparelho inscrito. Ao receber, o service worker busca em `/push/due` o título e o texto. Sem criptografia por mensagem e com a assinatura VAPID guardada por 12 horas, o envio gasta pouca CPU.
- A agenda é calculada no aparelho (`js/push-core.js`) e enviada ao servidor depois de cada sincronização, só quando muda. Ela cobre 14 dias, com no máximo 250 avisos.
- Se o app estiver aberto na tela, ele mesmo avisa, e o push não repete o aviso.
- Vários lembretes por tarefa, "Insistir até eu reagir" (a cada 5, 10, 15 ou 30 min, até 12 vezes) e resumo diário com as tarefas de Hoje. O resumo e o intervalo valem para a conta toda.
- O par de chaves VAPID é criado pelo próprio Worker e guardado no D1. As tabelas `push_subs` e `push_queue` também são criadas sozinhas.
- O Worker precisa do Cron Trigger `* * * * *`, configurado na implantação.

## Limitações desta versão

- Sem sincronização, cada aparelho tem dados próprios, e limpar os dados do navegador apaga as tarefas. Faça backups.
- Com o app fechado, tocar em Concluir ou Adiar abre o app para registrar a ação.
- Sem widget Android, Google Agenda, listas compartilhadas ou importação direta do To Do.

## Estado do projeto (9 de novembro de 2026)

### v12, 9 de novembro: listas, ações e Config.

- **Listas:** menu ⋯ em cada lista (na tela Listas e no topo da lista) com editar, ordenar, mostrar e limpar concluídas, selecionar, duplicar, organizar e excluir. A lista ganhou emoji e cor. Ao excluir, você escolhe se as tarefas vão para a Entrada, para outra lista ou para a Lixeira. Aviso de nome repetido.
- **Organizar listas:** mudar a ordem com ↑ e ↓, criar grupo marcando as listas, renomear grupo, desfazer grupo (as listas ficam) e nova lista já dentro do grupo.
- **Dentro da lista:** ordenar por minha ordem, data, prazo, importância, título ou criação; seção "Concluídas (n)" recolhível, com reabrir.
- **Tarefas:** botão ⋯ em cada tarefa (também botão direito no note e toque longo no celular) com concluir, abrir, estrela, fazer hoje, fazer amanhã, tirar a data, mover para outra lista (ou para uma lista nova), duplicar, selecionar várias e excluir. No celular, deslizar para a direita conclui e para a esquerda manda para a Lixeira, sempre com Desfazer.
- **Seleção de várias tarefas:** botão "Selecionar" em Hoje, nas listas, Importantes, tags e Concluídas; concluir, mandar para hoje, estrela, mover e excluir de uma vez.
- **Detalhes da tarefa:** mostra quando foi criada e concluída, tem Duplicar e Reabrir, e avisa antes de fechar com alterações não salvas.
- **Concluídas:** abrir a tarefa, reabrir, apagar registros do histórico das repetições e "Limpar" tudo. **Lixeira:** mostra a data e a lista, "Restaurar tudo" e "Esvaziar"; tarefa de lista excluída volta para a Entrada.
- **Busca:** também procura no nome da lista e pode incluir as concluídas.
- **Config.:** dividida em Geral, Aparência, Avisos, Conta e Dados, com atalhos no topo. Novas opções: tela inicial, lista das tarefas novas, semana começando no domingo ou na segunda (calendário), perguntar antes de excluir, limpeza de concluídas e lixeira, e "Buscar atualização agora".
- Saíram os botões cinza sem função e o "Sincronizar agora" de Hoje (a sincronização é automática; o botão continua em Config.).
- **Formato dos dados:** as listas ganharam os campos opcionais `order`, `color`, `emoji` e `sort`. Nada foi removido nem renomeado; o login e o servidor não mudaram. As opções novas de Config. ficam só no aparelho, como as que já existiam.
- Testado no navegador, em tamanho de celular e de note, numa origem local vazia e sem login (nada chegou à sua conta), com os dados apagados depois. Os 62 testes automáticos passaram.

### APK Android (TWA) 1.0, 9 de novembro

- Item 7 do plano, pelo caminho 1 (TWA), por decisão de 9/11: fica assim até o app amadurecer o bastante para valer instalar atualizações por cabo (aí entra a casca Kotlin com alarmes nativos, caminho 2). Widget fica para depois.
- Pacote `br.afazeres.app`, nome "Afazeres" no ícone, ícone adaptável do Diamante (com versão monocromática), tela de abertura escura, ícone de notificação próprio, atalhos Nova tarefa e Próximos dias, e "Compartilhar" de outros apps.
- Criado o repositório `brunoignr-code.github.io` só com `assetlinks.json`, `.nojekyll` e um `index.html` que leva para `/tarefas/`. O verificador do Google (Digital Asset Links) respondeu `linked: true`.
- O app web e o servidor não mudaram: nada no formato dos dados nem no login.
- Feedbacks de uso real ainda não recebidos (o modelo do PROXIMO-CHAT veio sem preencher).

### v11, 9 de novembro

- Diamante virou o tema padrão, com capa própria ("lapide o dia, uma tarefa por vez") e ícone de diamante no app instalado. Os temas claros continuam com a capa do barquinho, e o ícone da aba acompanha o tema.
- O botão de concluir virou um check, que acende com a cor do tema ao concluir.
- Concluir uma tarefa que repete vai direto para a próxima, e o botão diz para quando: "a cada 3 dias às 17h", feita em 9/11, vai para 12/11 às 17h; "todo sábado 6h30" vai para o próximo sábado. Também há "Concluir e ir para a próxima" nos detalhes da tarefa. Pular ocorrência segue o calendário da série.
- Letra menor por padrão e 5 tamanhos em Config. > Aparência.
- Correção: "todo sábado 6h30" digitado criava o lembrete para o dia seguinte; agora começa no próximo sábado.
- Recomeço do zero: em 9/11 todas as tarefas (135, incluindo a Lixeira) foram apagadas no servidor, a pedido, para o teste real. As 16 listas ficaram, vazias. As tarefas abertas continuam no Microsoft To Do.

### Nome do app, 9 de novembro

- O app passou a se chamar "Minha lista de afazeres" (capa, aba e notificações). No ícone do Android aparece "Afazeres", porque o nome inteiro seria cortado. O Android pode demorar para trocar o nome de um app já instalado; reinstalar resolve.

### Lote B, publicado em 6 de novembro (app) e 9 de novembro (servidor)

- Lembretes com o app fechado (push enviado pelo servidor), ativados por aparelho em Config.
- Vários lembretes por tarefa, lembrete insistente e resumo diário.
- Formato dos dados: as tarefas ganharam os campos opcionais `extraReminders`, `insist` e `snoozedFor`. Nada foi removido nem renomeado. O login não mudou.
- Servidor implantado em 9/11 com o Cron Trigger `* * * * *`. O cron roda por volta do segundo 18 de cada minuto, o que dá cerca de 20 segundos de atraso.
- Medido na Cloudflare, numa cópia descartável do Worker: 6 ms de CPU no minuto com envio (incluindo a assinatura VAPID) e 2 ms nos minutos sem aviso. Chamadas normais ficam em torno de 4 ms.

### Lote A, publicado em 6 de novembro

- Importante (estrela e visão própria), tags com filtro e busca.
- Repetição a partir da conclusão e "terminar após N vezes".
- Modos do campo Até em Config.: A (campo único), B (dois campos) e C (fim dentro de Repetir).
- Arrastar para ordenar em Hoje e nas listas, também pelas setas do teclado.
- Datas digitadas no campo de adicionar, com prévia e opção de ignorar ("pagar luz sexta 9h", "toda segunda", "até 30/11").
- Próximos dias em Lista, Calendário, Kanban (por lista) e Matriz (importante × urgente).
- "Compartilhar para Tarefas" no Android, atalhos no ícone (Nova tarefa, Próximos dias) e teclas N e / no note.
- Correção do modo offline, que podia guardar arquivos antigos e exigir várias recargas para mostrar uma versão nova.

- **Publicado:** https://brunoignr-code.github.io/tarefas/, com o tema Barquinho como padrão e os temas Diamante, Folha e Marca-texto em Config.
- **Servidor:** Cloudflare Worker `tarefas-sync`, com banco D1 `tarefas` e Cron Trigger a cada minuto, no plano gratuito (sem custo; passar do limite faz o pedido falhar, não gera cobrança). Este PC não tem Node, então o deploy de `server/worker.js` é feito pela API do painel da Cloudflare, no Chrome do usuário. O Worker precisa ser reimplantado à parte: publicar no GitHub não o atualiza.
- **Migração:** as tarefas abertas do To Do foram para um JSON, fora do repositório, sem as tarefas de senha. Com o lembrete como referência, a data dele virou Quando.
- **Aparelhos:** 1 notebook e 2 celulares Android, um deles A55. O note é a base da sincronização.

### Testado

- Regras, cores, datas digitadas e agenda dos avisos em 62 testes automáticos.
- Ciclo completo do push numa cópia descartável do Worker e do D1, apagadas depois: agenda, cron, envio ao FCM e remoção da inscrição recusada.
- Servidor do lote B em 21 testes, no navegador, com SQLite em memória no lugar do D1: chaves VAPID, assinatura do JWT, inscrições, agenda, envio pelo cron sem repetição e remoção de aparelhos que saíram.
- Vários lembretes, insistência, adiamento e o painel de Config. no navegador, com dados de teste.
- Lote A no navegador, em tamanho de celular e de note, com dados de teste.
- Sincronização e login em dois aparelhos simulados, com credenciais descartáveis.
- Tema, capa e fonte em tamanho de celular, no navegador.

### Ainda não confirmado nos aparelhos reais

- Sincronização entre o note e os dois celulares.
- Instalação no Android e novo ícone. O Android pode demorar para trocar o ícone de um app já instalado.
- Notificações e os botões Concluir e Adiar.
- Uso sem internet no endereço publicado.
- Compartilhar de outro app, atalhos no ícone e arrastar com o dedo.
- Todo o lote B com o app fechado num celular real: chegada do push, atraso, Android em economia de bateria, Concluir e Adiar.
- A v12 no celular de verdade: deslizar com o dedo, toque longo abrindo o menu e a barra de seleção acima das abas (testados só com toque simulado).
- O APK (TWA) inteiro: não foi instalado em nenhum celular (nenhum estava no cabo). Falta ver tela cheia sem barra de endereço, ícone, tela de abertura, notificações com o ícone e o nome do app, atalhos, Compartilhar e o pedido de permissão de notificação no Android 13 ou mais novo.

### Próximos passos conhecidos

- Instalar o APK no A55 e no outro celular e conferir a lista acima. Depois, desinstalar a versão instalada pelo Chrome para não ficar com dois ícones.
- Coletar os feedbacks de uso real e ajustar.
- Item 8 do plano (usabilidade do zero).
- Ativar "Receber neste aparelho" nos celulares e fazer o "Testar com o app fechado".
- Congelar funções novas e, depois de 1 ou 2 semanas de uso, retirar o que não foi usado (candidatos: Kanban, Matriz e os modos B e C do Até). Hábitos, Pomodoro, Google Agenda, listas compartilhadas e importação do To Do foram desaconselhados por fugirem do objetivo.
- Atualizar o canvas de temas, que ainda mostra "Ajustes" e não tem o Barquinho.
- Escopo e decisões: [documento de escopo](https://claude.ai/artifact/2c4hW8AsWTP1yRBnESSNKY). O catálogo ainda traz a ordem antiga de algumas fases.

## Estrutura

- `android/`: projeto do APK (TWA). Sem código próprio além do serviço que repassa as notificações; a configuração está no `AndroidManifest.xml` e em `res/values/strings.xml`.
- `server/worker.js`: servidor de sincronização e login.
- `js/sync-core.js` e `js/sync.js`: regras de junção e conversa com o servidor.
- `js/push-core.js` e `js/push.js`: agenda dos avisos com o app fechado e inscrição do aparelho.

- `js/rules.js`: regras de datas, sem dependência de tela ou banco.
- `js/parse.js`: entende datas, horários e repetições digitadas.
- `js/theme.js`: temas e cálculos de cor do marca-texto.
- `js/db.js`: armazenamento local em IndexedDB.
- `js/app.js`: telas e interações.
- `sw.js`: cache offline, avisos recebidos por push e botões das notificações. Ao mudar a lista de arquivos, atualize `FILES` e `CACHE`. A cada publicação, suba `CACHE` e `APP_VERSION` (em `js/app.js`), que aparece no rodapé de Config.
- `tests/`: testes das regras, executados no navegador.
- `icons/`: capas (`diamante.svg`, `barco.svg`) e ícones. Os PNG do Diamante são gerados de `icon-diamante.svg` com o Chrome sem janela (`--headless --screenshot`). `tools/make_icons.py` é o gerador antigo, do primeiro ícone.
