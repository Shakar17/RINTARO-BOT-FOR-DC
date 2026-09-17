const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

const ownersFile = path.resolve('data', 'owners.json');

function configuredOwners() {
  return (process.env.OWNER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function storedOwners() {
  try {
    return JSON.parse(fs.readFileSync(ownersFile, 'utf8'));
  } catch {
    return [];
  }
}

function ownerIds() {
  return [...new Set([...configuredOwners(), ...storedOwners()])];
}

function isOwner(userId) {
  return ownerIds().includes(userId);
}

function canManageOwners(message) {
  return isOwner(message.author.id) || message.member?.permissions.has(PermissionFlagsBits.Administrator);
}

async function addOwner(message, userId) {
  if (!/^\d{17,20}$/.test(userId)) return { ok: false, message: 'Usage: `!addowner <Discord user ID>`' };
  if (!canManageOwners(message)) return { ok: false, message: 'Only a verified owner or server Administrator can add owners.' };

  const user = await message.client.users.fetch(userId).catch(() => null);
  if (!user) return { ok: false, message: 'That Discord user ID could not be verified.' };
  const member = await message.guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, message: 'That user must be a member of this server.' };

  const owners = storedOwners();
  if (!owners.includes(userId)) {
    owners.push(userId);
    fs.mkdirSync(path.dirname(ownersFile), { recursive: true });
    fs.writeFileSync(ownersFile, `${JSON.stringify(owners, null, 2)}\n`);
  }
  return { ok: true, message: `Verified owner added: ${user.tag}` };
}

function removeOwner(message, userId) {
  if (!/^\d{17,20}$/.test(userId)) return { ok: false, message: 'Usage: `!removeowner <Discord user ID>`' };
  if (!canManageOwners(message)) return { ok: false, message: 'Only a verified owner or server Administrator can remove owners.' };
  if (configuredOwners().includes(userId)) return { ok: false, message: 'This owner is configured in OWNER_IDS and must be removed there.' };
  const owners = storedOwners();
  if (!owners.includes(userId)) return { ok: false, message: 'That user is not a stored verified owner.' };
  if (ownerIds().length <= 1) return { ok: false, message: 'Add another owner before removing the last verified owner.' };
  const remainingOwners = owners.filter((id) => id !== userId);
  fs.mkdirSync(path.dirname(ownersFile), { recursive: true });
  fs.writeFileSync(ownersFile, `${JSON.stringify(remainingOwners, null, 2)}\n`);
  return { ok: true, message: `Owner access removed for <@${userId}>.` };
}

module.exports = { addOwner, removeOwner, isOwner, canManageOwners, ownerIds };
