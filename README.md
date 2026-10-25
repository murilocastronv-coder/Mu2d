# MU 2D Online — v0.1 (Lorencia)

MMORPG 2D pixel art multijogador. Servidor autoritativo (Node + ws), contas e personagens em PostgreSQL, cliente Phaser 3 (mobile + PC).

## Rodar local
```
npm install
npm start        # http://localhost:3000  (sem DATABASE_URL usa data/accounts.json — só para testes)
```
Abra em 2 abas/celulares, crie 2 contas e veja um ao outro.

## Publicar no Render
1. Suba esta pasta num repositório GitHub.
2. Render → New → Blueprint → escolha o repositório (usa `render.yaml`: web service + PostgreSQL).
3. Pronto: a tabela `accounts` é criada sozinha no 1º boot. Saúde: `/health`.
(Postgres *free* do Render expira após ~30 dias: faça backup com `pg_dump` ou use um plano pago.)

## Variáveis de ambiente
`DATABASE_URL` (obrigatória em produção) · `PGSSL=false` (se seu Postgres não usa SSL) · `XP_RATE` · `DROP_RATE` · `MAX_LEVEL` (padrão 1000) · `PORT`.

## Controles
Mobile: joystick, ATK (segure), SKILL, HP, MP, BAG, CHAT. PC: WASD/setas, Espaço atacar, Q skill, 1/2 poções, I inventário, Enter chat. Toque num monstro para fixar alvo.

## O que funciona (v0.1)
Contas (hash scrypt), login/reconexão por token, mundo Lorencia 64x48 com colisão, 4 classes (DK/DW/FE/SU) com skill, 4 tipos de monstro + boss Golem (golpe em área com aviso), IA (patrulha/perseguição/ataque), XP/nível, loot, inventário 24 slots, equipar/desequipar, vender/descartar com confirmação, loja de poções, multiplayer em tempo real, chat global, persistência.
## O que falta (próximas fases)
Demais 14 mapas, 50 monstros, Magic Gladiator e Dark Lord, grupos/guildas/PvP/comércio, asas e aprimoramentos, missões/eventos/VIP, painel admin, música, arte final (os sprites atuais são gerados por código, trocáveis por spritesheets).
