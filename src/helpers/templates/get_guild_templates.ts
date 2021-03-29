import { RequestManager } from "../../rest/request_manager.ts";
import { structures } from "../../structures/mod.ts";
import { endpoints } from "../../util/constants.ts";
import { requireBotGuildPermissions } from "../../util/permissions.ts";

/**
 * Returns an array of templates.
 * Requires the `MANAGE_GUILD` permission.
 */
export async function getGuildTemplates(guildId: string) {
  await requireBotGuildPermissions(guildId, ["MANAGE_GUILD"]);

  const templates = (await RequestManager.get(
    endpoints.GUILD_TEMPLATES(guildId),
  )) as GuildTemplate[];

  return templates.map((template) => structures.createTemplateStruct(template));
}