import logging
import os
from typing import Any, Dict

from flask import Flask, jsonify, render_template, request

from bot_service import DiscordBotService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder=".", static_url_path="", template_folder=".")

token = os.environ.get("DISCORD_BOT_TOKEN")
if not token:
  raise RuntimeError("DISCORD_BOT_TOKEN не задан. Установите переменную окружения с токеном Discord-бота.")

bot_service = DiscordBotService(token)
bot_service.start()


@app.route("/")
def home():
  return render_template("index.html")


@app.post("/api/invite")
def create_invite():
  payload: Dict[str, Any] = request.get_json(force=True) or {}

  try:
    guild_id = int(payload.get("guild_id"))
    target_user_id = int(payload.get("user_id"))
    channel_name = str(payload.get("channel_name"))[:80].strip()
  except (TypeError, ValueError):
    return jsonify({"error": "Невалидные идентификаторы или пустое имя канала"}), 400

  if not channel_name:
    return jsonify({"error": "Укажите название канала"}), 400

  expires_in = payload.get("expires_in")
  try:
    expires_in = int(expires_in) if expires_in is not None else 30
  except (TypeError, ValueError):
    expires_in = 30

  expires_in = max(1, min(expires_in, 240))

  if not bot_service.ready_event.wait(timeout=15):
    return jsonify({"error": "Бот не успел подключиться. Попробуйте ещё раз."}), 503

  try:
    invitation = bot_service.create_invitation_request(
      guild_id=guild_id,
      target_user_id=target_user_id,
      channel_name=channel_name,
      expires_in_minutes=expires_in,
    )
  except Exception as exc:  # noqa: BLE001
    logger.exception("Не удалось создать приглашение")
    return jsonify({"error": str(exc)}), 500

  return jsonify({
    "message": "Запрос отправлен. Проверьте личные сообщения приглашённого пользователя.",
    **invitation.to_dict(),
  })


@app.get("/health")
def health():
  return {"status": "ok", "bot_ready": bot_service.ready_event.is_set()}


if __name__ == "__main__":
  app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
