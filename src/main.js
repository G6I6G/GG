const form = document.getElementById("invite-form");
const statusBox = document.getElementById("status");
const resetBtn = document.getElementById("reset-form");

const setStatus = (message, kind = "") => {
  statusBox.textContent = message;
  statusBox.className = `status ${kind}`.trim();
};

const toPayload = () => {
  const guildId = document.getElementById("guild-id").value.trim();
  const userId = document.getElementById("user-id").value.trim();
  const channelName = document.getElementById("channel-name").value.trim();
  const expiresIn = Number(document.getElementById("expires-in").value || 30);
  return { guild_id: guildId, user_id: userId, channel_name: channelName, expires_in: expiresIn };
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Отправляем запрос боту...", "");
  const payload = toPayload();
  if (!payload.guild_id || !payload.user_id || !payload.channel_name) {
    setStatus("Пожалуйста, заполните все обязательные поля", "error");
    return;
  }

  try {
    const response = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error || "Не удалось создать приглашение", "error");
      return;
    }

    const { invitation_id, channel_id, expires_at, message } = result;
    const lines = [message];
    if (channel_id) lines.push(`ID канала: ${channel_id}`);
    if (expires_at) lines.push(`Истекает: ${expires_at}`);
    lines.push(`Invite ID: ${invitation_id}`);
    setStatus(lines.join("\n"), "success");
  } catch (err) {
    setStatus(`Ошибка запроса: ${err.message}`, "error");
  }
});

resetBtn?.addEventListener("click", () => {
  form.reset();
  setStatus("Форма очищена");
});
