"""LogosPulse configuration."""

import os


class Settings:
    port: int = 8095
    database_url: str = os.getenv(
        "LOGOS_PULSE_DB_URL",
        "postgresql+asyncpg://logosai:logosai1234@211.180.253.250:5432/logosai",
    )
    log_level: str = os.getenv("LOGOS_PULSE_LOG_LEVEL", "INFO")


settings = Settings()
