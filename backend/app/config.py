"""
Configuration management for ASG Mantra Analytics API
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # Database (MySQL)
    MYSQL_HOST: str
    MYSQL_PORT: int = 3306
    MYSQL_DB: str
    MYSQL_USER: str
    MYSQL_PASSWORD: str

    # JWT Configuration
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours — prevents logout during long upload sessions

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://localhost:3001"

    # Application Configuration
    APP_NAME: str = "ASG Mantra Analytics API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    @property
    def database_url(self) -> str:
        """Generate the SQLAlchemy MySQL database URL.

        user and password are URL-quoted: an unescaped @, :, / or # would break
        the URL.
        """
        from urllib.parse import quote_plus
        user = quote_plus(self.MYSQL_USER)
        password = quote_plus(self.MYSQL_PASSWORD)
        return (
            f"mysql+pymysql://{user}:{password}"
            f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DB}?charset=utf8mb4"
        )

    @property
    def allowed_origins_list(self) -> List[str]:
        """Parse CORS origins from comma-separated string"""
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance (the .env file is read once)."""
    return Settings()


# Global settings instance
settings = get_settings()
