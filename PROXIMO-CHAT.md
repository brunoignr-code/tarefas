# Prompt para continuar em um chat novo

Copie o bloco abaixo no novo chat, aberto nesta mesma pasta. A próxima ação já está escrita; os feedbacks de uso real no fim são opcionais (apague a parte que não preencher).

```text
Continuando o meu gerenciador de tarefas "Minha lista de afazeres" (PWA pessoal, alternativa ao Microsoft To Do).

Antes de mudar qualquer coisa, leia o README.md desta pasta (principalmente "Estado do projeto", da v28 para trás), este PROXIMO-CHAT.md e o memory do projeto. O escopo atualizado em 12/11 está em https://claude.ai/artifact/2c4hW8AsWTP1yRBnESSNKY (seção "Estado em 12/11/2026 (v23)").

PRÓXIMA AÇÃO (pedido meu):
[escreva aqui o que quer fazer; sem pedido, siga os feedbacks de uso real no fim]

Onde paramos (12/11/2026):
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
- APK Android (TWA) 1.3 em C:\Python - local\apk-afazeres (chave em C:\Python - local\chaves-android, fora do repositório). Atualiza pela web.
- Comecei do zero em 9/11 e uso no note e em 2 celulares Android (um A55). Fase de uso real até cerca de 23/11; depois decidir se Kanban e os modos B e C do Até saem.
- Combinado: app simples (lembrete, repetição, listas, grupos, etapas), custo zero.

Pendências que são minhas: verificação em duas etapas no Google, GitHub e Cloudflare; rodar uma vez `python tools/conferir.py --instalar` (trava do git push).

Ainda não confirmado no celular real: a v26 (aviso do A17 para o A55 com o app fechado; ver "Últimos avisos que chegaram" e "Aparelhos inscritos na conta"), a v25 (grades de botões no meu aparelho e letra), a v24 (tocar nas bolinhas dos dias com o dedo, folha "Repetir nos dias" com o teclado aberto atrás), avisos com o app fechado e economia de bateria, Concluir e Amanhã pela notificação sem abrir o app, backup no Drive com a minha conta, login com Google sob a CSP, a v23 (janela da tarefa com o teclado, seleção sobre a área de gestos, Kanban com o dedo, letra 10 num celular pequeno), a v22 (folha de anotar com o teclado, voltar fechando a folha, Compartilhar abrindo a folha, barra flutuante sobre a área de gestos), a v21 (Sair de um celular de verdade), a v19 ("Só desta vez?") e a v18 ("Sair sem salvar?" no gesto de voltar).

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
