// ============================================================================
// D4C Embed Builder — simple template-based editor
// Click template → edit text directly in preview → paste channel ID → send
// ============================================================================

let dashboardKey = '';

// DOM references
const loginOverlay = document.getElementById('login-overlay');
const loginKeyInput = document.getElementById('login-key');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const appEl = document.getElementById('app');
const logoutBtn = document.getElementById('logout-btn');
const channelIdInput = document.getElementById('channel-id');
const validateChannelBtn = document.getElementById('validate-channel-btn');
const channelStatus = document.getElementById('channel-status');
const sendBtn = document.getElementById('send-btn');
const sendStatus = document.getElementById('send-status');

// Preview DOM (editable via contenteditable)
const previewTitle = document.getElementById('preview-title');
const previewDescription = document.getElementById('preview-description');
const previewFields = document.getElementById('preview-fields');

// Template definitions
const templates = {
  announcement: {
    title: '📢 Announcement',
    description: 'Important news for all members!',
    fields: [
      { name: '📋 What is Happening', value: 'What is being announced\nWhy it matters\nWho is affected' },
      { name: '⏰ Timeline', value: 'When this takes effect\nDuration (if applicable)\nKey dates to remember' },
      { name: '🎯 Action Required', value: 'What members need to do\nDeadlines to meet\nLinks to follow' },
      { name: '❓ FAQ', value: 'Common question 1\nCommon question 2\nCommon question 3' },
      { name: '📞 Contact', value: 'Reach out to staff\nDM a moderator\nCheck #help channel' }
    ]
  },
  event: {
    title: '🎉 Upcoming Event',
    description: 'Join us for an exciting event!',
    fields: [
      { name: '📅 Event Details', value: 'Event name and type\nDate and time (with timezone)\nLocation / Voice channel' },
      { name: '🎮 Activities', value: 'What we will do\nSpecial guests or hosts\nPrizes or rewards' },
      { name: '📝 Schedule', value: 'Start time and intro\nMain activities timeline\nEnd time and wrap-up' },
      { name: '✅ How to Join', value: 'React below to get notified\nBe online 10 minutes early\nHave fun!' },
      { name: '🏆 Prizes', value: '1st place reward\n2nd place reward\nParticipation rewards' },
      { name: '❓ Questions', value: 'Ask in #event-chat\nDM the event host\nCheck pinned messages' }
    ]
  },
  giveaway: {
    title: '🎁 Giveaway!',
    description: 'Win amazing prizes by entering below!',
    fields: [
      { name: '🏆 Prize', value: 'What you can win\nValue of the prize\nNumber of winners' },
      { name: '📝 How to Enter', value: 'React with 🎉 to this message\nBe a member of the server\nNo requirements!' },
      { name: '📋 Rules', value: 'Must be in server to claim\nWinner announced in 7 days\nNo alt accounts allowed' },
      { name: '⏰ Duration', value: 'Start date and time\nEnd date and time\nWinner announcement date' },
      { name: '🎲 Selection', value: 'Random selection method\nHow winner is notified\nClaim deadline' },
      { name: '💎 Sponsors', value: 'Sponsor name and link\nSponsor description\nSpecial sponsor perks' }
    ]
  },
  welcome: {
    title: '👋 Welcome to the Server!',
    description: 'We are glad to have you here!',
    fields: [
      { name: '📜 Server Info', value: 'Server name and purpose\nMember count\nFounded date' },
      { name: '📏 Rules', value: 'Be respectful to everyone\nNo spam or self-promote\nFollow Discord ToS' },
      { name: '🎭 Get Roles', value: 'Visit #roles channel\nPick your interests\nGet pinged for events' },
      { name: '💬 Channels', value: '#general for chatting\n#memes for fun stuff\n#help for questions' },
      { name: '🎁 Perks', value: 'Member-only events\nGiveaways and prizes\nLevel roles and rewards' },
      { name: '📞 Staff', value: 'Owner: @owner\nMods: @mod\nDM any staff for help' }
    ]
  },
  changelog: {
    title: '📝 Changelog',
    description: 'What is new in this update!',
    fields: [
      { name: '✨ New Features', value: 'Feature 1 description\nFeature 2 description\nFeature 3 description' },
      { name: '🔧 Improvements', value: 'Improvement 1\nImprovement 2\nImprovement 3' },
      { name: '🐛 Bug Fixes', value: 'Fixed issue 1\nFixed issue 2\nFixed issue 3' },
      { name: '⚠️ Known Issues', value: 'Issue 1 and workaround\nIssue 2 and workaround\nIssue 3 and workaround' },
      { name: '📅 Coming Soon', value: 'Planned feature 1\nPlanned feature 2\nPlanned feature 3' }
    ]
  },
  rules: {
    title: '📜 Server Rules',
    description: 'Please follow these rules at all times!',
    fields: [
      { name: '1️⃣ Be Respectful', value: 'No harassment or hate speech\nTreat others how you want to be treated\nRespect different opinions' },
      { name: '2️⃣ No Spam', value: 'No excessive messages\nNo unwanted DMs to members\nSelf-promo only in designated channels' },
      { name: '3️⃣ Content Guidelines', value: 'No NSFW content\nKeep conversations in correct channels\nNo piracy or illegal content' },
      { name: '4️⃣ Voice Chat Rules', value: 'No earrape or loud noises\nNo music bots without permission\nRespect others in VC' },
      { name: '5️⃣ Staff Authority', value: 'Staff decisions are final\nAppeals go through tickets\nRespect moderators' },
      { name: '⚠️ Punishments', value: '1st offense: Warning\n2nd offense: Mute (1 hour)\n3rd offense: Ban' }
    ]
  },
  serverUpdate: {
    title: '🚀 Server Update',
    description: 'Big changes are coming to the server!',
    fields: [
      { name: '📢 What\'s New', value: 'New feature 1\nNew feature 2\nNew feature 3' },
      { name: '🎨 New Channels', value: '#new-channel purpose\n#another-channel purpose\nUpdated channel topics' },
      { name: '👥 New Staff', value: 'Welcome new mod: @mod\nNew helper role added\nStaff team expanded' },
      { name: '🔧 Bot Updates', value: 'New bot commands added\nMusic bot improved\nAuto-mod enhanced' },
      { name: '📅 Upcoming', value: 'Next event planned\nFuture improvements\nCommunity suggestions' },
      { name: '💬 Feedback', value: 'Share your thoughts in #feedback\nSuggest new features\nReport any issues' }
    ]
  },
  application: {
    title: '📋 Staff Application',
    description: 'Apply to join our staff team!',
    fields: [
      { name: '📝 Requirements', value: 'Must be active daily\nAge 13+\nNo prior bans' },
      { name: '📋 How to Apply', value: 'Fill out the form below\nAnswer all questions honestly\nSubmit and wait for review' },
      { name: '❓ Questions', value: 'Why do you want to be staff?\nWhat can you contribute?\nHow many hours can you dedicate?' },
      { name: '⏰ Process', value: 'Submit application\nStaff reviews (24-48h)\nDecision via DM' },
      { name: '🎭 Roles Available', value: 'Moderator\nHelper\nEvent Manager\nMedia Team' },
      { name: '💎 Perks', value: 'Staff-only channel\nSpecial role and color\nEarly access to features' }
    ]
  },
  partnership: {
    title: '🤝 Partnership',
    description: 'We are partnering with an amazing server!',
    fields: [
      { name: '🌐 Partner Server', value: 'Server name and link\nMember count\nServer topic' },
      { name: '📜 About Them', value: 'What their server offers\nWhy we partnered\nShared interests' },
      { name: '🎁 Partner Perks', value: 'Mutual shoutouts\nShared events\nCross-server access' },
      { name: '📝 Requirements', value: 'Must join partner server\nFollow their rules\nBe active in both' },
      { name: '🔗 Links', value: 'Partner invite: [link]\nTheir social media\nPartnership details' }
    ]
  },
  warning: {
    title: '⚠️ Warning Notice',
    description: 'Please read this important notice!',
    fields: [
      { name: '⚠️ Issue', value: 'What the problem is\nWho is affected\nWhen it started' },
      { name: '📋 Required Action', value: 'What you need to do\nDeadline to complete\nHow to verify completion' },
      { name: '⚡ Consequences', value: 'What happens if ignored\nEscalation process\nFinal deadline' },
      { name: '📞 Need Help?', value: 'DM a moderator\nOpen a ticket in #support\nAsk in #help channel' }
    ]
  },
  faq: {
    title: '❓ Frequently Asked Questions',
    description: 'Answers to common questions!',
    fields: [
      { name: '❓ Question 1', value: 'Answer to question 1\nAdditional details\nRelated resources' },
      { name: '❓ Question 2', value: 'Answer to question 2\nAdditional details\nRelated resources' },
      { name: '❓ Question 3', value: 'Answer to question 3\nAdditional details\nRelated resources' },
      { name: '❓ Question 4', value: 'Answer to question 4\nAdditional details\nRelated resources' },
      { name: '❓ Question 5', value: 'Answer to question 5\nAdditional details\nRelated resources' },
      { name: '📞 Still Need Help?', value: 'DM a moderator\nOpen a ticket\nCheck #help channel' }
    ]
  },
  poll: {
    title: '📊 Community Poll',
    description: 'Vote and share your opinion!',
    fields: [
      { name: '📋 Question', value: 'What are we voting on?\nWhy this matters\nWho decided this' },
      { name: '🔘 Option A', value: 'Description of option A\nPros of this choice\nCons of this choice' },
      { name: '🔘 Option B', value: 'Description of option B\nPros of this choice\nCons of this choice' },
      { name: '🔘 Option C', value: 'Description of option C\nPros of this choice\nCons of this choice' },
      { name: '📝 How to Vote', value: 'React with corresponding emoji\nVote ends on [date]\nResults posted in #announcements' },
      { name: '📊 Results', value: 'Previous poll results\nParticipation stats\nNext poll topic' }
    ]
  },
  shoutout: {
    title: '📣 Shoutout',
    description: 'Give a shoutout to someone amazing!',
    fields: [
      { name: '🌟 Who', value: 'User being shoutout out\nTheir role in server\nHow long they have been here' },
      { name: '💪 What They Did', value: 'Specific contribution\nWhy it matters\nImpact on community' },
      { name: '🏆 Achievements', value: 'Recent accomplishments\nMilestones reached\nGoals achieved' },
      { name: '💬 From Who', value: 'Your name and role\nWhy you are giving this shoutout\nPersonal message' },
      { name: '🎉 Celebration', value: 'Congratulations message\nReward or prize\nCommunity reactions' }
    ]
  }
};

