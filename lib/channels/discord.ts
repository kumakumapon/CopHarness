/** Discord bot: answers DMs and @mentions through the shared gateway. */
import type { Client as DiscordClient, Message as DiscordMessage } from 'discord.js';
import type { Runtime } from '../runtime';
import type { ImagePart } from '../types';
import { getGateway } from './gateway';
import { splitText } from './notify';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function fetchImages(message: DiscordMessage): Promise<ImagePart[]> {
  const images: ImagePart[] = [];
  for (const att of message.attachments.values()) {
    const type = att.contentType ?? '';
    if (!/^image\/(png|jpeg|gif|webp)/.test(type) || att.size > MAX_IMAGE_BYTES) continue;
    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      images.push({ type: 'image', mimeType: type.split(';')[0], data: Buffer.from(await res.arrayBuffer()).toString('base64') });
    } catch { /* skip unreadable attachments */ }
  }
  return images;
}

export async function startDiscord(runtime: Runtime, token: string): Promise<DiscordClient> {
  const { Client, Events, GatewayIntentBits, Partials } = await import('discord.js');
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel],
  });
  const gateway = getGateway(runtime);

  client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !client.user) return;
    const isDm = !message.guild;
    if (!isDm && !message.mentions.has(client.user)) return;
    const text = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    const channel = message.channel;
    await gateway.handle({
      channel: 'discord',
      userId: message.author.id,
      conversationKey: isDm ? `discord:dm:${message.author.id}` : `discord:${channel.id}`,
      owner: isDm ? `discord:${message.author.id}` : `discord-channel:${channel.id}`,
      text,
      images: await fetchImages(message),
    }, {
      send: async reply => {
        for (const chunk of splitText(reply, 2000)) {
          if ('send' in channel && typeof channel.send === 'function') await channel.send(chunk);
        }
      },
      typing: () => { if ('sendTyping' in channel) void channel.sendTyping().catch(() => undefined); },
    }).catch(err => console.error('[discord]', err));
  });

  client.once(Events.ClientReady, ready => console.info(`[discord] ${ready.user.tag} として接続しました`));
  await client.login(token);
  return client;
}
