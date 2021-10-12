import { getGatewayBot } from "./helpers/misc/get_gateway_bot.ts";
import { checkRateLimits } from "./rest/check_rate_limits.ts";
import { cleanupQueues } from "./rest/cleanup_queues.ts";
import { createRequestBody } from "./rest/create_request_body.ts";
import { processRateLimitedPaths } from "./rest/process_rate_limited_paths.ts";
import { processRequest } from "./rest/process_request.ts";
import { processRequestHeaders } from "./rest/process_request_headers.ts";
import { RestPayload, RestRateLimitedPath, RestRequest } from "./rest/rest.ts";
import { runMethod } from "./rest/run_method.ts";
import { simplifyUrl } from "./rest/simplify_url.ts";
import { DiscordGatewayIntents } from "./types/gateway/gateway_intents.ts";
import { GetGatewayBot } from "./types/gateway/get_gateway_bot.ts";
import { dispatchRequirements } from "./util/dispatch_requirements.ts";
import { processQueue } from "./rest/process_queue.ts";
import { bigintToSnowflake, snowflakeToBigint } from "./util/bigint.ts";
import { Collection } from "./util/collection.ts";
import { DiscordenoUser, transformMember, transformUser } from "./transformers/member.ts";
import { SnakeCasedPropertiesDeep } from "./types/util.ts";
import { Channel } from "./types/channels/channel.ts";
import { DiscordenoChannel, transformChannel } from "./transformers/channel.ts";
import { transformVoiceState } from "./transformers/voice_state.ts";
import { transformRole } from "./transformers/role.ts";
import { transformMessage } from "./transformers/message.ts";
import { DiscordenoGuild, transformGuild } from "./transformers/guild.ts";
import { DiscordenoShard } from "./ws/ws.ts";
import { startGateway } from "./ws/start_gateway.ts";
import { spawnShards } from "./ws/spawn_shards.ts";
import { createShard } from "./ws/create_shard.ts";
import { identify } from "./ws/identify.ts";
import { heartbeat } from "./ws/heartbeat.ts";
import { resharder } from "./ws/resharder.ts";
import { tellClusterToIdentify } from "./ws/tell_cluster_to_identify.ts";
import { handleDiscordPayload } from "./ws/handle_discord_payload.ts";
import { log } from "./ws/events.ts";
import { handleOnMessage } from "./ws/handle_on_message.ts";
import { closeWS } from "./ws/close_ws.ts";
import { sendShardMessage } from "./ws/send_shard_message.ts";
import { resume } from "./ws/resume.ts";
import { calculateShardId } from "./util/calculate_shard_id.ts";
import {
  baseEndpoints,
  CHANNEL_MENTION_REGEX,
  CONTEXT_MENU_COMMANDS_NAME_REGEX,
  DISCORDENO_VERSION,
  DISCORD_SNOWFLAKE_REGEX,
  endpoints,
  SLASH_COMMANDS_NAME_REGEX,
  USER_AGENT,
} from "./util/constants.ts";
import { GatewayPayload } from "./types/gateway/gateway_payload.ts";
import { delay } from "./util/utils.ts";
import { iconBigintToHash, iconHashToBigInt } from "./util/hash.ts";
import { loopObject } from "./util/loop_object.ts";

export async function createBot(options: CreateBotOptions) {
  return {
    id: options.botId,
    applicationId: options.applicationId || options.botId,
    token: `Bot ${options.token}`,
    events: options.events,
    intents: options.intents.reduce((bits, next) => (bits |= DiscordGatewayIntents[next]), 0),
    botGatewayData: options.botGatewayData || (await getGatewayBot()),
    isReady: false,
    activeGuildIds: new Set<bigint>(),
    constants: createBotConstants(),
    cache: {
      guilds: {
        get: async function (id: bigint): Promise<DiscordenoGuild | undefined> {
          return {} as any as DiscordenoGuild;
        },
        has: async function (id: bigint): Promise<boolean> {
          return false;
        },
        set: async function (id: bigint, guild: DiscordenoGuild): Promise<void> {
          return;
        },
      },
      channels: {
        get: async function (id: bigint): Promise<DiscordenoChannel | undefined> {
          return {} as any as DiscordenoChannel;
        },
        has: async function (id: bigint): Promise<boolean> {
          return false;
        },
        set: async function (id: bigint, guild: DiscordenoChannel): Promise<void> {
          return;
        },
      },
      dispatchedGuildIds: {
        has: async function (id: bigint): Promise<boolean> {
          return false;
        },
        set: async function (id: bigint): Promise<void> {
          return;
        },
        delete: async function (id: bigint): Promise<void> {
          return;
        },
      },
      dispatchedChannelIds: {
        has: async function (id: bigint): Promise<boolean> {
          return false;
        },
        set: async function (id: bigint): Promise<void> {
          return;
        },
        delete: async function (id: bigint): Promise<void> {
          return;
        },
      },
    },
  };
}

