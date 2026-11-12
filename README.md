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

- **Instalar:** copie `C:\Python - local\apk-afazeres\afazeres-1.3-twa.apk` (o mais novo) para o celular e abra-o (o Android pede para permitir "instalar apps desconhecidos" para o app de Arquivos), ou, com o cabo e a depuração USB ligada, rode `adb install -r` com esse arquivo.
- **Dados:** o TWA usa o armazenamento do Chrome do próprio celular. Se você já usava o app pelo Chrome nesse celular, o login, as tarefas e "Receber neste aparelho" continuam valendo.
- **Tela cheia:** depende de `https://brunoignr-code.github.io/.well-known/assetlinks.json` (repositório `brunoignr-code.github.io`), que traz o SHA-256 da chave. Se a barra de endereço aparecer no topo, a verificação falhou.
- **Chave de assinatura:** `C:\Python - local\chaves-android\` (fora do repositório). Faça backup dessa pasta. Sem ela não dá para atualizar o app sem desinstalar e refazer o `assetlinks.json`.
- **Compilar:** na pasta `android/`, com `JAVA_HOME` apontando para o Java do Android Studio (`C:\Program Files\Android\Android Studio\jbr`), rode `gradlew.bat assembleRelease`. O APK sai em `android/app/build/outputs/apk/release/`. Suba `versionCode` em `android/app/build.gradle.kts` a cada APK novo.
- **Ícones:** `python tools/gerar_icones.py`, na pasta `android/`, a partir de `icons/icon-folha-512.png`.

## Temas

Em Config., escolha entre Folha (claro, padrão), Diamante (escuro) e Marca-texto (claro). Barquinho e Sistema saíram em 10/11; quem usava um deles passa para a Folha. O ícone e a capa são a folha em todos os temas.
No Marca-texto, dá para trocar a cor do destaque por uma das oito sugestões ou por qualquer outra.

As fontes ficam em `fonts/` para funcionar offline: Manrope, Nunito, Figtree e Bricolage Grotesque, do Google Fonts (licença SIL Open Font License).

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
- Concluir, Adiar e Amanhã na notificação não abrem o app (desde a v15): o service worker registra no aparelho e avisa o servidor. Sem internet, a mudança sobe quando o app abrir.
- Sem widget Android, Google Agenda, listas compartilhadas ou importação direta do To Do.

## Estado do projeto (12 de novembro de 2026, v27)

### v27, 12 de novembro: aviso quando as notificações estão desligadas

Feedback de uso: o A17 instalou o app com as notificações bloqueadas e nada avisava; depois de liberar, funcionou. Só tela: sem mudança no servidor, no login ou nos dados.

- **Cartão em Hoje e no topo de Config.**, só quando há tarefas abertas com lembrete, com o motivo e o botão certo:
  - **Bloqueadas** ("Notificações bloqueadas neste aparelho · Os lembretes não vão tocar"): **Como liberar** abre os passos. No app instalado: segurar o ícone › Informações do app › Notificações. No navegador: ícone ao lado do endereço › Permissões. Inclui a dica da economia de bateria ("Sem restrições"). Nesse estado o app não pode pedir de novo.
  - **Ainda não liberadas:** **Liberar** pede a permissão e, com a conta conectada, já liga "Receber neste aparelho".
  - **Liberadas, mas só com o app aberto** (conta conectada e "Receber neste aparelho" desligado): **Ativar** liga os avisos com o app fechado.
  - **Agora não** esconde por 7 dias, só neste aparelho.
- O cartão se atualiza quando a permissão muda (pelo Android, pelo navegador ou ao voltar para o app).
- Testado no navegador (369 px), numa origem local sem conta, com dados descartáveis apagados depois: bloqueadas (o navegador do teste estava bloqueado de verdade), ainda não liberadas (simulado), em Hoje e em Config., Como liberar e Agora não; 74 testes das regras.
- **Não testado:** o caso "só com o app aberto" (precisa de conta conectada) e os passos do app instalado num celular de verdade.

### v26, 12 de novembro: avisos entre celulares que não se perdem

Feedback de uso: tarefa criada no A17 para avisar no minuto seguinte; o A55 avisou uma vez e falhou em outras três (com e sem economia de bateria, até com a tela ligada). Ao abrir o app, as tarefas estavam lá, sem notificação. **Precisa implantar o servidor** (`server/worker.js`) **antes de publicar o app**.

- **Agenda que não chegava ao servidor:** o aparelho que cria a tarefa esperava 1,5 s para sincronizar e só então mandava a agenda de avisos. Bloquear o celular ou trocar de app nesse intervalo congelava a página, e o servidor nunca soube do aviso. Agora, ao sair da tela, o app sincroniza e manda a agenda na hora (medido: 70 ms em vez de 1,5 s).
- **Agenda descartada:** uma mudança feita enquanto outra agenda estava sendo enviada (criar e logo ajustar o lembrete) era descartada até a sincronização seguinte, 60 s depois, que não roda em segundo plano. Agora ela vai logo depois do envio em andamento.
- **Requisição presa:** sincronização e agenda têm tempo limite de 20 s; antes uma conexão presa podia travar os envios até reabrir o app.
- **Agenda de aparelho atrasado apagava a dos outros (servidor):** cada envio substituía a fila inteira de avisos ainda não enviados, montada com as tarefas de quem enviou. Um aparelho desatualizado (em especial o botão Concluir, Amanhã ou Adiar de uma notificação, que roda com o app fechado e as tarefas guardadas naquele celular) apagava os avisos que outro tinha acabado de pôr. Agora:
  - a agenda vem com `since` (até onde o aparelho sincronizou); o servidor guarda o maior (`meta.pushScheduleSince`) e ignora agendas mais antigas, respondendo `stale`; o app então sincroniza e reenvia;
  - o botão da notificação troca só os avisos daquela tarefa, pelo endereço novo `/push/task` (um servidor antigo responderia 404 em vez de apagar a fila);
  - versões antigas do app (sem `since`) continuam valendo como antes.
- **Inscrição trocada pelo Chrome:** quando o Chrome renova a inscrição de push, o service worker agora se inscreve de novo e avisa o servidor sozinho. Antes, o servidor recebia "410" no endereço velho e apagava o aparelho, que só voltava a receber ao abrir o app.
- **Config. › Avisos › Últimos avisos que chegaram a este aparelho:** as 5 últimas chegadas, com o resultado ("1 aviso mostrado", "app aberto: ele mesmo avisou", "o servidor não reconheceu este aparelho", "o Chrome trocou a inscrição; renovada sozinha"). Se depois de um teste nada aparecer ali, o push não chegou ao aparelho.
- Testado no navegador: 70 testes do servidor (11 novos: agenda com `since`, aparelho atrasado ignorado, troca por tarefa, versão antiga); 74 das regras; o app com o `server/worker.js` rodando em memória numa página temporária (já apagada): criar tarefa, sair da tela logo depois, duas mudanças durante um envio lento, corrida entre dois aparelhos (a agenda atrasada foi ignorada e o app reenviou a completa), botão da notificação pelo `/push/task`, push chegando e mostrando o aviso, inscrição renovada; service worker da v25 já instalado atualizando para a v26.
- **Não testado no celular de verdade:** push real entre o A17 e o A55 (depende do Firebase/Chrome e da bateria do Android) e a renovação automática da inscrição.

### v25, 12 de novembro: grupos de botões que fecham certinho

Só tela (feedback de uso: os botões do Repetir quebravam em 4 + 2). Sem mudança nos dados, no servidor ou no login.

- **Como funciona:** os grupos de botões viraram grades de colunas iguais. Quantas colunas cabem é decidido pela largura real da área (container query), medida em `rem`; por isso acompanha o tamanho da letra de Config. › Aparência. Nunca sobra um botão sozinho nem uma linha pela metade.
- **Repetir:** Não repete, Diária, Semanal, Quinzenal, Mensal e Anual em 2 ou 3 colunas, e **Dias da semana** numa linha inteira embaixo (com 4 colunas, em tela larga e letra pequena, ele ocupa as duas casas que sobram da segunda linha).
- **Quando** e o atalho do **seletor de data** (Hoje, Amanhã, Próx. semana, Sem data): 2×2 no celular, 4 numa linha quando cabem. No lembrete, sem "Sem data": 3 numa linha, ou 2 e o terceiro na linha inteira.
- **Dias úteis · Fim de semana:** lado a lado, um em cima do outro só se não couberem. "Todos" saiu (é o mesmo que Diária).
- **Bolinhas D S T Q Q S S:** crescem com a letra (até 2,75 rem) e encolhem juntas em tela estreita; a primeira e a última ficam alinhadas às bordas dos botões.
- **Folha Anotar (celular):** Hoje · Amanhã · Repetir · lista em 2×2, e **Anotar e abrir · Anotar outra** nas mesmas duas colunas (antes 3 + 1 e larguras diferentes). Nome de lista comprido termina em "…".
- Medido no navegador em 320, 360/369, 412 px e no painel do notebook, com letra 11, 14, 16,25 e 18 px: nenhum texto cortado, nenhuma linha pela metade, nada passando da largura. Service worker da v24 já instalado atualizando para a v25.
- **Não testado no celular de verdade:** a aparência no seu aparelho, com a letra que você usa.

### v24, 12 de novembro: repetir em dias específicos da semana

Sem mudança no servidor, no login ou no formato dos dados: usa o `repeat.weekdays` (0 = domingo a 6 = sábado) que as regras já aceitavam.

- **Por que parecia não funcionar:** na janela da tarefa, os dias só apareciam depois de tocar em Semanal e vinham todos desmarcados. Marcar segunda e quarta numa quinta deixava o Quando na quinta, então a tarefa continuava em Hoje, como se nada tivesse mudado.
- **Janela da tarefa:** botão novo **Dias da semana** no Repetir (entre Semanal e Quinzenal), sem o "A cada". Ao escolher Semanal, Dias da semana ou Quinzenal, o dia do Quando (ou de hoje) já vem marcado. Atalhos **Dias úteis**, **Fim de semana** e **Todos** embaixo das bolinhas. Ao mudar os dias, o **Quando vai para o primeiro dia marcado** (o lembrete do mesmo dia vai junto) e aparece "Quando foi para seg, 16/11, o primeiro dia marcado". A conta parte do Quando escolhido (ou do que a tarefa tinha ao abrir), e não empurra a data para a frente a cada toque. Mudar só o Quando para um dia não marcado não mexe nos dias: numa tarefa que já repete, continua perguntando "Só desta vez?" (v19).
- **Folha Anotar:** o Repetir ganhou **Dias da semana…**, que abre "Repetir nos dias" com as bolinhas, os mesmos atalhos e **Pronto**. O Quando também vai para o primeiro dia marcado.
- **Texto digitado:** entende "toda segunda e quarta", "todas as terças e quintas", "segundas, quartas e sextas", "às terças", "todo dia útil", "dias úteis", "de segunda a sexta" (qualquer intervalo, como "de sexta a domingo"), "todo fim de semana", "nos fins de semana" e "quinzenal às terças e quintas". A primeira vez é o próximo desses dias (hoje, se hoje for um deles e a hora ainda não passou). "Entregar em 5 dias úteis" e "reunião segunda" continuam como antes (sem repetição).
- **Resumo da repetição:** "dias úteis" e "fins de semana" no lugar de "semanal (seg, ter, qua, qui, sex)".
- Testado no navegador, numa origem local sem conta, com dados descartáveis apagados depois: 74 testes das regras (5 novos); janela da tarefa no celular (375 px) e no notebook (1280 px, painel à direita); Dias da semana, atalhos, Quando e lembrete indo para segunda, salvar e reabrir com o botão certo, "Sair sem salvar?" ao marcar um dia, "Só desta vez?" ao mudar só a hora; folha Anotar com Dias da semana… e com o texto digitado; service worker da v23 já instalado atualizando para a v24.
- **Não testado no celular de verdade:** tocar nas bolinhas dos dias com o dedo e a folha "Repetir nos dias" com o teclado aberto atrás.

### v23, 12 de novembro: letras em harmonia e o redesenho "linha livre" em todas as telas (lotes 3 a 7)

Só tela: sem mudança no servidor, no login ou no formato dos dados das tarefas.

- **Letras (feedback de uso):** uma escala só para o app inteiro (seis tamanhos: .78, .88, 1, 1.12, 1.32 e 1.5 rem) e três pesos (500 no texto, 600 em títulos de tarefa, rótulos e botões, 700 só em títulos de tela e de cartão). Antes havia mais de 15 tamanhos e pesos até 900, o que fazia as telas parecerem de fontes diferentes. Tudo menor que na v22.
- **10 tamanhos de letra** em Config. › Aparência (antes 5), com botões A− e A+, um indicador de dez passos e uma prévia. Do menor (11 px) ao maior (18 px); o padrão é o 5 (14 px). A escolha antiga é convertida sozinha (Muito pequena → 3, Pequena → 4, Normal → 5, Grande → 7, Muito grande → 9). Fica guardada no aparelho (`textSize`), como antes.
- **Lote 3, Próximos:** cabeçalho com Lista · Calendário · Kanban; a Lista virou um ramo com um ponto por dia e a hora (ou "dia") de cada tarefa; o Calendário ficou num cartão com dias em forma de folha e um ponto nos dias com tarefas; o Kanban tem o quadradinho da lista e cada tarefa num cartão. Seletor de data e horário com a data em letra grande, dias em folha e horas e minutos em folhas.
- **Lote 4, janela da tarefa:** cabeçalho na cor de destaque com o título (que agora quebra em várias linhas; Enter continua salvando), cartões para Quando, Repetir (botões Não repete, Diária, Semanal, Quinzenal, Mensal, Anual no lugar da lista de escolha), Etapas, Notas e Mais opções, e a barra escura embaixo (Lixeira, Duplicar, Pular, Concluir e Salvar; com letra grande, Concluir fica só com o ícone). Repetir e Mais opções abrem na própria janela, e não numa folha separada como nas pranchetas, para não mexer nas regras da v18 e da v19. "Só desta vez?" mostra o de → para num ramo. Menus, Mover, Adiar e as perguntas viraram folhas de baixo.
- **Correção:** trocar de Quinzenal para Mensal (ou Anual, ou Diária) deixava "a cada 2". Agora volta para "a cada 1".
- **Lote 5, Listas:** cabeçalho com atalhos para Importantes, Tags, Concluídas e Lixeira; listas em cartões por grupo; quadradinho com o emoji ou, sem emoji, a inicial na cor da lista; "+ Nova lista" tracejado. A lista aberta tem Ordenar, Selecionar e o menu no cabeçalho. Organizar tem o botão Pronto. Tags mostra as tags como atalhos no cabeçalho. Concluídas virou um ramo por dia. Lixeira tem Restaurar tudo e Esvaziar no cabeçalho. Seleção de várias com cabeçalho e barra escuros (a barra de navegação some enquanto seleciona). As tarefas de cada tela ficam num cartão-folha só.
- **Lote 6, Busca e Config.:** a Busca tem o campo e "Incluir concluídas" no cabeçalho, e um botão de voltar para a tela anterior. Config. tem o cartão da sincronização e as cinco partes num cartão; as subtelas têm cabeçalho com "Config." para voltar; os painéis viraram cartões-folha (aparelhos conectados inclusos).
- **Lote 7, notebook:** lateral na cor de destaque; na área central, o cabeçalho fica sobre o fundo e o campo de anotar fica no alto, logo abaixo do título; a partir de 1100 px de largura, a tarefa abre num painel à direita (com a lista ainda à vista atrás de um véu leve; continua sendo uma janela, para manter o "Sair sem salvar?").
- Testado no navegador, numa origem local sem conta, com dados descartáveis apagados depois: 69 testes das regras e 59 do servidor; celular (375 px) e notebook (1280 px), claro e escuro, letra 1 e 10 sem nada passando da largura da tela; Repetir pelos botões, seletor, "Só esta vez", "Sair sem salvar?", Enter no título, menu, seleção, painel à direita; service worker da v22 já instalado atualizando para a v23, com a letra antiga convertida.
- **Não testado no celular de verdade:** a janela da tarefa com o teclado aberto (título de várias linhas e barra de baixo), a barra escura da seleção sobre a área de gestos, o Kanban rolando de lado com o dedo e o tamanho de letra 10 num celular pequeno.


### v22, 11 de novembro: redesenho "linha livre", lotes 1 e 2 (fundação, Hoje e anotar)

Segue o `ROTEIRO-REDESENHO.md`. Só tela: sem mudança no servidor, no login ou no formato dos dados.

- **Cores:** cartões em papel (`--surface` #FFFEFA) e variáveis novas `--stem` (ramo), `--bar` (barra flutuante), `--head` (cabeçalho: a cor de destaque no claro, `--banner` no escuro). As 8 cores de destaque e o modo escuro continuam valendo. O aviso de rodapé virou pílula escura nos dois modos.
- **As cinco peças** como classes: `.hero` (cabeçalho), `.leaf-card` (cartão-folha), `.ramo` (linha com folhas), barra flutuante (`.nav` no celular) e folha de baixo (`dialog`, cantos 10/34 px, alça).
- **Barra flutuante escura no celular:** Hoje · Próximos · **+** · Listas · Config. O número de tarefas continua na aba Hoje. **Busca** saiu da barra: ícone no cabeçalho de Hoje, Próximos e Listas; a tecla `/` continua. No note, a lateral é a mesma de antes (com Busca).
- **Telas de edição sem barra:** Config. por dentro e Organizar escondem a barra (têm o voltar).
- **Hoje:** cabeçalho na cor de destaque com dia da semana, data, Buscar e Selecionar; uma folha por tarefa ("2 de 6 feitas"); faixa da semana (ponto nos dias com tarefas; tocar num dia abre Próximos › Lista rolado até ele). Tarefas num **ramo tudo por horário**: atrasadas primeiro; depois feitas (hora em que foram concluídas) e abertas (hora do lembrete) misturadas; as abertas sem hora ficam na hora atual (as que vieram de dias anteriores, antes de todas). As feitas hoje aparecem no ramo (não há mais o "Feitas hoje" dobrável). O botão ⋯ continua em todas as linhas.
- **Cartão "A seguir"** no lugar da pilha de cartões de lembrete: o lembrete vencido mais antigo, com Concluir, Adiar e o X de dispensar; "e mais N" passa para o seguinte. Sem vencido, o próximo lembrete de hoje (sem X); sem nenhum, o cartão some.
- **Hoje vazia:** cartão "Nada para hoje" com "Anotar uma tarefa" e as três dicas num ramo.
- **Anotar no celular:** o campo fixo virou o **+**, que abre a folha "Anotar em <lista>" com o teclado, o "Entendi assim" em ramo, os botões de um toque e **Anotar e abrir** / **Anotar outra**. O Enter segue Config. › Geral › Depois de anotar. Fecha tocando fora, com Esc ou com o voltar do Android. Telas sem campo (Listas, Busca, Config.) anotam sem data na lista padrão. A tecla N e o atalho `?novo=1` abrem a mesma folha; no note, focam o campo fixo, que continua no rodapé até o lote 7.
- **Compartilhar do Android** agora abre a folha já com o texto (antes criava a tarefa direto); o resto do texto e o link vão para a nota, sem data e na lista padrão, como antes. Só fica criada ao tocar em Anotar.
- **Adiar:** folha nova com o horário de cada opção e, nas tarefas que se repetem, o aviso de que adiar muda só o lembrete.
- **Lembrete seguindo o Quando (correção):** ao anotar só com a hora ("pagar luz 10h"), o lembrete ia para o dia da hora (amanhã, se já tinha passado) e o Quando ficava no dia da tela (hoje em Hoje, amanhã em Próximos). Com os dois em dias diferentes, a janela da tarefa tratava o lembrete como escolhido à parte e não o mudava junto com o Quando. Agora os dois nascem no mesmo dia: em Hoje, o dia da hora; num dia futuro da tela, esse dia. Nas listas (sem data) continua só o lembrete. Tarefas já criadas assim continuam com os dias separados: ajuste o Lembrar uma vez para o mesmo dia do Quando e ele volta a acompanhar. Testado: mudar dia, hora, os dois, tarefa sem hora, repetição com "Só esta vez" e "Esta e as próximas".
- **Capa** na cor de destaque, com a folha de papel sem o quadrado do ícone (`icons/capa-folha.svg`).
- O `index.html` pede ao Chrome para encolher a página quando o teclado abre (`interactive-widget=resizes-content`), para as folhas de baixo ficarem acima do teclado.
- Testado no navegador (celular 375 px e note 1280 px, claro e escuro, Roxo com letra Muito grande, sem nada cortado nem rolagem lateral), numa origem local sem conta, com dados descartáveis apagados depois: 69 testes das regras e 59 do servidor; service worker da v21.1 já instalado atualizando para a v22; folha de anotar (abrir, Anotar outra, Anotar e abrir, Esc, voltar, tocar fora, a partir de Listas), "e mais N", Adiar, faixa da semana, `/` e `N`.
- **Não testado no celular de verdade:** o teclado com a folha de anotar (posição acima do teclado), o voltar do Android fechando a folha, o Compartilhar abrindo a folha, a barra com a área de gestos do Android e a cor da barra de status em Hoje.
- Ainda com o visual antigo (lotes 3 a 7): Próximos, seletor de data, janela da tarefa, menus, Listas, Busca, Config. e o note.


### v21, 11 de novembro: sessões que vencem, aparelhos conectados e Drive que tenta de novo

- **Sessões que vencem:** cada aparelho sai sozinho depois de **90 dias sem abrir o app**; cada uso renova (o servidor grava o último uso no máximo uma vez por hora). As sessões que já existiam passaram a contar a partir da troca: nenhuma caiu.
- **Aparelhos conectados** em Config. › Conta: nome tirado do navegador ("Android (modelo) · Chrome", "Windows · Chrome"), último uso e desde quando está conectado; **Sair** em cada aparelho e **Sair dos outros aparelhos**. Num celular perdido, use isso em vez de trocar a senha (trocar a senha continua encerrando os outros também). Sessões antigas aparecem como "Aparelho" até serem usadas de novo.
- **Avisos ligados à sessão:** a inscrição de notificações de cada aparelho fica ligada à sessão dele; sair (ou a sessão vencer) apaga a inscrição, e o `/push/due` não entrega mais títulos de tarefas a um aparelho sem sessão. O app reenvia a inscrição ao abrir, para ligar as de antes da v21; "Sair dos outros aparelhos" apaga também as antigas ainda sem dono.
- **Backup do Drive tenta de novo** 3 horas depois de um erro (antes, só no dia seguinte). O cron também apaga, uma vez por hora, as sessões vencidas e os avisos delas.
- **Servidor:** novas rotas `/sessions/list`, `/sessions/revoke`, `/sessions/revoke-others`. Colunas novas criadas sozinhas no D1 (`sessions.last_used`, `sessions.name`, `push_subs.session_hash`). Implantado em 11/11 pelo endpoint `/content` (o banco D1, o segredo `GOOGLE_CLIENT_SECRET` e o cron `* * * * *` foram conferidos antes e depois e continuaram iguais). Versões antigas do app continuam funcionando com o servidor novo (um aparelho na v18 sincronizou normalmente depois da troca).
- **Login:** a forma de entrar não mudou (senha ou Google); mudou só a validade da sessão.
- Testado: 59 testes do servidor (`tests/worker-harness.html`, 18 novos: migração das colunas, lista, nome do aparelho, encerrar um, encerrar os outros, vencimento, renovação, avisos cortados, nova tentativa do Drive com relógio falso); lista de aparelhos no app com servidor falso; no ar, a lista real aparece no Chrome do note (3 aparelhos).
- **v21.1:** a lista explica as sessões ainda sem nome ("ainda não abriu o app desde a atualização").

### v20, 11 de novembro: Restaurar seguro, avisos mais discretos, segurança e sem Matriz

- **Restaurar e Importar com conta conectada** (arquivo ou Google Drive) agora **juntam sem desfazer nada**: o app sincroniza antes; o que ainda existe fica como está (uma tarefa concluída depois do backup continua concluída; as criadas depois continuam aparecendo); só volta o que não existe mais (tarefas, listas e registros excluídos de vez), com id novo, porque o servidor recusa ids apagados. A pergunta mostra quantas voltam e quantas ficam. Antes, o aparelho apagava o que era mais novo que o backup, tarefas excluídas de vez não chegavam ao servidor e tudo era marcado como "editado agora" (concluídas voltavam abertas em todos os aparelhos). Sem conta, Importar continua substituindo os dados do aparelho.
- **Aviso de backup do Drive atrasado:** com o Drive conectado, se o último backup tiver mais de 3 dias (ou nunca tiver dado certo), aparece um aviso em Hoje e no topo de Config., com o erro, levando a Config. › Dados. O app consulta o servidor ao abrir, no máximo uma vez por hora.
- **Lembretes pendentes fora de Hoje:** uma linha só ("3 lembretes pendentes · Ver em Hoje", ou o título quando é um). Em Hoje, os cartões continuam.
- **Janela da tarefa abre sempre no topo,** com o título à vista.
- **Matriz retirada** de Próximos dias (quem a usava volta para a Lista). Kanban e os modos B e C do Até continuam.
- **Política de segurança (CSP)** no `index.html`: só scripts do próprio app e da biblioteca de login do Google; o app só conversa com o servidor (`tarefas-sync`) e com o Google; sem plugins nem formulários para fora. Os scripts que estavam dentro do `index.html` foram para `js/boot.js` (tema antes da primeira pintura) e `js/splash.js` (capa). Não publique outros projetos em `brunoignr-code.github.io`: todos os repositórios desse endereço dividem o mesmo armazenamento do navegador.
- **`tools/conferir.py`:** confere CACHE, APP_VERSION, regras embutidas no `sw.js` (sem `import`) e a lista FILES, comparando com o que está publicado, e recusa se faltar algo. Para virar trava do `git push`: `python tools/conferir.py --instalar` (cria `.git/hooks/pre-push`).
- Sem mudança no servidor, no login ou no formato dos dados.
- Testado no navegador: 69 testes das regras; Restaurar com uma conta simulada (servidor falso na página, nada foi à sua conta) com tarefa concluída depois do backup, tarefa criada depois, tarefa e lista excluídas de vez; aviso do Drive com backup de 5 dias e erro; linha de lembretes; janela no topo; botão "Entrar com Google" carregando sob a CSP, sem violações; service worker da v19 atualizando para a v20. O login com Google de verdade sob a CSP não foi testado.

### v19, 11 de novembro: "Só esta vez" nas repetições e Quinzenal

- **Só esta vez:** numa tarefa que se repete, mudar o dia ou a hora na janela da tarefa e tocar em Salvar pergunta "Só desta vez?", mostrando de quando para quando ("de sáb, 14/11 às 07:00 para sex, 13/11 às 08:00"):
  - **Só esta vez:** a ocorrência fica no dia e na hora novos; ao concluir ou pular, a série volta ao calendário e ao horário de antes (no exemplo, sáb, 21/11 às 07:00), sem repetir no dia seguinte. A janela mostra "Mudada só desta vez: o normal seria sáb, 14/11 às 07:00". Voltar para o dia e a hora oficiais desfaz a marca.
  - **Esta e as próximas:** a repetição passa a seguir a data nova. Numa semanal de um dia só, o dia da semana muda junto (sábado → sexta).
  - Adiar pelo menu (Amanhã, Fazer hoje, Escolher outra data), pelo deslizar, pela seleção e pelo botão Amanhã da notificação vale **só para a ocorrência**, sem perguntar. Concluir ou Pular logo depois de mudar o dia na janela também.
- **Quinzenal** no Repetir (a cada 2 semanas, no mesmo dia da semana), no atalho Repetir do campo Anotar ("A cada 2 semanas (quinzenal)") e no texto digitado ("quinzenal", "quinzenalmente", "a cada duas semanas"). A tarefa mostra "quinzenal (sex)".
- **Correção:** nas tarefas que se repetem, o rodapé da janela passava da largura do celular e empurrava a janela para a direita (Repetir e a chave do Lembrar ficavam cortados). "Pular esta" virou um ícone (seta) e o Salvar encolhe para caber.
- **Formato dos dados (avisado e autorizado):** as tarefas que se repetem ganham o campo opcional `occurrence` ({ when, remindAt, extraReminders } oficiais da ocorrência mudada), que volta a `null` ao concluir ou pular. Nada foi removido nem renomeado; Quinzenal é `weekly` com `interval: 2`. Aparelhos numa versão antiga ignoram o campo: lá, concluir uma ocorrência mudada se comporta como antes (segue a data mudada).
- Testado: 69 testes das regras (6 novos: só esta vez, mudada para depois, mudar de novo e voltar, esta e as próximas, adiar pela notificação, quinzenal); no navegador em tamanho de celular, com dados descartáveis apagados depois; service worker da v18 atualizando para a v19. As regras novas foram embutidas no `sw.js` (`tools/build_sw.py`).

### v18, 11 de novembro: anotar abre a tarefa, trava contra perder edições e relógio de ponteiro

- **Anotar abre a tarefa:** depois do Enter no "Anotar…", a tarefa é criada (com o que foi entendido do texto) e a janela dela abre na hora, como "Nova tarefa", para completar dia, hora, repetição e o resto, sem abrir o teclado. Em Config. › Geral › "Depois de anotar" dá para voltar a "Continuar anotando".
- **Tarefa nova no topo:** entra no começo da lista (como no To Do). Ao fechar a janela (Salvar, Fechar ou Descartar), a tela rola até ela, no meio da tela, e ela pisca. Se ela não aparece na tela atual (ex.: criada para amanhã em Hoje), um aviso diz onde está.
- **Trava contra perder o que foi digitado:** com alterações não salvas, Fechar, Esc e o voltar do Android mostram "Sair sem salvar?" com Salvar e fechar, Continuar editando e Descartar. Voltar de novo com a pergunta aberta continua editando. Se o Chrome do Android fechar a janela sem deixar o app impedir, ela reabre com o que foi digitado e pergunta. Concluir, Reabrir, Duplicar e Pular dentro da janela agora salvam antes o que foi mudado (antes, perdiam).
- **Seletor de data e horário no modelo do To Do no Android:** abas Data e Horário com sublinhado, faixa grande com a data ("Qua., 11 de nov.") ou o horário ("16:00"), calendário do mês e **relógio de ponteiro de 24 h** (anel de fora 1 a 12, de dentro 13 a 00): tocar ou arrastar escolhe a hora e passa sozinho para os minutos. Tocar na hora ou nos minutos do topo volta para eles; o botão de teclado permite digitar. Hoje, Amanhã, Próx. semana e Sem data continuam embaixo do calendário. A grade de botões de hora e minuto saiu.
- Sem mudança no formato dos dados, no login ou no servidor. A opção "Depois de anotar" fica no aparelho, como as outras de Config.
- Testado no navegador em tamanho de celular (claro e escuro), numa origem local sem conta e com dados descartáveis apagados depois; 63 testes das regras passando; service worker da v17 já instalado atualizando para a v18.

### v17, 11 de novembro: correção da atualização presa na v14.5

- **Defeito da v15 e v16:** o `sw.js` passou a usar `import` (service worker como módulo). Aparelhos com o service worker registrado no formato clássico (até a v14.5) não conseguiam carregar o arquivo novo ("ServiceWorker script evaluation failed") e ficavam presos na v14.5, com "Buscar atualização" dizendo que já era a mais nova.
- **Correção:** o `sw.js` voltou a não ter `import`. As regras que ele usa (Concluir, Adiar, Amanhã, junção da sincronização e agenda dos avisos) são embutidas nele por `python tools/build_sw.py`, a partir de `js/rules.js`, `js/sync-core.js`, `js/push-core.js` e `js/actions-core.js`. Assim o mesmo arquivo funciona registrado como clássico ou como módulo, e o app voltou a registrar no formato clássico.
- **Regra nova:** depois de mudar qualquer um desses quatro arquivos, rode `python tools/build_sw.py` antes de publicar.
- Testado no navegador: service worker da v14.5 (clássico) atualizando para a v17; o da v16 (módulo) atualizando para a v17 e voltando ao formato clássico; e o Concluir pela notificação com as regras embutidas. 63 testes das regras passando.

### v16, 11 de novembro: entrar com Google e backup no Google Drive

- **Entrar com Google:** em Config. › Conta, "Ligar conta Google" (com o aparelho já conectado). Nos outros aparelhos, "Entrar com Google" na tela de entrar. O servidor confere a assinatura do token do Google (chaves públicas do Google, `aud` igual ao ID do cliente, validade) e só abre sessão para a conta Google ligada. O login com senha continua valendo.
- **Backup no Google Drive:** em Config. › Dados, "Conectar Google Drive". O servidor guarda a autorização (o *refresh token*, no D1) e, pelo cron, faz um backup por dia depois das 3h de Brasília na pasta "Minha lista de afazeres" do Drive, no mesmo formato do Exportar, mantendo os 30 mais recentes. Também há "Fazer backup agora", "Restaurar" (junta as tarefas do backup às atuais) e "Desconectar" (revoga o acesso). O app pede só `drive.file`: enxerga apenas os arquivos que ele cria.
- **Google Cloud:** projeto `minha-lista-de-afazeres`, cliente OAuth Web "Afazeres web" (origens `https://brunoignr-code.github.io` e `http://localhost:8768`), API do Drive ativada, app "Em produção" (sem a validade de 7 dias do modo Teste; sem logotipo para não exigir verificação). Política de privacidade em https://brunoignr-code.github.io/privacidade.html.
- **Segredo:** o "client secret" do Google fica só no Worker, como variável secreta `GOOGLE_CLIENT_SECRET` (Cloudflare › Workers › tarefas-sync › Settings › Variables and secrets), cadastrada à mão pelo dono. Sem ele, o login com Google funciona e o backup no Drive fica desativado. O ID do cliente é público e está em `js/google.js` e `server/worker.js`.
- **Servidor:** implantado em 11/11 pelo endpoint `/content` da API da Cloudflare, que troca só o código e mantém o banco D1 e o cron. Novas rotas: `/google/login`, `/google/link`, `/google/unlink`, `/google/status`, `/drive/connect`, `/drive/backup`, `/drive/list`, `/drive/file`, `/drive/disconnect`.
- Testado: 41 testes do servidor (`tests/worker-harness.html`), 20 deles novos, com um Google simulado (chave RSA gerada na página e Drive em memória); 63 testes das regras. O login e o Drive de verdade só podem ser testados com a sua conta.

