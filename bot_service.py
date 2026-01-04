import asyncio
import logging
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

import discord
from discord.ext import commands, tasks

logger = logging.getLogger(__name__)


@dataclass
class ChannelInvite:
  id: str
  guild_id: int
  target_user_id: int
  channel_name: str
  requested_by: Optional[int]
  expires_at: datetime
  channel_id: Optional[int] = None
  invite_url: Optional[str] = None
  accepted: bool = False

  def to_dict(self) -> Dict[str, str]:
    return {
      "invitation_id": self.id,
      "guild_id": str(self.guild_id),
      "target_user_id": str(self.target_user_id),
      "channel_id": str(self.channel_id) if self.channel_id else None,
      "expires_at": self.expires_at.isoformat(),
      "accepted": self.accepted,
      "invite_url": self.invite_url,
    }


class JoinLinkView(discord.ui.View):
  def __init__(self, url: str):
    super().__init__(timeout=300)
    self.add_item(discord.ui.Button(label="Перейти в канал", url=url))


class InviteAcceptView(discord.ui.View):
  def __init__(self, service: "DiscordBotService", invite_id: str):
    super().__init__(timeout=1800)
    self.service = service
    self.invite_id = invite_id

  @discord.ui.button(label="Принять приглашение", style=discord.ButtonStyle.primary)
  async def accept(self, interaction: discord.Interaction, button: discord.ui.Button):  # type: ignore[override]
    invite = self.service.invites.get(self.invite_id)
    if not invite:
      await interaction.response.send_message("Приглашение больше недоступно.", ephemeral=True)
      return

    if interaction.user.id != invite.target_user_id:
      await interaction.response.send_message("Это приглашение адресовано другому пользователю.", ephemeral=True)
      return

    channel = await self.service.fetch_channel(invite.channel_id)
    if not channel:
      await interaction.response.send_message("Канал уже удалён или недоступен.", ephemeral=True)
      return

    permission_target = channel.guild.get_member(invite.target_user_id)
    if permission_target:
      await channel.set_permissions(permission_target, view_channel=True, connect=True)

    await channel.set_permissions(channel.guild.default_role, view_channel=True, connect=False)
    invite.accepted = True

    if not invite.invite_url:
      invite.invite_url = (await channel.create_invite(reason="Принято приглашение", max_uses=1, unique=True)).url

    await interaction.response.send_message(
      "Доступ выдан. Перейдите по ссылке, чтобы подключиться.", view=JoinLinkView(invite.invite_url), ephemeral=True
    )


