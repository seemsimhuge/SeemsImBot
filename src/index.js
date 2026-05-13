import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ollama } from 'ollama';
import play from 'play-dl';
import youtubedl from 'youtube-dl-exec';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnectionStatus
} from '@discordjs/voice';
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField
} from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('Missing config.json. Copy config.example.json to config.json and edit it first.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
let activePersonality = config.chat?.defaultPersonality || 'classic';
const ollamaHost = process.env.OLLAMA_HOST || 'https://ollama.com';
const hasCloudKey = Boolean(process.env.OLLAMA_API_KEY);
const usesLocalOllama = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(ollamaHost);
const ollama = hasCloudKey || usesLocalOllama
  ? new Ollama({
    host: ollamaHost,
    headers: hasCloudKey
      ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` }
      : undefined
  })
  : null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

const musicStates = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  try {
    if (await handleShelp(message)) return;
    if (await handleSinfo(message)) return;
    if (await handleSroast(message)) return;
    if (await handleSroll(message)) return;
    if (await handleSvc(message)) return;
    if (await handleSplay(message)) return;
    if (await handleSskip(message)) return;
    if (await handlePersonalityToggle(message)) return;
    if (await handleModerationRequest(message)) return;
    await handleChat(message);
  } catch (error) {
    console.error(error);
    await safeReply(message, 'I cant do shit right now.');
  }
});

async function handleShelp(message) {
  if (message.content.trim().toLowerCase() !== '!shelp') return false;

  await message.reply([
    '**SeemsImBot commands**',
    '**AI CHATBOT**',
    '`!stclassic` - switch to the classic personality.(Restricted)',
    '`!stuseful` - switch to the useful personality.(Restricted)',
    '**TEXT COMMANDS**',
    '`!shelp` - show this command list.',
    '`!sfact` - get a random fact.',
    '`!sroast @user` - roast a mentioned user.',
    '**ROLE ROLLING COMMANDS**',
    '`!sroll <1-10>` - roll for rare roles.',
    '**VOICE CHAT COMMANDS**',
    '`!svc` - join your voice channel. Only allowed users can use this. (Restricted)',
    '`!splay <song name>` - add a YouTube song to the queue.',
    '`!sskip` - skip the current song.',
    '**MODERATION COMMANDS** (Restricted to admins)',
    '`@SeemsImBot ban @user for [REASON]` - ban a user.',
    '`@SeemsImBot kick @user for [REASON]` - kick a user.',
    '`@SeemsImBot mute @user for [TIME] for [REASON]` - mute a user.',
    '`@SeemsImBot unmute @user for [REASON]` - unmute a user.'
  ].join('\n'));
  return true;
}

async function handleSinfo(message) {
  if (message.content.trim().toLowerCase() !== '!sfact') return false;

  const facts = config.sinfoFacts?.length ? config.sinfoFacts : ['Discord bots are powered by caffeine and permissions.'];
  await message.reply(randomItem(facts));
  return true;
}

const rollRoles = [
  { key: 'gold', displayName: '🥇 GOLD!!! (1 In 10000)', odds: 10000 },
  { key: 'fire', displayName: '🔥 FIRE!! (1 In 5000)', odds: 5000 },
  { key: 'silver', displayName: '🥈 SILVER! (1 In 1000)', odds: 1000 },
  { key: 'water', displayName: '💧 WATER (1 In 500)', odds: 500 },
  { key: 'green', displayName: '🟩 GREEN (1 In 100)', odds: 100 },
  { key: 'red', displayName: '🟥 RED (1 In 10)', odds: 10 }
];

const rollRangeMax = 10000;

async function handleSroll(message) {
  const parts = message.content.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== '!sroll') return false;

  if (!message.guild) {
    await message.reply('You can only roll for roles in a server.');
    return true;
  }

  const rollCount = Number(parts[1]);
  if (!Number.isInteger(rollCount) || rollCount < 1 || rollCount > 10) {
    await message.reply('Use `!sroll <number of rolls>` with a number from 1 to 10.');
    return true;
  }

  if (!message.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await message.reply('I need the Manage Roles permission before I can hand out roll roles.');
    return true;
  }

  const rolesByKey = new Map();
  const missingRollRoles = [];
  for (const rollRole of rollRoles) {
    const role = await findRollRole(message.guild, rollRole);
    if (!role) {
      missingRollRoles.push(`${rollRole.displayName} (${rollRole.key})`);
      continue;
    }

    if (!canAssignRole(message, role)) return true;
    rolesByKey.set(rollRole.key, role);
  }

  if (missingRollRoles.length > 0) {
    await message.reply(`I could not find role IDs for: ${missingRollRoles.join(', ')}. Add their IDs to config.json under rollRoleIds, then try again.`);
    return true;
  }

  const wins = [];
  for (let index = 0; index < rollCount; index += 1) {
    const result = rollOnce();
    wins.push(result);
  }

  const wonRoleKeys = [...new Set(wins.filter(Boolean))];
  for (const roleKey of wonRoleKeys) {
    await message.member.roles.add(rolesByKey.get(roleKey), 'Won with !sroll');
  }

  const rollResults = wins.map((roleKey, index) => {
    const rollRole = rollRoles.find((role) => role.key === roleKey);
    const result = rollRole ? rollRole.displayName : 'Nothing...';
    return `Roll ${index + 1}: ${result}`;
  });

  const awardedText = wonRoleKeys.length
    ? `You won: ${wonRoleKeys.map((roleKey) => rolesByKey.get(roleKey).toString()).join(', ')}`
    : 'Better Luck Next Time...';

  await message.reply([
    `${message.author} rolled ${rollCount} time${rollCount === 1 ? '' : 's'}:`,
    ...rollResults,
    awardedText
  ].join('\n'));
  return true;
}

function rollOnce() {
  const roll = Math.floor(Math.random() * rollRangeMax) + 1;
  let rangeStart = 1;

  for (const role of rollRoles) {
    const rangeSize = rollRangeMax / role.odds;
    const rangeEnd = rangeStart + rangeSize - 1;
    if (roll >= rangeStart && roll <= rangeEnd) {
      return role.key;
    }
    rangeStart = rangeEnd + 1;
  }

  return null;
}

async function findRollRole(guild, rollRole) {
  const roleId = config.rollRoleIds?.[rollRole.key];
  if (!roleId) return null;

  return guild.roles.cache.get(roleId) || guild.roles.fetch(roleId).catch(() => null);
}

function canAssignRole(message, role) {
  const botHighestRole = message.guild.members.me.roles.highest;
  if (role.position >= botHighestRole.position) {
    message.reply(`I cannot assign ${role.name} because it is higher than or equal to my highest role.`);
    return false;
  }

  return true;
}

async function handleSvc(message) {
  if (message.content.trim().toLowerCase() !== '!svc') return false;

  if (!message.guild) {
    await message.reply('I can only join voice channels in a server.');
    return true;
  }

  if (!config.songPlayerUserIds?.includes(message.author.id)) {
    await message.reply('You are not allowed to make me join voice chat.');
    return true;
  }

  const voiceChannel = message.member?.voice?.channel;
  if (!voiceChannel) {
    await message.reply('Join a voice channel first, then use `!svc`.');
    return true;
  }

  if (!canUseVoiceChannel(message, voiceChannel)) return true;

  const state = getMusicState(message.guild.id);
  state.textChannel = message.channel;
  state.voiceChannelId = voiceChannel.id;
  state.connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
    selfDeaf: true
  });
  state.connection.subscribe(state.player);

  try {
    await entersState(state.connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    state.connection.destroy();
    state.connection = null;
    await message.reply('I could not connect to that voice channel.');
    return true;
  }

  await message.reply(`Joined ${voiceChannel.name}.`);
  if (state.player.state.status === AudioPlayerStatus.Idle) {
    await playNextSong(message.guild.id);
  }
  return true;
}

async function handleSplay(message) {
  const trimmed = message.content.trim();
  if (!trimmed.toLowerCase().startsWith('!splay')) return false;

  if (!message.guild) {
    await message.reply('I can only play songs in a server.');
    return true;
  }

  const query = trimmed.slice('!splay'.length).trim();
  if (!query) {
    await message.reply('Use `!splay <song name>`.');
    return true;
  }

  await message.channel.sendTyping();
  const song = await findYoutubeSong(query);
  if (!song) {
    await message.reply('I could not find that on YouTube.');
    return true;
  }

  const state = getMusicState(message.guild.id);
  state.textChannel = message.channel;
  state.queue.push(song);

  const position = state.queue.length;
  await message.reply(`Queued **${song.title}**${position > 1 ? ` at position ${position}.` : '.'}`);

  if (!state.connection) {
    await message.channel.send('Use `!svc` so i can play music (You gotta be authorized tho).');
    return true;
  }

  if (state.player.state.status === AudioPlayerStatus.Idle) {
    await playNextSong(message.guild.id);
  }
  return true;
}

async function handleSskip(message) {
  if (message.content.trim().toLowerCase() !== '!sskip') return false;

  if (!message.guild) {
    await message.reply('I can only skip songs in a server.');
    return true;
  }

  const state = musicStates.get(message.guild.id);
  if (!state?.currentSong && state?.player.state.status !== AudioPlayerStatus.Playing) {
    await message.reply('Nothing is playing right now.');
    return true;
  }

  state.player.stop(true);
  await message.reply(state.queue.length ? 'Skipped. Playing the next song.' : 'Skipped. Queue is empty now.');
  return true;
}

function getMusicState(guildId) {
  const existing = musicStates.get(guildId);
  if (existing) return existing;

  const state = {
    queue: [],
    currentSong: null,
    currentProcess: null,
    playStartedAt: null,
    connection: null,
    textChannel: null,
    voiceChannelId: null,
    player: createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause
      }
    })
  };

  state.player.on(AudioPlayerStatus.Idle, () => {
    const endedSong = state.currentSong;
    const elapsedSeconds = state.playStartedAt
      ? Math.round((Date.now() - state.playStartedAt) / 1000)
      : 0;
    if (endedSong) {
      console.log(`Audio player became idle after ${elapsedSeconds}s: ${endedSong.title}`);
    }
    stopCurrentAudioProcess(state);
    state.currentSong = null;
    state.playStartedAt = null;
    playNextSong(guildId).catch((error) => {
      console.error(error);
      state.textChannel?.send('I had trouble starting the next song.').catch(() => null);
    });
  });

  state.player.on('error', (error) => {
    console.error(error);
    const failedSong = state.currentSong;
    stopCurrentAudioProcess(state);
    state.currentSong = null;
    state.playStartedAt = null;
    state.textChannel?.send(`I could not play **${failedSong?.title ?? 'that song'}**, skipping it.`).catch(() => null);
  });

  musicStates.set(guildId, state);
  return state;
}

async function playNextSong(guildId) {
  const state = musicStates.get(guildId);
  if (!state?.connection) return;

  const nextSong = state.queue.shift();
  if (!nextSong) {
    state.currentSong = null;
    return;
  }

  state.currentSong = nextSong;
  if (!isValidHttpUrl(nextSong.url)) {
    state.textChannel?.send(`I could not play **${nextSong.title ?? 'that song'}** because YouTube did not return a valid URL.`).catch(() => null);
    state.currentSong = null;
    state.playStartedAt = null;
    await playNextSong(guildId);
    return;
  }

  stopCurrentAudioProcess(state);
  const audioProcess = createYoutubeAudioProcess(nextSong.url);
  state.currentProcess = audioProcess;
  audioProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) console.error(`yt-dlp: ${text}`);
  });
  audioProcess.on('close', (code, signal) => {
    if (signal !== 'SIGTERM' && code !== 0) {
      console.error(`yt-dlp exited early for ${nextSong.title}. Code: ${code}, signal: ${signal ?? 'none'}`);
    }
  });

  const probedStream = await demuxProbe(audioProcess.stdout);
  const resource = createAudioResource(probedStream.stream, {
    inputType: probedStream.type
  });

  state.playStartedAt = Date.now();
  state.player.play(resource);
  state.connection.subscribe(state.player);
  state.textChannel?.send(`Now playing **${nextSong.title}**.`).catch(() => null);
}

function createYoutubeAudioProcess(url) {
  return spawn(youtubedl.constants.YOUTUBE_DL_PATH, [
    url,
    '--output', '-',
    '--format', 'bestaudio[ext=webm]/bestaudio',
    '--quiet',
    '--no-warnings',
    '--no-playlist',
    '--no-cache-dir',
    '--force-ipv4'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function stopCurrentAudioProcess(state) {
  if (state.currentProcess && !state.currentProcess.killed) {
    state.currentProcess.kill('SIGTERM');
  }
  state.currentProcess = null;
}

async function findYoutubeSong(query) {
  const urlType = play.yt_validate(query);
  if (urlType === 'video') {
    const info = await play.video_basic_info(query);
    const url = getYoutubeVideoUrl(info.video_details);
    if (!url) return null;

    return {
      title: info.video_details.title,
      url
    };
  }

  const results = await play.search(query, {
    limit: 1,
    source: { youtube: 'video' }
  });
  const video = results[0];
  if (!video) return null;
  const url = getYoutubeVideoUrl(video);
  if (!url) return null;

  return {
    title: video.title,
    url
  };
}

function getYoutubeVideoUrl(video) {
  if (isValidHttpUrl(video?.url)) return video.url;
  if (video?.id) return `https://www.youtube.com/watch?v=${video.id}`;
  return null;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function canUseVoiceChannel(message, voiceChannel) {
  const permissions = voiceChannel.permissionsFor(message.guild.members.me);
  if (!permissions?.has(PermissionsBitField.Flags.Connect)) {
    message.reply('I need permission to connect to that voice channel.');
    return false;
  }

  if (!permissions.has(PermissionsBitField.Flags.Speak)) {
    message.reply('I need permission to speak in that voice channel.');
    return false;
  }

  return true;
}

async function handleSroast(message) {
  const trimmed = message.content.trim();
  if (!trimmed.toLowerCase().startsWith('!sroast')) return false;

  const target = firstMentionedUser(message);
  if (!target) {
    await message.reply('Specify the person getting roasted.');
    return true;
  }

  const roast = await buildRoast(target);
  await message.reply(roast);
  return true;
}

async function handlePersonalityToggle(message) {
  const command = message.content.trim().toLowerCase();
  const personality = {
    '!stclassic': 'classic',
    '!stuseful': 'useful'
  }[command];

  if (!personality) return false;

  if (!config.personalityToggleUserIds?.includes(message.author.id)) {
    await message.reply('You are not allowed to toggle my personality.');
    return true;
  }

  activePersonality = personality;
  await message.reply(`✅ Personality switched to ${personality}.`);
  return true;
}

async function handleModerationRequest(message) {
  if (!message.guild || !message.mentions.has(client.user)) return false;

  const parsed = parseModerationCommand(message);
  if (!parsed) return false;

  if (!config.trustedModeratorIds?.includes(message.author.id)) {
    await message.reply('You are not on my trusted moderator list.');
    return true;
  }

  const targetMember = await findTargetMember(message);
  if (!targetMember) {
    await message.reply(`I need you to mention who to ${parsed.action}.`);
    return true;
  }

  if (targetMember.id === client.user.id) {
    await message.reply('Are you stupid or something? I wont do ANYTHING to myself, nice try.');
    return true;
  }

  if (config.protectedUserIds?.includes(targetMember.id)) {
    await message.reply('That person is protected, so I will not moderate them.');
    return true;
  }

  if (!canModerateMember(message, targetMember, parsed.action)) return true;

  const reason = parsed.reason || 'No reason provided';
  await performModerationAction(message, targetMember, parsed.action, reason, parsed.durationMinutes);
  return true;
}

async function handleChat(message) {
  if (!config.chat?.enabled) return;

  const shouldRespond = await shouldChatRespond(message);
  if (!shouldRespond) return;

  const userText = cleanBotMention(message.content).trim();
  if (!userText && message.guild) return;

  await message.channel.sendTyping();
  const reply = await buildChatReply(message, userText || message.content);
  await safeReply(message, reply);
}

function parseModerationCommand(message) {
  const text = cleanBotMention(message.content).toLowerCase();
  const action = ['unmute', 'ban', 'kick', 'mute'].find((candidate) => new RegExp(`\\b${candidate}\\b`).test(text));
  if (!action) return null;

  const target = firstMentionedUser(message);
  const commandText = cleanBotMention(message.content)
    .replace(new RegExp(`\\b${action}\\b`, 'i'), '')
    .replace(target ? `<@${target.id}>` : '', '')
    .replace(target ? `<@!${target.id}>` : '', '')
    .trim();

  const durationMinutes = action === 'mute' ? parseMuteDuration(commandText) : null;
  const reason = commandText
    .replace(action === 'mute' ? muteDurationPattern : /^$/, '')
    .replace(/^\s*for\s+/i, '')
    .trim();

  return { action, reason, durationMinutes };
}

const muteDurationPattern = /\b(?:for\s+)?(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i;

function parseMuteDuration(text) {
  const match = text.match(muteDurationPattern);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = {
    s: 1 / 60,
    sec: 1 / 60,
    secs: 1 / 60,
    second: 1 / 60,
    seconds: 1 / 60,
    m: 1,
    min: 1,
    mins: 1,
    minute: 1,
    minutes: 1,
    h: 60,
    hr: 60,
    hrs: 60,
    hour: 60,
    hours: 60,
    d: 1440,
    day: 1440,
    days: 1440
  }[unit];

  return Math.max(1, Math.min(Math.round(amount * multiplier), 28 * 24 * 60));
}

async function performModerationAction(message, targetMember, action, reason, durationMinutes = null) {
  const serverName = message.guild.name;
  const dmText = formatTemplate(config.moderation?.dmTemplates?.[action], {
    server: serverName,
    reason
  });

  await targetMember.send(dmText).catch(() => null);

  if (action === 'ban') {
    await targetMember.ban({ reason });
    await message.reply(`${targetMember.user.tag} has been banned. Reason: ${reason}`);
    return;
  }

  if (action === 'kick') {
    await targetMember.kick(reason);
    await message.reply(`${targetMember.user.tag} has been kicked. Reason: ${reason}`);
    return;
  }

  if (action === 'unmute') {
    await targetMember.timeout(null, reason);
    await message.reply(`${targetMember.user.tag} has been unmuted. Reason: ${reason}`);
    return;
  }

  const minutes = durationMinutes || Number(config.moderation?.defaultMuteMinutes) || 30;
  await targetMember.timeout(minutes * 60 * 1000, reason);
  await message.reply(`${targetMember.user.tag} has been muted for ${minutes} minutes. Reason: ${reason}`);
}

function canModerateMember(message, targetMember, action) {
  const me = message.guild.members.me;
  const requiredPermission = {
    ban: PermissionsBitField.Flags.BanMembers,
    kick: PermissionsBitField.Flags.KickMembers,
    mute: PermissionsBitField.Flags.ModerateMembers,
    unmute: PermissionsBitField.Flags.ModerateMembers
  }[action];

  if (!me.permissions.has(requiredPermission)) {
    message.reply(`I do not have permission to ${action} members.`);
    return false;
  }

  if (targetMember.roles.highest.position >= me.roles.highest.position) {
    message.reply('That person has a role that is too high for me to moderate.');
    return false;
  }

  if (targetMember.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
    message.reply('You cannot ask me to moderate someone with an equal or higher role than yours.');
    return false;
  }

  return true;
}

async function shouldChatRespond(message) {
  if (!message.guild) return Boolean(config.chat?.respondInDms);

  const allowedChannels = config.chat?.allowedChannelIds ?? [];
  if (allowedChannels.length > 0 && !allowedChannels.includes(message.channel.id)) {
    return false;
  }

  if (config.chat?.respondWhenMentioned && message.mentions.has(client.user)) {
    return true;
  }

  if (config.chat?.respondWhenRepliedTo && message.reference?.messageId) {
    const referenced = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    return referenced?.author.id === client.user.id;
  }

  return false;
}

async function buildChatReply(message, userText) {
  if (!ollama) {
    return 'My Ollama Cloud brain is not connected yet. Add OLLAMA_API_KEY in your .env file and I can actually chat.';
  }

  const response = await ollama.chat({
    model: process.env.OLLAMA_MODEL || 'gpt-oss:120b',
    messages: [
      { role: 'system', content: getChatSystemPrompt() },
      { role: 'user', content: `${message.author.username}: ${userText}` }
    ],
    stream: false,
    options: {
      num_predict: 220
    }
  });

  return response.message?.content?.trim() || 'I blanked for a second. Try me again.';
}

function getChatSystemPrompt() {
  return config.chat?.personalityPrompts?.[activePersonality] ||
    config.chat?.systemPrompt ||
    'You are SeemsImBot, a helpful Discord bot.';
}

async function buildRoast(target) {
  const targetName = target.username;
  if (!ollama) {
    return formatTemplate(randomItem(config.roast?.fallbacks ?? []), { target: targetName });
  }

  const prompt = formatTemplate(config.roast?.prompt, { target: targetName });
  const response = await ollama.chat({
    model: process.env.OLLAMA_MODEL || 'gpt-oss:120b',
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    options: {
      num_predict: 80
    }
  });

  return response.message?.content?.trim() || `${targetName}, your roast failed to load. Lucky day.`;
}

async function findTargetMember(message) {
  const user = firstMentionedUser(message);
  if (!user) return null;
  return message.guild.members.fetch(user.id).catch(() => null);
}

function firstMentionedUser(message) {
  return message.mentions.users.find((user) => user.id !== client.user.id);
}

function cleanBotMention(content) {
  return content
    .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '')
    .trim();
}

function formatTemplate(template = '', values = {}) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template
  );
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function safeReply(message, text) {
  const trimmed = String(text).slice(0, 1900);
  await message.reply(trimmed || '...');
}

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
