# Taverna De Bolso - Railway com Layout do Render

Layout aplicado a partir da versão visual do Render:
https://taverna-server.onrender.com/

Mantém:
- Railway pronto
- process.env.PORT
- npm start
- socket.io relativo
- toolbar superior
- painel Mestre lateral
- seletor de imagem do token
- ficha do token
- dados


Atualização: spawn global fora do sistema de mapas. Agora existe apenas 1 spawn de jogador e 1 spawn de NPC por sala, salvos em coordenadas absolutas do mundo.


Correção final: spawn antigo/fantasma removido. O arquivo salvo usa somente `globalSpawns` e não reaproveita `spawnNpc/spawnPlayer` antigo.


Correção aplicada: removido desenho visual dos ícones de spawn no grid. O spawn continua salvo no state/exportação e usado para nascer jogador/NPC, mas não aparece mais como 👹/🧍 solto no mapa.
