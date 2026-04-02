from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from agena_core.db.base import Base


class UserPreference(Base):
    """Kullanıcı başına sprint seçimi ve diğer tercihler."""
    __tablename__ = 'user_preferences'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), unique=True, index=True)
    # Azure sprint seçimi
    azure_project: Mapped[str | None] = mapped_column(String(255), nullable=True)
    azure_team: Mapped[str | None] = mapped_column(String(255), nullable=True)
    azure_sprint_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Seçili takım üyeleri (JSON array of {id, displayName, uniqueName})
    my_team_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Agent konfigürasyonları (JSON array)
    agents_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Flow tanımları (JSON array)
    flows_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Local repo mapping listesi (JSON array)
    repo_mappings_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Profil ayarlari (JSON object)
    profile_settings_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
