# SeemsImBot 2.0

A Discord bot that mixes trusted moderation, AI chat, and silly commands.

## What It Does

- Mention the bot and ask it to `ban`, `kick`, `mute`, or `unmute` a mentioned user.
- Only user IDs in `trustedModeratorIds` can make moderation requests.
- Only user IDs in `personalityToggleUserIds` can switch the chat personality.
- Only user IDs in `songPlayerUserIds` can make the bot join voice chat.
- User IDs in `protectedUserIds` cannot be banned, kicked, muted, or unmuted by the bot.
- The bot DMs the target before banning, kicking, muting, or unmuting them.
- The bot can chat in DMs, when mentioned, or when someone replies to it.
- `!stclassic` switches the bot back to the classic personality.
- `!stuseful` switches the bot to the useful personality.
- `!shelp` lists the available commands.
- `!sfact` replies with a random fact.
- `!sroast @user` roasts the mentioned user. Without a user, it asks you to specify one.
- `!sroll <number of rolls>` rolls 1 to 10 times for rare roles: Gold (1 in 10000), Fire (1 in 5000), Silver (1 in 1000), Water (1 in 500), Green (1 in 100), and Red (1 in 10).
- `!svc` joins the command sender's current voice channel.
- `!splay <song name>` searches YouTube and adds the first result to the queue.
- `!sskip` skips the current song. If the queue is empty, playback stops.

## Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Copy the env example:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `.env`:

   ```env
   DISCORD_TOKEN=your_discord_bot_token
   OLLAMA_API_KEY=your_ollama_cloud_api_key
   OLLAMA_MODEL=gpt-oss:120b
   OLLAMA_HOST=https://ollama.com
   ```

4. Edit `config.json`:

   - Put your Discord user ID in `trustedModeratorIds`.
   - Put protected user IDs in `protectedUserIds`.
   - Put personality switcher user IDs in `personalityToggleUserIds`.
   - Put voice join user IDs in `songPlayerUserIds`.
   - Put the Discord role IDs for roll rewards in `rollRoleIds`.
   - Customize `chat.systemPrompt`.
   - Customize `chat.personalityPrompts.classic` and `chat.personalityPrompts.useful`.
   - Customize `roast.prompt`.
   - Add or remove facts in `sinfoFacts`.

   Keep `.env` and `config.json` private. They are ignored by git; publish `.env.example` and `config.example.json` instead.

5. Enable these bot options in the Discord Developer Portal:

   - Server Members Intent
   - Message Content Intent
   - Voice State Intent

6. Invite the bot with these permissions:

   - View Channels
   - Send Messages
   - Read Message History
   - Moderate Members
   - Kick Members
   - Ban Members
   - Manage Roles
   - Connect
   - Speak

7. Start the bot:

   ```powershell
   npm.cmd start
   ```

## Examples

```text
@SeemsImBot ban @SomeUser for spamming links
@SeemsImBot kick @SomeUser for being rude
@SeemsImBot mute @SomeUser for 10 minutes for flooding chat
@SeemsImBot unmute @SomeUser for appeal accepted
!stclassic
!stuseful
!shelp
!sfact
!sroast @SomeUser
!sroll 10
!svc
!splay never gonna give you up
!sskip
```

## Notes

- Mute uses Discord timeout. You can say durations like `10 minutes`, `2 hours`, or `1 day`. If you skip the duration, it uses `moderation.defaultMuteMinutes` from `config.json`.
- The bot still has to obey Discord role order. Put the bot role above roles it should moderate.
- `!sroll` only assigns roles by the IDs in `config.json` under `rollRoleIds`. Create the roles in Discord first, paste their role IDs into config, then put the bot role above those roles so it can assign them.
- `!svc` only works for users listed in `songPlayerUserIds`. `!splay` can queue songs before the bot joins voice; playback starts once an allowed user runs `!svc`.
- If `OLLAMA_API_KEY` is empty, AI chat and AI roasts fall back to simple built-in replies.
- For direct Ollama Cloud API access, use `OLLAMA_HOST=https://ollama.com` and a cloud model such as `gpt-oss:120b`.
- If you prefer the local Ollama app with a cloud model pulled locally, use `OLLAMA_HOST=http://localhost:11434` and a model name such as `gpt-oss:120b-cloud`.