### v15, 11 de novembro

- **Notificação sem abrir o app:** Concluir, Adiar e Amanhã são registrados pelo service worker direto no banco do aparelho, enviados ao servidor (`/sync`) e a agenda dos avisos é refeita (`/push/schedule`), para os outros aparelhos não avisarem de algo já resolvido. Se o app estiver aberto na tela, ele mesmo registra, como antes; se estiver em segundo plano, recarrega os dados. As regras ficam em `js/actions-core.js`, usado pelo app e pelo service worker, que agora é um módulo (`register('sw.js', { type: 'module' })`).
- **Tarefa nova à vista:** depois de anotar, a tela rola até a tarefa nova (acima do campo Anotar) e ela pisca em verde; o teclado continua no campo.
- **Salvar no lugar do Concluir:** na janela da tarefa, Salvar virou o botão grande do rodapé; Concluir ficou pequeno ao lado (e no círculo junto ao título). O topo tem só Fechar.
- **Seletor único de dia e hora** (trocado na v18 pelo de calendário e relógio de ponteiro): Quando abre uma folha com as abas Dia (calendário do mês, Hoje, Amanhã, Próx. semana, Sem data) e Hora (grade de horas, minutos de 5 em 5, atalhos 08:00 a 20:00 e Sem hora). Escolher o dia passa para a aba Hora; arrastar para o lado troca de aba; um só Definir confirma os dois. O "Lembrar em" usa o mesmo seletor.
- Sem mudança no formato dos dados, no login ou no servidor. Testado no navegador em tamanho de celular, com dados descartáveis apagados depois; 63 testes automáticos passando. A ida ao servidor a partir da notificação não foi testada com a conta real.