const bot = await createBot({
  token: "",
  botId: 0n,
  events: createEventHandlers({}),
  intents: [],
});

export function createEventHandlers(events: Partial<EventHandlers>): EventHandlers {
  function ignore() {}

  return {
    channelCreate: events.channelCreate ?? ignore,
    debug: events.debug ?? ignore,
    dispatchRequirements: events.dispatchRequirements ?? ignore,
  };
}

export interface CreateRestManagerOptions {
  token: string;
  maxRetryCount?: number;
  version?: number;
  secretKey?: string;
  debug?: (text: string) => unknown;
  checkRateLimits?: typeof checkRateLimits;
  cleanupQueues?: typeof cleanupQueues;
  processQueue?: typeof processQueue;
  processRateLimitedPaths?: typeof processRateLimitedPaths;
  processRequestHeaders?: typeof processRequestHeaders;
  processRequest?: typeof processRequest;
  createRequestBody?: typeof createRequestBody;
  runMethod?: typeof runMethod;
  simplifyUrl?: typeof simplifyUrl;
}

export function createRestManager(options: CreateRestManagerOptions) {
  return {
    token: `${options.token.startsWith("Bot ") ? "" : "Bot "}${options.token}`,
    maxRetryCount: options.maxRetryCount || 10,
    version: options.version || "9",
    secretKey: options.secretKey || "discordeno_best_lib_ever",
    pathQueues: new Map<
      string,
      {
        request: RestRequest;
        payload: RestPayload;
      }[]
    >(),
    processingQueue: false,
    processingRateLimitedPaths: false,
    globallyRateLimited: false,
    ratelimitedPaths: new Map<string, RestRateLimitedPath>(),
    debug: options.debug || function (_text: string) {},
    checkRateLimits: options.checkRateLimits || checkRateLimits,
    cleanupQueues: options.cleanupQueues || cleanupQueues,
    processQueue: options.processQueue || processQueue,
    processRateLimitedPaths: options.processRateLimitedPaths || processRateLimitedPaths,
    processRequestHeaders: options.processRequestHeaders || processRequestHeaders,
    processRequest: options.processRequest || processRequest,
    createRequestBody: options.createRequestBody || createRequestBody,
    runMethod: options.runMethod || runMethod,
    simplifyUrl: options.simplifyUrl || simplifyUrl,
  };
}

export async function startBot(bot: Bot) {
  const transformers = createTransformers(bot.transformers);

  // SETUP UTILS
  bot.utils = createUtils({});

  // SETUP CACHE
  bot.users = new Collection();

  // START REST
  bot.rest = createRestManager({ token: bot.token });

  // START WS
  bot.gateway = createGatewayManager({});
}

export function createUtils(options: Partial<HelperUtils>) {
  return {
    snowflakeToBigint,
    bigintToSnowflake,
    calculateShardId,
    delay,
    iconHashToBigInt,
    iconBigintToHash,
    loopObject,
  };
}

export interface HelperUtils {
  snowflakeToBigint: typeof snowflakeToBigint;
  bigintToSnowflake: typeof bigintToSnowflake;
  calculateShardId: typeof calculateShardId;
  delay: typeof delay;
  iconHashToBigInt: typeof iconHashToBigInt;
  iconBigintToHash: typeof iconBigintToHash;
  loopObject: typeof loopObject;
}

