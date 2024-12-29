# Advanced Bot Template

This template contains more advanced code.

This template includes caching (using `dd-proxy-cache`), user permission handling, and slash commands options support
This template also includes a /ping command to show the bot latency and a /warn command to show how to send a DM to a user and how to check for permissions

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
