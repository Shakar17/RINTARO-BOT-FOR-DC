const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function splitText(content, size = 1900) {
  return content ? content.match(new RegExp(`.{1,${size}}`, 'gs')) : [];
}

async function sendToAllMembers(message, content, onProgress = async () => {}) {
  const files = [...(message.attachments?.values() ?? [])].map((attachment) => ({ attachment: attachment.url, name: attachment.name }));
  if (!content && files.length === 0) return { ok: false, message: 'Usage: `!sendall <message>` or attach an image/file.' };
  const textParts = splitText(content);
  const attachmentBatches = [];
  for (let index = 0; index < files.length; index += 10) {
    attachmentBatches.push(files.slice(index, index + 10));
  }
  const totalMessages = Math.max(textParts.length, attachmentBatches.length, 1);

  let members;
  try {
    members = await message.guild.members.fetch();
  } catch (error) {
    console.error(`[sendall:${message.guild.id}] member fetch failed: ${error.message}`);
    return {
      ok: false,
      message: 'Could not load server members. Enable Server Members Intent in Developer Portal → Bot, restart the bot, and try again.'
    };
  }
  const recipients = [...members.values()].filter((member) => !member.user.bot);
  const delayMs = Math.max(0, Number(process.env.SENDALL_DELAY_MS) || 100);
  const concurrency = Math.max(1, Number(process.env.SENDALL_CONCURRENCY) || 50);
  let sent = 0;
  let failed = 0;

  for (let start = 0; start < recipients.length; start += concurrency) {
    const batch = recipients.slice(start, start + concurrency);
    const results = await Promise.all(batch.map(async (member) => {
      try {
        for (let index = 0; index < totalMessages; index += 1) {
          await member.send({
            ...(textParts[index] ? { content: textParts[index] } : {}),
            ...(attachmentBatches[index] ? { files: attachmentBatches[index] } : {})
          });
        }
        return true;
      } catch {
        return false;
      }
    }));
    sent += results.filter(Boolean).length;
    failed += results.filter((result) => !result).length;
    await onProgress({ sent, failed, total: recipients.length });
    await delay(delayMs);
  }

  return {
    ok: true,
    message: `DM broadcast complete. Sent: ${sent} | Failed or closed DMs: ${failed} | Members checked: ${recipients.length}.`
  };
}

module.exports = { sendToAllMembers };