export function createGatewayManager(options: Partial<GatewayManager>): GatewayManager {
  return {
    secretKey: options.secretKey ?? "",
    url: options.url ?? "",
    reshard: options.reshard ?? true,
    reshardPercentage: options.reshardPercentage ?? 80,
    spawnShardDelay: options.spawnShardDelay ?? 2600,
    maxShards: options.maxShards ?? 0,
    useOptimalLargeBotSharding: options.useOptimalLargeBotSharding ?? true,
    shardsPerCluster: options.shardsPerCluster ?? 25,
    maxClusters: options.maxClusters ?? 4,
    firstShardId: options.firstShardId ?? 0,
    lastShardId: options.lastShardId ?? 1,
    token: options.token ?? "",
    compress: options.compress ?? false,
    $os: options.$os ?? "linux",
    $browser: options.$browser ?? "Discordeno",
    $device: options.$device ?? "Discordeno",
    intents: options.intents ?? 0,
    shard: options.shard ?? [0, 0],
    urlWSS: options.urlWSS ?? "wss://gateway.discord.gg/?v=9&encoding=json",
    shardsRecommended: options.shardsRecommended ?? 1,
    sessionStartLimitTotal: options.sessionStartLimitTotal ?? 1000,
    sessionStartLimitRemaining: options.sessionStartLimitRemaining ?? 1000,
    sessionStartLimitResetAfter: options.sessionStartLimitResetAfter ?? 0,
    maxConcurrency: options.maxConcurrency ?? 1,
    shards: options.shards ?? new Collection(),
    loadingShards: options.loadingShards ?? new Collection(),
    buckets: new Collection(),
    utf8decoder: new TextDecoder(),

    startGateway,
    spawnShards,
    createShard,
    identify,
    heartbeat,
    handleDiscordPayload,
    tellClusterToIdentify,
    log,
    resharder,
    handleOnMessage,
    processQueue,
    closeWS,
    sendShardMessage,
    resume,
  };
}

export function stopBot(bot: Bot) {
  // STOP REST
  // STOP WS
}

export interface CreateBotOptions {
  token: string;
  botId: bigint;
  applicationId?: bigint;
  events: EventHandlers;
  intents: (keyof typeof DiscordGatewayIntents)[];
  botGatewayData?: GetGatewayBot;
  rest?: Omit<CreateRestManagerOptions, "token">;
}

export type UnPromise<T extends Promise<unknown>> = T extends Promise<infer K> ? K : never;

export type CreatedBot = UnPromise<ReturnType<typeof createBot>>;

export type Bot = CreatedBot & {
  utils: HelperUtils;
  rest: RestManager;
  gateway: GatewayManager;
  transformers: Transformers;
  // TODO: Support async cache
  users: Collection<bigint, DiscordenoUser>;
  channels: Collection<bigint, SnakeCasedPropertiesDeep<Channel>>;
};

export interface Transformers {
  snowflake: typeof snowflakeToBigint;
  channel: typeof transformChannel;
  guild: typeof transformGuild;
  user: typeof transformUser;
  member: typeof transformMember;
  message: typeof transformMessage;
  role: typeof transformRole;
  voiceState: typeof transformVoiceState;
}

export function createTransformers(options: Partial<Transformers>) {
  return {
    snowflake: options.snowflake || snowflakeToBigint,
    channel: options.channel || transformChannel,
    guild: options.guild || transformGuild,
    user: options.user || transformUser,
    member: options.member || transformMember,
    message: options.message || transformMessage,
    role: options.role || transformRole,
    voiceState: options.voiceState || transformVoiceState,
  };
}

export type RestManager = ReturnType<typeof createRestManager>;

