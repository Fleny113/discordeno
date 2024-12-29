# Reaction roles example bot

Example bot for reaction-roles using Discord Interactions and not classic reactions.

## Setup

1. Rename `.env.example` to `.env` and add your bot token in the `TOKEN` variable
1. Replace `REPLACE WITH YOUR GUILD ID` in `src/register-commands.ts` with your test guild id

## Run the bot

1. `pnpm install` to install the dependencies
1. `pnpm build` to build the .ts files into .js
1. `pnpm start` (or `node ./dist/index.js`) to run the bot