### v14.5, 10 de novembro: janela da tarefa, seleção e telas de lista

- **Janela da tarefa nova** (prancheta "Tarefa"):
  - o título fica grande, com a marca de concluir ao lado;
  - Quando tem botões de um toque (Hoje, Amanhã, Próx. semana, Sem data), que acendem conforme a data escolhida;
  - Lembrar virou uma linha com chave ("Lembrar amanhã às 09:00 · segue Quando e Hora"). O campo de data e hora do lembrete só aparece quando ele não segue Quando e Hora, ou em "Outro dia ou horário para lembrar";
  - Repetir ficou compacto, com "Lembrar em cada repetição" junto;
  - Lista e Importante ficam lado a lado;
  - as etapas têm marca em folha e contagem ("1 de 3");
  - "Mais opções" virou uma linha que abre;
  - no rodapé: Lixeira e Duplicar como ícones, "Pular esta" e o botão Concluir com "próxima: qui, 10/12" nas repetições.
- **Seleção de várias tarefas:** o topo mostra "2 selecionadas" com Todas e Pronto. Embaixo há uma barra com 5 botões com ícones: Concluir, Amanhã, Estrela, Mover, Excluir. O botão "Hoje" da barra antiga virou "Amanhã", como no design.
- **Telas de lista:**
  - Nova lista e Editar lista têm prévia da lista, emojis em grade (com "Outro"), cores em folha e grupo por botões (Nenhum, grupos existentes, Novo grupo);
  - Excluir lista mostra três cartões (Entrada, outra lista, Lixeira);
  - o menu da lista tem ícones e mostra a ordem atual e quantas concluídas;
  - Organizar ganhou setas e "Grupo" no título de cada grupo;
  - Mover mostra as listas com emoji, separadas por grupo, e "uma está aqui".