class DiscordBotService:
  def __init__(self, token: str):
    self.token = token
    self.invites: Dict[str, ChannelInvite] = {}
    self.loop: Optional[asyncio.AbstractEventLoop] = None
    self.thread: Optional[threading.Thread] = None
    self.ready_event = threading.Event()
    intents = discord.Intents.default()
    intents.members = True
    intents.guilds = True
    self.bot = commands.Bot(command_prefix="!", intents=intents)
    self.bot.event(self.on_ready)
    self.bot.event(self.on_voice_state_update)
    self.cleanup_task = None

  async def on_ready(self):
    logger.info("Discord bot authenticated as %s", self.bot.user)
    self.ready_event.set()
    if not self.cleanup_task:
      self.cleanup_task = self.cleanup_channels.start()

  async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
    if before.channel and before.channel.id in {inv.channel_id for inv in self.invites.values() if inv.channel_id}:
      await self._delete_if_empty(before.channel)

  async def fetch_guild(self, guild_id: int) -> Optional[discord.Guild]:
    guild = self.bot.get_guild(guild_id)
    if guild:
      return guild
    try:
      return await self.bot.fetch_guild(guild_id)
    except discord.HTTPException:
      logger.exception("Не удалось получить сервер %s", guild_id)
      return None

  async def fetch_channel(self, channel_id: Optional[int]) -> Optional[discord.VoiceChannel]:
    if not channel_id:
      return None
    channel = self.bot.get_channel(channel_id)
    if isinstance(channel, discord.VoiceChannel):
      return channel
    try:
      fetched = await self.bot.fetch_channel(channel_id)
      return fetched if isinstance(fetched, discord.VoiceChannel) else None
    except discord.HTTPException:
      return None

  def start(self):
    if self.thread and self.thread.is_alive():
      return
    self.thread = threading.Thread(target=self._run_bot, daemon=True)
    self.thread.start()

  def restart_with_token(self, token: str):
    self.token = token
    self.stop()
    self.bot = commands.Bot(command_prefix="!", intents=self.bot.intents)
    self.bot.event(self.on_ready)
    self.bot.event(self.on_voice_state_update)
    self.start()

  def stop(self):
    if not self.loop:
      return
    self.ready_event.clear()
    try:
      asyncio.run_coroutine_threadsafe(self._shutdown(), self.loop).result(timeout=15)
    except Exception:  # noqa: BLE001
      logger.exception("Ошибка остановки бота")
    finally:
      self.loop.call_soon_threadsafe(self.loop.stop)
      if self.thread:
        self.thread.join(timeout=10)
      self.loop = None
      self.thread = None
      self.cleanup_task = None
      self.invites.clear()

  def _run_bot(self):
    self.loop = asyncio.new_event_loop()
    asyncio.set_event_loop(self.loop)
    self.loop.create_task(self.bot.start(self.token))
    self.loop.run_forever()

  async def _shutdown(self):
    if self.cleanup_task:
      self.cleanup_task.cancel()
    await self.bot.close()

  def create_invitation_request(
    self,
    guild_id: int,
    target_user_id: int,
    channel_name: str,
    expires_in_minutes: int = 30,
    requested_by: Optional[int] = None,
  ) -> ChannelInvite:
    invite = ChannelInvite(
      id=str(uuid.uuid4()),
      guild_id=guild_id,
      target_user_id=target_user_id,
      channel_name=channel_name,
      requested_by=requested_by,
      expires_at=datetime.now(timezone.utc) + timedelta(minutes=expires_in_minutes),
    )

    if not self.loop:
      raise RuntimeError("Discord event loop не инициализирован")

    future = asyncio.run_coroutine_threadsafe(self._create_channel_and_notify(invite), self.loop)
    return future.result(timeout=30)

  async def _create_channel_and_notify(self, invite: ChannelInvite) -> ChannelInvite:
    guild = await self.fetch_guild(invite.guild_id)
    if not guild:
      raise RuntimeError("Сервер не найден или бот не приглашён")

    overwrites = {
      guild.default_role: discord.PermissionOverwrite(view_channel=True, connect=False),
      guild.me: discord.PermissionOverwrite(view_channel=True, connect=True, manage_channels=True),
    }

    channel = await guild.create_voice_channel(invite.channel_name, overwrites=overwrites, reason="Создание приватного канала")
    invite.channel_id = channel.id
    self.invites[invite.id] = invite

    target = await self._fetch_user(invite.target_user_id)
    if target:
      view = InviteAcceptView(self, invite.id)
      description = (
        f"Вас пригласили в приватный голосовой канал **{invite.channel_name}** на сервере **{guild.name}**.\n"
        "Нажмите кнопку, чтобы принять приглашение и получить ссылку."
      )
      try:
        await target.send(description, view=view)
      except discord.Forbidden:
        logger.warning("Не удалось отправить DM пользователю %s", target)
        raise RuntimeError("Пользователю нельзя отправить личное сообщение. Откройте DM или разрешите сообщения от сервера.")
    else:
      raise RuntimeError("Не удалось получить информацию о пользователе")

    return invite

  async def _delete_if_empty(self, channel: discord.VoiceChannel):
    if channel.members:
      return
    await channel.delete(reason="Очистка пустого приватного канала")
    stale = [inv_id for inv_id, inv in self.invites.items() if inv.channel_id == channel.id]
    for inv_id in stale:
      self.invites.pop(inv_id, None)

  async def _fetch_user(self, user_id: int) -> Optional[discord.User]:
    user = self.bot.get_user(user_id)
    if user:
      return user
    try:
      return await self.bot.fetch_user(user_id)
    except discord.HTTPException:
      logger.exception("Не удалось получить пользователя %s", user_id)
      return None

  @tasks.loop(minutes=1)
  async def cleanup_channels(self):
    now = datetime.now(timezone.utc)
    for invite_id, invite in list(self.invites.items()):
      channel = await self.fetch_channel(invite.channel_id)
      if invite.expires_at <= now:
        if channel:
          await channel.delete(reason="Время приглашения истекло")
        self.invites.pop(invite_id, None)
        continue
      if channel and not channel.members and invite.accepted:
        await channel.delete(reason="Приглашённые покинули канал")
        self.invites.pop(invite_id, None)

  @cleanup_channels.before_loop
  async def before_cleanup(self):
    await self.bot.wait_until_ready()
