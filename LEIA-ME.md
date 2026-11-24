# Side by Side no Coolify

O pacote contém a aplicação Node e o Chromium/Neko. Use o conteúdo desta pasta como raiz do repositório de deploy. Configure os valores reais diretamente no Coolify.

1. No Coolify, crie uma aplicação Docker Compose a partir do repositório. Use `/` como Base Directory e `/compose.yaml` como Docker Compose Location.
2. Adicione o domínio HTTPS ao serviço `app`, com a porta interna `3114` (exemplo `https://cinema.example.com:3114`). No navegador, o acesso é pela porta HTTPS padrão.
3. Em Environment Variables, defina `PUBLIC_ORIGIN` com a origem pública exata (exemplo `https://cinema.example.com`, sem `:3114`), `MEDIA_ADDRESS` com o IPv4 público da VM e mantenha `ICE_SERVERS=[]` para o primeiro teste direto. O Coolify gera o token de controle e as senhas de visitante e administrador a partir das referências `SERVICE_PASSWORD_64_CINEMACONTROL`, `SERVICE_PASSWORD_64_CINEMAVIEWER` e `SERVICE_PASSWORD_64_CINEMAADMIN` do Compose.
4. No firewall do provedor, libere TCP `80` e `443` para o proxy e UDP `60200–60219` para o vídeo. O painel administrativo e o SSH podem ser restritos ao seu IP. Os serviços internos `8080`, `8765` e `9222` ficam sem publicação no host.
5. Faça o deploy pelo Coolify. Confirme os dois serviços saudáveis, abra `/health` via HTTPS e entre em `/cinema` para reproduzir conteúdo autorizado. Teste som, imagem, pausa e fila com dois aparelhos, incluindo um numa rede diferente. Se o site abrir sem vídeo, confira o IPv4 anunciado e as regras UDP antes de avaliar TURN.

O endpoint `/join` cria a sessão de visitante do Neko. O acesso pelo endereço da aplicação dá acesso à sessão compartilhada. Compartilhe o endereço com o grupo da apresentação. Mantenha o token de controle e a senha administrativa fora do repositório e dos registros de apresentação.