// Toast helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// API helper
async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-key': dashboardKey,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

// Login flow
loginBtn.addEventListener('click', () => {
  const key = loginKeyInput.value.trim();
  if (!key) {
    loginError.textContent = 'Please enter a dashboard key.';
    return;
  }
  dashboardKey = key;
  loginError.textContent = '';
  loginOverlay.classList.add('hidden');
  appEl.classList.remove('hidden');
  loadTemplate('announcement');
});

loginKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

logoutBtn.addEventListener('click', () => {
  dashboardKey = '';
  appEl.classList.add('hidden');
  loginOverlay.classList.remove('hidden');
  loginKeyInput.value = '';
});

// Template selector
document.querySelectorAll('.template-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.template-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadTemplate(btn.dataset.template);
  });
});

// Load template into editable preview
function loadTemplate(name) {
  const template = templates[name];
  if (!template) return;

  previewTitle.textContent = template.title;
  previewDescription.textContent = template.description;

  previewFields.innerHTML = '';
  template.fields.forEach((field) => addSection(field.name, field.value));

  showToast(`Loaded "${name}" template — click any text to edit`, 'info');
}

// Add a new editable section (custom section support)
function addSection(name = '📌 New Section', value = 'Click to edit this line\nAdd another line here') {
  const fieldEl = document.createElement('div');
  fieldEl.className = 'embed-field section-box';
  fieldEl.innerHTML = `
    <button class="section-remove" title="Remove section">✕</button>
    <div class="embed-field-name" contenteditable="true">${name}</div>
    <div class="embed-field-value" contenteditable="true">${value}</div>
  `;
  fieldEl.querySelector('.section-remove').addEventListener('click', () => {
    fieldEl.remove();
    showToast('Section removed', 'info');
  });
  previewFields.appendChild(fieldEl);
  return fieldEl;
}