- **Adiar com prazo vencido:** o app não deixa Quando passar do prazo (Até), regra que já existia. Agora ele explica ("Não dá para mudar: o prazo era ontem. Mude o prazo nos detalhes.") e, na seleção, conta só as que mudaram, em vez de dizer que todas foram adiadas.
- Sem mudança no formato dos dados nem no login. 63 testes passando; testado no navegador em tamanho de celular, com dados descartáveis apagados depois.

### v14.4, 10 de novembro

- **Próximos dias inclui Hoje:** na visão Lista, a primeira seção é "Hoje", com as tarefas de hoje e as que ficaram de dias anteriores (as atrasadas primeiro), seguida de Amanhã e dos outros dias. Calendário, Kanban e Matriz não mudaram.

### v14.3, 10 de novembro

- Favicon da aba conforme a prancheta "Ícone" do design: o ícone inteiro com cantos arredondados, em SVG e em PNG de 32 e 16 px (`icons/favicon*`). O ícone do APK 1.3 já seguia a mesma prancheta (fundo em degradê, frente no círculo de 66%, silhueta branca nas notificações e no ícone temático); as cores do ícone temático (claro e escuro) quem escolhe é o Android, a partir da silhueta.

### v14.2 e APK 1.3, lote 3, 10 de novembro

