# Taverna De Bolso - versão Fly.io

## Deploy no Fly.io

1. Instale o flyctl e faça login:
   fly auth login

2. Na pasta do projeto:
   fly launch

3. Quando perguntar se quer usar configuração existente, use o `fly.toml`.

4. Deploy:
   fly deploy

## Importante

- O app escuta em `PORT=8080`.
- O `fly.toml` está configurado com `internal_port = 8080`.
- `auto_stop_machines = false` e `min_machines_running = 1` ajudam o VTT a não dormir durante a mesa.
- Use o botão Salvar/Importar do Mestre para backup das cenas.
- Portas são apagadas junto com paredes quando usar limpar/desfazer.
