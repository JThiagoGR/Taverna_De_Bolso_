Taverna De Bolso - Bugs verificados

Correções desta versão:
- Canvas não usa mais devicePixelRatio pesado, reduzindo travadas e desalinhamento.
- Tokens do Mestre e jogador permanecem visíveis.
- Eventos touch duplicados removidos.
- Compatibilidade de dados rollResult/diceRolled.
- Mapa usa requestDraw quando carrega.
- Mantém layout e Railway.

Validação:
- node --check server.js
- node --check public/app.js