export interface GatewayManager {
  /** The secret key authorization header the bot will expect when sending payloads. */
  secretKey: string;
  /** The url that all discord payloads for the dispatch type should be sent to. */
  url: string;
  /** Whether or not to automatically reshard. */
  reshard: boolean;
  /** The percentage at which resharding should occur. */
  reshardPercentage: number;
  /** The delay in milliseconds to wait before spawning next shard. OPTIMAL IS ABOVE 2500. YOU DON"T WANT TO HIT THE RATE LIMIT!!! */
  spawnShardDelay: number;
  /** The maximum shard Id number. Useful for zero-downtime updates or resharding. */
  maxShards: number;
  /** Whether or not the resharder should automatically switch to LARGE BOT SHARDING when you are above 100K servers. */
  useOptimalLargeBotSharding: boolean;
  /** The amount of shards to load per cluster. */
  shardsPerCluster: number;
  /** The maximum amount of clusters to use for your bot. */
  maxClusters: number;
  /** The first shard Id to start spawning. */
  firstShardId: number;
  /** The last shard Id for this cluster. */
  lastShardId: number;
  token: string;
  compress: boolean;
  $os: string;
  $browser: string;
  $device: string;
  intents: number;
  shard: [number, number];

  /** The WSS URL that can be used for connecting to the gateway. */
  urlWSS: string;
  /** The recommended number of shards to use when connecting. */
  shardsRecommended: number;
  /** The total number of session starts the current user is allowed. */
  sessionStartLimitTotal: number;
  /** The remaining number of session starts the current user is allowed. */
  sessionStartLimitRemaining: number;
  /** Milliseconds left until limit is reset. */
  sessionStartLimitResetAfter: number;
  /** The number of identify requests allowed per 5 seconds.
   * So, if you had a max concurrency of 16, and 16 shards for example, you could start them all up at the same time.
   * Whereas if you had 32 shards, if you tried to start up shard 0 and 16 at the same time for example, it would not work. You can start shards 0-15 concurrently, then 16-31...
   */
  maxConcurrency: number;
  shards: Collection<number, DiscordenoShard>;
  loadingShards: Collection<
    number,
    {
      shardId: number;
      resolve: (value: unknown) => void;
      startedAt: number;
    }
  >;
  /** Stored as bucketId: { clusters: [clusterId, [ShardIds]], createNextShard: boolean } */
  buckets: Collection<
    number,
    {
      clusters: number[][];
      createNextShard: (() => unknown)[];
    }
  >;
  utf8decoder: TextDecoder;

  // METHODS

  /** The handler function that starts the gateway. */
  startGateway: typeof startGateway;
  /** The handler for spawning ALL the shards. */
  spawnShards: typeof spawnShards;
  /** Create the websocket and adds the proper handlers to the websocket. */
  createShard: typeof createShard;
  /** Begins identification of the shard to discord. */
  identify: typeof identify;
  /** Begins heartbeating of the shard to keep it alive. */
  heartbeat: typeof heartbeat;
  /** Sends the discord payload to another server. */
  handleDiscordPayload: typeof handleDiscordPayload;
  /** Tell the cluster/worker to begin identifying this shard  */
  tellClusterToIdentify: typeof tellClusterToIdentify;
  /** Handle the different logs. Used for debugging. */
  log: typeof log;
  /** Handles resharding the bot when necessary. */
  resharder: typeof resharder;
  /** Handles the message events from websocket. */
  handleOnMessage: typeof handleOnMessage;
  /** Handles processing queue of requests send to this shard. */
  processQueue: typeof processQueue;
  /** Closes shard WebSocket connection properly. */
  closeWS: typeof closeWS;
  /** Properly adds a message to the shards queue. */
  sendShardMessage: typeof sendShardMessage;
  /** Properly resume an old shards session. */
  resume: typeof resume;
}

export interface EventHandlers {
  debug: (text: string) => unknown;
  channelCreate: (bot: Bot, channel: DiscordenoChannel) => unknown;
  dispatchRequirements: (bot: Bot, data: GatewayPayload, shardId: number) => Promise<unknown> | unknown;
}

export function createBotConstants() {
  return {
    DISCORDENO_VERSION,
    USER_AGENT,
    BASE_URL: baseEndpoints.BASE_URL,
    CDN_URL: baseEndpoints.CDN_URL,
    endpoints,
    regexes: {
      SLASH_COMMANDS_NAME_REGEX,
      CONTEXT_MENU_COMMANDS_NAME_REGEX,
      CHANNEL_MENTION_REGEX,
      DISCORD_SNOWFLAKE_REGEX,
    },
  };
}
