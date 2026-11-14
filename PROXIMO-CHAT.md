# Prompt para continuar em um chat novo

Copie o bloco abaixo no novo chat, aberto nesta mesma pasta. A próxima ação já está escrita; os feedbacks de uso real no fim são opcionais (apague a parte que não preencher).

```text
Continuando o meu gerenciador de tarefas "Minha lista de afazeres" (PWA pessoal, alternativa ao Microsoft To Do).

Antes de mudar qualquer coisa, leia o README.md desta pasta (principalmente "Estado do projeto", da v30 para trás), este PROXIMO-CHAT.md e o memory do projeto. O escopo atualizado em 12/11 está em https://claude.ai/artifact/2c4hW8AsWTP1yRBnESSNKY (seção "Estado em 12/11/2026 (v23)").

PRÓXIMA AÇÃO (pedido meu):
[escreva aqui o que quer agora; se não houver, colete os feedbacks de uso real abaixo e ajuste]

Onde paramos (14/11/2026):
- v34 + APK 1.5 publicados (servidor implantado antes, 14/11 12:17 UTC; falta eu instalar C:\Python - local\apk-afazeres\afazeres-1.5.apk nos dois celulares): notificação resolvida num aparelho (concluída, adiada, dispensada, mudada) some dos outros em até 1 min (aviso "limpar" do servidor; se não sobrar nenhuma notificação, aparece 4 s "Lembrete resolvido em outro aparelho"); tocar no alarme do Android abre a tarefa; o site avisa o Android na hora por uma notificação-sinal "Atualizando os lembretes" que o APK 1.5 intercepta (DelegationService) e refaz a agenda; conferência na hora de tocar 6 s + 3 s (o remédio tinha tocado às 5h depois de concluído). Não usar o emulador (PC sem RAM).
- v33 publicada (só app): ícone de sino com seta de voltar no cabeçalho de Hoje devolve ao painel, em silêncio e sem duplicar (pula o que ainda está no painel), todos os lembretes de tarefas abertas que já tocaram (hoje, mesmo dispensados, e pendentes de dias anteriores; até 20; respeita adiamento). Também em Config. › Avisos › "Tirou uma notificação sem querer?" e no ⋯ da tarefa; o sino saiu do cartão do lembrete. Com os alarmes do APK ativos, a notificação do alarme (do Android) não é vista pelo app.
- v32 publicada (só app): "mostrar a notificação de novo" para quando eu tirar sem querer do painel. Sino ao lado do X no cartão do lembrete em Hoje e item no menu da tarefa; vale para tarefa aberta com lembrete pendente ou de hoje que já passou (mesmo depois de Dispensar), inclusive com os alarmes do APK ativos.
- 13/11: "Aparelhos inscritos na conta: 3" em Config. › Avisos conta as inscrições de aviso (push_subs), não as sessões; o provável terceiro é o Chrome do notebook. Conferir em Config. › Conta › Aparelhos conectados. Se fizer falta, mostrar quais aparelhos recebem avisos (precisa mudar o servidor).
- v31 publicada (só app): modo demonstração em https://brunoignr-code.github.io/tarefas/?demo=1 para mostrar o app a outras pessoas. Banco próprio "tarefas-demo" (o "tarefas" nunca é aberto), preferências da demo no localStorage com prefixo "demo:", service worker manda lembretes da demo só para a aba da demo. Dados de exemplo em js/demo.js, com datas relativas a hoje, remontados quando a demo abre num dia novo. Faixa com Recomeçar e Sair. Conta, Google, backup, push, alarmes e bateria desligados (nenhuma chamada ao tarefas-sync). Num aparelho que já tem o app, a 1ª abertura do link depois da publicação ainda mostra o app normal: recarregar.
- 12/11, conversa sobre o app: para o meu uso ele está no nível dos bons do mercado, exceto a confiabilidade do alarme (por isso a v29 e a v30). Google Agenda continua fora: eu nunca usei, faço tudo pela lista. Widget é opcional.
- v30 + APK 1.4 publicados (servidor implantado antes; falta eu instalar o APK 1.4 e tocar em "Ativar alarmes deste celular" no A17 e no A55): alarmes nativos no Android (fases 1 e 2). Config. › Avisos › Alarmes deste celular › Ativar: código de uso único → chave de alarme presa à sessão do celular. Alarme exato comum, agenda de 3 dias, confere na hora se ainda vale, Concluir/Amanhã/Adiar 10 min sem abrir o app (o servidor aplica as regras com o fuso do celular), sem push repetido. Código nativo em android/app/src/main/java/br/afazeres/app/; o build debug fala com um servidor falso em 10.0.2.2:8790. APK em C:\Python - local\apk-afazeres\afazeres-1.4.apk (mesma chave).
- v29 publicada (servidor implantado antes): fase 0 da confiabilidade dos avisos. Conferência da bateria em Config. › Avisos (Android) e push valendo 1 hora (antes 15 min).
- v28 publicada: Salvar da janela da tarefa na cor de destaque também no claro (era branco e sumia contra a página).
- v27 publicada: cartão em Hoje e Config. quando as notificações estão bloqueadas, ainda não liberadas ou só com o app aberto (Como liberar / Liberar / Ativar; Agora não esconde por 7 dias, por aparelho). O A17 tinha instalado com notificação bloqueada.
- v26 publicada (servidor implantado antes): avisos entre celulares que não se perdem. Agenda enviada ao sair da tela, sem descarte e com tempo limite; servidor ignora agenda de aparelho atrasado (`since`, meta pushScheduleSince) e o botão da notificação troca só a tarefa dele (`/push/task`); service worker renova a inscrição sozinho; Config. › Avisos mostra os últimos avisos que chegaram ao aparelho.
- v25 publicada: grupos de botões em grades que fecham certinho (Repetir, Quando, seletor de data, Dias úteis/Fim de semana, folha Anotar): colunas iguais escolhidas por container query em rem, acompanhando largura e tamanho de letra; nunca sobra botão sozinho. Use as classes .fit-box/.fit para novos grupos.
- v24 publicada: repetir em dias específicos da semana. Botão "Dias da semana" no Repetir da janela da tarefa (dia do Quando já marcado, atalhos Dias úteis, Fim de semana e Todos; o Quando vai para o primeiro dia marcado), "Dias da semana…" no Repetir da folha Anotar, e o texto entende "toda segunda e quarta", "dias úteis", "de segunda a sexta" e "todo fim de semana". Formato dos dados igual (repeat.weekdays).
- v23 publicada em https://brunoignr-code.github.io/tarefas/: redesenho "linha livre" em todas as telas (lotes 3 a 7 do ROTEIRO-REDESENHO.md: Próximos, janela da tarefa, Listas, Busca, Config. e notebook), letras numa escala só com menos negrito (pesos 500/600/700) e 10 tamanhos de letra em Config. › Aparência. Corrigido: Quinzenal → Mensal ficava "a cada 2".
- v22 publicada: lotes 1 e 2 do redesenho (barra flutuante com +, Busca no cabeçalho, Hoje com cabeçalho na cor de destaque, faixa da semana, ramo por horário, cartão "A seguir", folha de anotar no celular, capa nova). Corrigido: anotar só com a hora ("pagar luz 10h") agora põe Quando e lembrete no mesmo dia, e o lembrete volta a seguir o Quando.
- 12/11: escopo revisado. Widget Android retirado do escopo, a pedido; Google Agenda, listas compartilhadas, hábitos, Pomodoro e Matriz também fora. Só se fizer falta: atalho global no PC, lembrete padrão por lista, aviso antes do prazo, prazo próximo vai para Hoje, tarefa parada, alarmes locais do Android.
- v21 (11/11): sessões vencem após 90 dias sem uso, Config. › Conta lista os aparelhos com Sair e "Sair dos outros aparelhos", avisos ligados à sessão, Drive tenta de novo 3 h depois de erro.
- v20: Restaurar/Importar com conta juntam sem desfazer nada, aviso de backup do Drive atrasado, Matriz retirada, CSP no index.html e `python tools/conferir.py` antes de publicar.
- v19: "Só esta vez" ao mudar dia ou hora de uma tarefa que se repete (campo opcional `occurrence`), Quinzenal.
- v18: anotar abre a tarefa (opção em Config. › Geral), "Sair sem salvar?", seletor de data e horário com relógio de 24 h.
- v17: nunca usar import no sw.js; depois de mudar js/rules.js, sync-core.js, push-core.js ou actions-core.js, rodar `python tools/build_sw.py`.
- v16: entrar com Google e backup diário no Google Drive feito pelo servidor (segredo GOOGLE_CLIENT_SECRET já cadastrado no Worker).
- v15: Concluir/Adiar/Amanhã na notificação sem abrir o app.
- 11/11: migradas do To Do 33 tarefas abertas (título e data); backup e ids para desfazer em C:\Python - local\backups-afazeres.
- APK Android 1.4 (TWA + alarmes nativos) em C:\Python - local\apk-afazeres (chave em C:\Python - local\chaves-android, fora do repositório). A tela atualiza pela web; mudanças no código nativo (android/) exigem APK novo.
- Comecei do zero em 9/11 e uso no note e em 2 celulares Android (um A55). Fase de uso real até cerca de 23/11; depois decidir se Kanban e os modos B e C do Até saem.
- Combinado: app simples (lembrete, repetição, listas, grupos, etapas), custo zero.

Pendências que são minhas: verificação em duas etapas no Google, GitHub e Cloudflare; rodar uma vez `python tools/conferir.py --instalar` (trava do git push).

Ainda não confirmado no celular real: a v34 + APK 1.5 (notificação sumindo do outro celular, sinal chegando ao APK, aviso de 4 s do Chrome, alarme das 5h com o celular parado), a v33/v32 (notificações voltando ao painel em silêncio, sem cópia, e os botões delas), a v31 (demo no celular, notificação de um lembrete da demo e os botões dela), o APK 1.4 (ativar alarmes, alarme tocando com o celular parado, Concluir/Amanhã/Adiar sem abrir o app com o fuso de verdade, botões sem internet, sair do aparelho cortando os alarmes), a v29 (passos da bateria em cada modelo), a v26 (aviso do A17 para o A55 com o app fechado; ver "Últimos avisos que chegaram" e "Aparelhos inscritos na conta"), a v25 (grades de botões no meu aparelho e letra), a v24 (tocar nas bolinhas dos dias com o dedo, folha "Repetir nos dias" com o teclado aberto atrás), avisos com o app fechado e economia de bateria, Concluir e Amanhã pela notificação sem abrir o app, backup no Drive com a minha conta, login com Google sob a CSP, a v23 (janela da tarefa com o teclado, seleção sobre a área de gestos, Kanban com o dedo, letra 10 num celular pequeno), a v22 (folha de anotar com o teclado, voltar fechando a folha, Compartilhar abrindo a folha, barra flutuante sobre a área de gestos), a v21 (Sair de um celular de verdade), a v19 ("Só desta vez?") e a v18 ("Sair sem salvar?" no gesto de voltar).

Regras:
- App no GitHub Pages; o servidor (server/worker.js) roda na Cloudflare e é implantado à parte, pelo painel no meu Chrome (endpoint /content, que mantém o banco D1, o cron e o segredo). Avise antes de mudar o formato dos dados ou o login, porque já há tarefas reais sincronizando.
- Não apague nem sobrescreva minhas tarefas. Teste só com dados descartáveis numa origem local (use 127.0.0.1, não localhost:8767, que tem um banco de teste travado) e limpe depois. Não coloque tarefas, senhas, segredos ou arquivos JSON de backup no repositório.
- Não peça nem guarde minha senha nem segredos; aceites de termos e logins são comigo.
- A cada publicação, suba CACHE (sw.js) e APP_VERSION (js/app.js) e rode `python tools/conferir.py`. Ao testar atualizações, simule também um aparelho com a versão anterior já instalada.
- Visual: mesma escala de letra em todas as telas, evite negrito quando não for necessário. Grupos de botões sem quebra pela metade (linhas completas, colunas iguais, bordas alinhadas).
- Entregue em lotes prontos, peça antes de publicar e diga claramente o que não foi testado no celular real.

Meus feedbacks de uso real (opcional):
- Versão no rodapé de Config. de cada aparelho: [preencher]
- Bugs (aparelho, o que fiz, o que aconteceu): [preencher]
- Notificações (chegou com o app fechado? Concluir e Amanhã funcionaram?): [preencher]
- Atritos e o que senti falta: [preencher]
```
