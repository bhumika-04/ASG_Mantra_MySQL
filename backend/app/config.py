"""
Configuration management for ASG Mantra Analytics API
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # Database Configuration — MySQL only. No Microsoft products in this project
    # (client requirement) — see docs/MYSQL_MIGRATION_BRIEF.md for the migration
    # off MSSQL/pyodbc.
    MYSQL_HOST: str
    MYSQL_PORT: int = 3306
    MYSQL_DB: str
    MYSQL_USER: str
    MYSQL_PASSWORD: str

    # JWT Configuration
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 hours — prevents logout during long upload sessions
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS Configuration
    ALLOWED_ORIGINS: str = "http://localhost:3000,http://localhost:3001"
    CORS_ALLOW_CREDENTIALS: bool = True

    # Application Configuration
    APP_NAME: str = "ASG Mantra Analytics API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # File Upload Configuration
    MAX_FILE_SIZE_MB: int = 10
    ALLOWED_FILE_EXTENSIONS: str = ".xlsx,.xls,.csv"
    UPLOAD_DIR: str = "./uploads"

    # Email Configuration (optional)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@asgmantra.com"

    @property
    def database_url(self) -> str:
        """Generate the SQLAlchemy MySQL database URL.

        quote_plus is required on user/password — an unescaped @, :, / or #
        in either breaks the URL's own parsing (bit a migration script once
        already; see docs/MYSQL_MIGRATION_BRIEF.md).
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

    @property
    def allowed_extensions_list(self) -> List[str]:
        """Parse allowed file extensions"""
        return [ext.strip() for ext in self.ALLOWED_FILE_EXTENSIONS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance
    Using lru_cache to avoid reading .env file on every request
    """
    return Settings()


# Global settings instance
settings = get_settings()