- **APK 1.3** (`versionCode` 4), mesma chave do 1.2 (certificado SHA-256 `453fd2e0…`): `C:\Python - local\apk-afazeres\afazeres-1.3-twa.apk`. Precisa instalar por cima do 1.2 para trocar o ícone: ícone adaptável da logo 3 (fundo verde em degradê, folha de papel na frente), silhueta branca no ícone temático do Android 13+ e nas notificações, tela de abertura com a logo nova e barras do Android na Folha escura quando o celular está no modo escuro. `android/tools/gerar_icones.py` agora desenha tudo a partir dos SVGs de `icons/` (usa o Chrome e o Pillow).
- **Botão "Amanhã" na notificação:** a tarefa vai para amanhã e o lembrete de hoje volta amanhã, no mesmo horário. O Chrome mostra no máximo **dois** botões por notificação, então o padrão passou a ser Concluir + Amanhã; em Config. › Avisos › "Segundo botão do aviso" dá para voltar a Concluir + Adiar 10 min. Vale para os avisos com o app aberto e com ele fechado (o service worker lê a escolha no aparelho). O Worker não mudou.
- Correção: a navegação e a tela Listas não quebram mais se forem desenhadas antes de os dados carregarem.

### v14.1, lote 2, 10 de novembro

- **Deslizar para a esquerda adia para amanhã** (com uma faixa amarela "Amanhã" por baixo e Desfazer). Em Config. › Geral dá para voltar a "Mandar para a Lixeira". Deslizar para a direita continua concluindo. O lembrete marcado para o mesmo dia vai junto para amanhã.
- **Menu ⋯ da tarefa** com quatro botões grandes no topo (Concluir, Amanhã (ou Hoje, se já for amanhã), Estrela, Mover) e embaixo: abrir detalhes, escolher outra data, tirar a data, duplicar, selecionar várias e mandar para a Lixeira.
- **Config. virou um índice** com cinco telas: Geral, Aparência, Avisos, Conta e sincronização, Dados. Cada linha mostra um resumo (ex.: "Abre em Hoje · lembrar às 09:00"); com conta, o topo mostra a hora da última sincronização. Opções de ligar e desligar viraram chaves.
- **Concluídas** agrupadas por dia (Hoje, Ontem, Esta semana, Semana passada, mês), com "Reabrir" em cada tarefa e as repetições no meio, na ordem em que foram feitas.
- **Lixeira** em cartões, com Restaurar e Excluir de vez em cada um, e Restaurar tudo e Esvaziar no topo.
- **Busca** destaca o termo no título e mostra o trecho das notas (ou da etapa) onde ele aparece; botão para limpar e chave "Incluir concluídas".
- Não feito: "Limpar concluídas sozinho depois de 30 dias", que aparece no design de Dados, porque seria uma função nova.
- Sem mudança no formato dos dados nem no login; a opção nova (deslizar) fica no aparelho. 63 testes passando.

