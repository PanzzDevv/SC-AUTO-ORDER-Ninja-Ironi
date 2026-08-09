// Shared session store for all bot handlers
const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) sessions[chatId] = {};
  return sessions[chatId];
}

function clearSession(chatId) {
  if (sessions[chatId]) {
    const mainMessageId = sessions[chatId].mainMessageId;
    const mainIsPhoto = sessions[chatId].mainIsPhoto;
    sessions[chatId] = {
      mainMessageId,
      mainIsPhoto
    };
  } else {
    sessions[chatId] = {};
  }
}

module.exports = { sessions, getSession, clearSession };
