# Minimal Bot Template

Just the minimum to get a working bot using interactions.

This template does not include any caching or other features you might need.
This template also includes a /ping command to show the bot latency

## Setup

- Download the source
- Install the dependencies using `pnpm`
- Copy the .env.example file and rename it to .env
- Fill out the .env file

## Run Bot

- run `pnpm install` to install the dependencies
- run `pnpm build` to build the source
- run `node dist/register-commands.js` to register the slash commands
- run `pnpm start` to run the bot