### v14, lote 1 (design novo), 10 de novembro

- **Logo nova (logo 3, "Folha de papel"):** folha de planta feita de papel pautado, com a ponta dobrada mostrando o verde e o "concluído" em pincel, sobre verde-escuro. Vale para o app instalado pelo Chrome, a aba e a capa de abertura (`icons/icon-folha.svg`, PNGs 192, 512 e maskable). Notificações usam uma silhueta branca própria (`icons/badge-folha-96.png`). O ícone do APK só muda com o APK 1.3 (lote 3).
- **Um tema só, a Folha:** Diamante e Marca-texto saíram. Em Config. › Aparência: Modo (Claro, Escuro, Automático, que segue o celular) e 8 cores de destaque (Folha, Azul, Roxo, Rosa, Terracota, Âmbar, Petróleo, Grafite), cada uma com versão clara no escuro. Quem usava Diamante passa para a Folha escura; quem usava Marca-texto, para a Folha clara. As fontes Manrope, Figtree e Bricolage foram apagadas.
- **Abas com ícones** (Hoje com o número de tarefas, Próximos, Listas, Busca, Config.).
- **Campo "Anotar…" fixo embaixo,** acima das abas, em Hoje, Próximos e dentro de cada lista. Ao digitar, mostra "Entendi assim" (título, data, lembrete, repetição) e botões de um toque: Hoje, Amanhã, Repetir e a lista.
- **Linha da tarefa enxuta:** título e uma linha com estrela (só quando marcada), data, lembrete, repetição, etapas e lista com a bolinha de cor. O botão de estrela saiu da linha (fica no ⋯ e nos detalhes).
- **Hoje com seções:** Atrasada (prazo vencido), Para hoje e "Feitas hoje (n)", recolhida. O lembrete em destaque tem Concluir, Adiar (10 minutos, 1 hora, Hoje à noite 19:00, Amanhã no horário sugerido, Escolher…) e × para dispensar.
- **Listas** com emoji em quadradinho colorido e atalhos para Importantes, Tags (tela nova), Concluídas e Lixeira.
- Sem mudança no formato dos dados nem no login. As opções novas (modo e cor) ficam no aparelho, como as outras de Config.
- Testado no navegador em tamanho de celular e de note, numa origem local com dados descartáveis; 63 testes automáticos passando.

