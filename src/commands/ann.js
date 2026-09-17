const { MessageFlags } = require('discord.js');
const recentAnnouncements = new Map();

function splitText(content, size = 1800) {
  return content ? content.match(new RegExp(`.{1,${size}}`, 'gs')) : [];
}

async function handleAnnouncement(message, content) {
  const files = [...(message.attachments?.values() ?? [])].map((attachment) => ({ attachment: attachment.url, name: attachment.name }));
  if (!content && files.length === 0) {
    return false;
  }

  const normalizedContent = content.replace(/\s+/g, ' ').trim().toLowerCase();
  const fingerprint = `${message.channel.id}:${normalizedContent}:${files.map((file) => file.attachment).sort().join(',')}`;
  const now = Date.now();
  const deduplicationWindow = Math.max(0, Number(process.env.ANNOUNCEMENT_DEDUP_MS) || 600000);
  const lastSent = recentAnnouncements.get(fingerprint) || 0;
  if (now - lastSent < deduplicationWindow) return false;
  recentAnnouncements.set(fingerprint, now);

  await message.delete().catch(() => {});
  const textParts = splitText(content).map((part) => {
    const escapedContent = part.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
    return `**${escapedContent}**`;
  });
  const attachmentBatches = [];
  for (let index = 0; index < files.length; index += 10) {
    attachmentBatches.push(files.slice(index, index + 10));
  }
  const totalMessages = Math.max(textParts.length, attachmentBatches.length, 1);
  for (let index = 0; index < totalMessages; index += 1) {
    await message.channel.send({
      ...(textParts[index] ? { content: textParts[index] } : {}),
      ...(attachmentBatches[index] ? { files: attachmentBatches[index] } : {}),
      flags: MessageFlags.SuppressEmbeds,
      allowedMentions: { parse: [] }
    });
  }
  return true;
}

module.exports = { handleAnnouncement };
