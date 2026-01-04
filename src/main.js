const inviteForm = document.getElementById("invite-form");
const tokenForm = document.getElementById("token-form");
const statusBox = document.getElementById("status");
const tokenStatusBox = document.getElementById("token-status");
const resetBtn = document.getElementById("reset-form");
const showTokenBtn = document.getElementById("show-token");
const healthList = document.getElementById("health-status");

const setStatus = (element, message, kind = "") => {
  if (!element) return;
  element.textContent = message;
  element.className = `status ${kind}`.trim();
};

const renderHealth = (data) => {
  if (!healthList) return;
  const rows = [];
  rows.push(`API: ${data.status}`);
  rows.push(`Бот готов: ${data.bot_ready ? "да" : "нет"}`);
  rows.push(`Токен настроен: ${data.token_configured ? "да" : "нет"}`);
  healthList.innerHTML = rows.map((text) => `<li>${text}</li>`).join("");
};

const loadHealth = async () => {
  try {
    const res = await fetch("/health");
    const data = await res.json();
    renderHealth(data);
  } catch (err) {
    healthList.innerHTML = `<li>Не удалось получить статус: ${err.message}</li>`;
  }
};

const buildInvitePayload = () => {
  const guildId = document.getElementById("guild-id")?.value.trim();
  const userId = document.getElementById("user-id")?.value.trim();
  const channelName = document.getElementById("channel-name")?.value.trim();
  const expiresIn = Number(document.getElementById("expires-in")?.value || 30);
  return { guild_id: guildId, user_id: userId, channel_name: channelName, expires_in: expiresIn };
};

inviteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus(statusBox, "Отправляем запрос боту...");
  const payload = buildInvitePayload();
  if (!payload.guild_id || !payload.user_id || !payload.channel_name) {
    setStatus(statusBox, "Пожалуйста, заполните все обязательные поля", "error");
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
      setStatus(statusBox, result.error || "Не удалось создать приглашение", "error");
      return;
    }

    const { invitation_id, channel_id, expires_at, message } = result;
    const lines = [message];
    if (channel_id) lines.push(`ID канала: ${channel_id}`);
    if (expires_at) lines.push(`Истекает: ${expires_at}`);
    lines.push(`Invite ID: ${invitation_id}`);
    setStatus(statusBox, lines.join("\n"), "success");
    loadHealth();
  } catch (err) {
    setStatus(statusBox, `Ошибка запроса: ${err.message}`, "error");
  }
});

resetBtn?.addEventListener("click", () => {
  inviteForm?.reset();
  setStatus(statusBox, "Форма очищена");
});

tokenForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const tokenInput = document.getElementById("bot-token");
  const token = tokenInput?.value.trim();
  if (!token) {
    setStatus(tokenStatusBox, "Укажите токен бота", "error");
    return;
  }

  setStatus(tokenStatusBox, "Перезапускаем бота с новым токеном...");
  try {
    const res = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(tokenStatusBox, data.error || "Не удалось обновить токен", "error");
      return;
    }
    setStatus(tokenStatusBox, data.message || "Токен обновлён", "success");
    loadHealth();
  } catch (err) {
    setStatus(tokenStatusBox, `Ошибка запроса: ${err.message}`, "error");
  }
});

showTokenBtn?.addEventListener("click", () => {
  const tokenInput = document.getElementById("bot-token");
  if (!tokenInput) return;
  tokenInput.type = tokenInput.type === "password" ? "text" : "password";
  showTokenBtn.textContent = tokenInput.type === "password" ? "Показать" : "Скрыть";
});

loadHealth();