### v13 e APK 1.2, 10 de novembro

- **Temas:** Folha virou o tema padrão. Barquinho e Sistema foram apagados (quem usava passa para a Folha); ficam Folha, Diamante e Marca-texto. A fonte Bitter, só do Barquinho, saiu.
- **Ícone:** uma folha verde com o "concluído" como nervura (`icons/icon-folha.svg`), no app instalado, na aba, nas notificações e no APK. A capa de abertura é a mesma folha em todos os temas ("cada dia, uma folha nova"), com fundo escuro só no Diamante. Ícones e capas do Barquinho e do Diamante foram apagados.
- **Janela da tarefa redesenhada:** Salvar fixo no topo e Concluir fixo no rodapé; título em destaque; bloco Quando + Hora + Lembrar; Repetir compacto ("A cada 1 semanas" numa linha), com "Mais opções da repetição" recolhível; Lista e Importante lado a lado; Etapas e Notas; prazo, outros lembretes, insistir e tags em "Mais opções". Excluir, Duplicar e Pular no rodapé, menores.
- **Quando sugere o lembrete:** ao escolher a data em Quando, a Hora (ao lado) e o Lembrar já vêm preenchidos com o horário sugerido (09:00, ajustável em Config. > Geral). Mudar a data ou a hora muda o lembrete junto. Mudar o lembrete à mão ou desligar "Lembrar" o solta de Quando. Sem mudança no formato dos dados: a hora é a do próprio lembrete.
- **APK 1.2** (`versionCode` 3), mesma chave: `C:\Python - local\apk-afazeres\afazeres-1.2-twa.apk`. Ícone da folha, folha branca nas notificações e barras do Android na cor clara da Folha.
- Testado no navegador em tamanho de celular, com dados descartáveis apagados depois; 62 testes automáticos passando (os dois testes de tema foram atualizados para a regra nova).