// Add Section button
document.getElementById('add-section-btn').addEventListener('click', () => {
  addSection('📌 New Section', 'Edit this line\nAdd another line');
  showToast('Custom section added — click to edit', 'info');
});

// Channel validation
validateChannelBtn.addEventListener('click', async () => {
  const channelId = channelIdInput.value.trim();
  if (!/^\d{17,20}$/.test(channelId)) {
    channelStatus.textContent = 'Invalid ID format';
    channelStatus.className = 'channel-status invalid';
    showToast('Channel ID must be 17-20 digits.', 'error');
    return;
  }
  channelStatus.textContent = 'Checking...';
  channelStatus.className = 'channel-status muted';
  const { ok, data } = await apiFetch('/api/validate-channel', {
    method: 'POST',
    body: JSON.stringify({ channelId }),
  });
  if (ok && data.ok) {
    channelStatus.textContent = `${data.guildName} → ${data.channelName}`;
    channelStatus.className = 'channel-status valid';
  } else {
    channelStatus.textContent = data.message || 'Not found';
    channelStatus.className = 'channel-status invalid';
    showToast(data.message || 'Channel not found.', 'error');
  }
});

// Send to Discord
sendBtn.addEventListener('click', async () => {
  const channelId = channelIdInput.value.trim();
  if (!/^\d{17,20}$/.test(channelId)) {
    showToast('Enter a valid Channel ID first.', 'error');
    return;
  }

  // Build sections from the editable preview
  const sections = [];
  const fieldElements = previewFields.querySelectorAll('.embed-field');
  fieldElements.forEach((fieldEl) => {
    const name = fieldEl.querySelector('.embed-field-name').textContent.trim();
    const value = fieldEl.querySelector('.embed-field-value').textContent.trim();
    if (name || value) {
      sections.push({
        heading: name,
        lines: value.split('\n').filter((l) => l.trim()),
      });
    }
  });

  if (sections.length === 0) {
    showToast('Add at least one section.', 'error');
    return;
  }

  const title = previewTitle.textContent.trim();
  const description = previewDescription.textContent.trim();

  const payload = {
    channelId,
    title,
    description,
    sections,
  };

  sendBtn.disabled = true;
  sendStatus.textContent = 'Sending...';

  try {
    const { ok, data } = await apiFetch('/api/send-embed', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (ok && data.ok) {
      showToast('Embed sent successfully!', 'success');
      sendStatus.textContent = 'Sent ✓';
    } else {
      showToast(data.message || 'Failed to send embed.', 'error');
      sendStatus.textContent = 'Failed';
    }
  } catch (err) {
    showToast('Network error — is the bot running?', 'error');
    sendStatus.textContent = 'Error';
  } finally {
    sendBtn.disabled = false;
    setTimeout(() => { sendStatus.textContent = ''; }, 4000);
  }
});

// =========================== Control center ===============================
const guildSelect = document.getElementById('guild-select');
const controlChannel = document.getElementById('control-channel');
const purgeChannel = document.getElementById('purge-channel');
const verifyChannel = document.getElementById('verify-channel');
let selectedGuild = null;

function setOptions(select, options, placeholder) {
  select.innerHTML = `<option value="">${placeholder}</option>`;
  options.forEach((option) => {
    const element = document.createElement('option');
    element.value = option.id;
    element.textContent = `#${option.name}`;
    select.appendChild(element);
  });
}

async function loadGuilds() {
  const { ok, data } = await apiFetch('/api/guilds');
  if (!ok || !data.guilds?.length) {
    showToast(data.message || 'No servers are available.', 'error');
    return;
  }
  guildSelect.innerHTML = '<option value="">Select server</option>';
  data.guilds.forEach((guild) => {
    const option = document.createElement('option');
    option.value = guild.id;
    option.textContent = `${guild.name} (${guild.memberCount})`;
    guildSelect.appendChild(option);
  });
  guildSelect.value = data.guilds[0].id;
  await loadGuild(data.guilds[0].id);
}

async function loadGuild(guildId) {
  if (!guildId) return;
  const { ok, data } = await apiFetch(`/api/guilds/${guildId}`);
  if (!ok) return showToast(data.message || 'Could not load server.', 'error');
  selectedGuild = data.guild;
  document.getElementById('selected-guild-name').textContent = selectedGuild.name;
  document.getElementById('guild-stats').textContent = `${selectedGuild.memberCount} members • ${selectedGuild.channels.length} text channels`;
  setOptions(controlChannel, selectedGuild.channels, 'Select channel');
  setOptions(purgeChannel, selectedGuild.channels, 'Select channel');
  setOptions(verifyChannel, selectedGuild.channels, 'Select verify channel');
  renderMusic(selectedGuild.music);
}

function renderMusic(state) {
  const current = state?.current?.title || 'Nothing is playing';
  const queued = state?.tracks?.length || 0;
  document.getElementById('music-now').textContent = `${state?.paused ? 'Paused' : 'Ready'} • ${current} • ${queued} queued • ${state?.volume ?? 100}% volume`;
}

async function controlAction(path, payload, successMessage) {
  if (!selectedGuild) return showToast('Select a server first.', 'error');
  const { ok, data } = await apiFetch(path, { method: 'POST', body: JSON.stringify({ guildId: selectedGuild.id, ...payload }) });
  showToast(data.message || (ok ? successMessage : 'Action failed.'), ok ? 'success' : 'error');
  if (ok && data.music) renderMusic(data.music);
  return ok;
}

guildSelect.addEventListener('change', () => loadGuild(guildSelect.value));
document.getElementById('control-send-message').addEventListener('click', async () => {
  const ok = await controlAction('/api/message', { channelId: controlChannel.value, content: document.getElementById('control-message').value }, 'Message sent.');
  if (ok) document.getElementById('control-message').value = '';
});
document.getElementById('mod-submit').addEventListener('click', () => controlAction('/api/moderation', {
  userId: document.getElementById('mod-user-id').value,
  action: document.getElementById('mod-action').value,
  duration: document.getElementById('mod-duration').value,
  reason: document.getElementById('mod-reason').value,
}, 'Moderation action completed.'));
document.querySelectorAll('.music-action').forEach((button) => button.addEventListener('click', () => controlAction('/api/music', { action: button.dataset.action }, 'Music updated.')));
document.getElementById('music-volume-btn').addEventListener('click', () => controlAction('/api/music', { action: 'volume', volume: Number(document.getElementById('music-volume').value) }, 'Volume updated.'));
document.getElementById('verify-save').addEventListener('click', () => controlAction('/api/verification', { action: 'set-channel', channelId: verifyChannel.value }, 'Verification channel saved.'));
document.getElementById('verify-lock').addEventListener('click', () => controlAction('/api/verification', { action: 'lock' }, 'Server locked.'));
document.getElementById('purge-submit').addEventListener('click', () => controlAction('/api/purge', { channelId: purgeChannel.value, amount: Number(document.getElementById('purge-amount').value) }, 'Messages deleted.'));

loginBtn.addEventListener('click', () => {
  if (dashboardKey) loadGuilds();
});