### v12.2 e APK 1.1, 9 de novembro

- O ícone voltou a ser o barquinho: app instalado pelo Chrome, aba do navegador, notificações e APK. O tema padrão continua Diamante.
- APK 1.1 (`versionCode` 2), com a mesma chave: `C:\Python - local\apk-afazeres\afazeres-1.1-twa.apk`. Ícone adaptável do barquinho e silhueta de barco nas notificações e no ícone temático do Android.

### v12.1, 9 de novembro

- Toque longo no celular abre o menu do app (tarefa ou lista) com uma vibração curta, no lugar do menu do Chrome. Sem seleção de texto ao segurar tarefas, listas e botões; os campos de texto continuam normais.

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

- Item 7 do plano, pelo caminho 1 (TWA), por decisão de 9/11: fica assim até o app amadurecer o bastante para valer instalar atualizações por cabo (aí entra a casca Kotlin com alarmes nativos, caminho 2). Widget: retirado do escopo em 12/11, a pedido.
- Pacote `br.afazeres.app`, nome "Afazeres" no ícone, ícone adaptável (barquinho desde a 1.1, com versão monocromática), tela de abertura escura, ícone de notificação próprio, atalhos Nova tarefa e Próximos dias, e "Compartilhar" de outros apps.
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
- Próximos dias em Lista, Calendário, Kanban (por lista) e Matriz (importante × urgente; retirada na v20).
- "Compartilhar para Tarefas" no Android, atalhos no ícone (Nova tarefa, Próximos dias) e teclas N e / no note.
- Correção do modo offline, que podia guardar arquivos antigos e exigir várias recargas para mostrar uma versão nova.

- **Publicado:** https://brunoignr-code.github.io/tarefas/, com a Folha como tema único (modo claro, escuro ou automático e 8 cores de destaque).
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

- v21 nos celulares: o nome de cada um na lista de aparelhos, o Sair de um celular de verdade (ele deve parar de sincronizar e de receber avisos) e a reinscrição dos avisos ao abrir.
- v20: entrar com Google e conectar o Drive com a CSP ativa (o botão carrega sem erros no navegador, mas o login completo não foi feito); Restaurar com a conta real.
- v19 no celular: a pergunta "Só desta vez?", o Amanhã da notificação numa tarefa que se repete (deve manter a série) e o rodapé da janela cabendo na tela.
- v18 no celular: anotar abrindo a tarefa, a pergunta "Sair sem salvar?" no gesto de voltar do Android (no navegador foi testada com Esc e com o fechamento forçado), a rolagem até a tarefa nova e o relógio de ponteiro com o dedo (testado com mouse e toque simulado).
- A atualização da v14.5 para a v17 no celular (a correção do service worker foi testada só no navegador).
- Login com Google e backup no Drive com a conta real (v16).
- Concluir, Adiar e Amanhã na notificação sem abrir o app, tarefa nova destacada e seletor de dia e hora (v15).
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
- `sw.js`: cache offline (sem `import`; as regras são embutidas por `tools/build_sw.py`), avisos recebidos por push e botões das notificações. Ao mudar a lista de arquivos, atualize `FILES` e `CACHE`. A cada publicação, suba `CACHE` e `APP_VERSION` (em `js/app.js`), que aparece no rodapé de Config. Antes de publicar, rode `python tools/conferir.py`.
- `tests/`: testes das regras, executados no navegador.
- `icons/`: capa (`folha.svg`) e ícone (`icon-folha.svg`). Os PNG são gerados do SVG com o Chrome sem janela (`--headless --screenshot`); o maskable é o ícone reduzido sobre o mesmo fundo. `tools/make_icons.py` é o gerador antigo, do primeiro ícone.
