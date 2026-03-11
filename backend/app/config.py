"""
Configuration management for ASG Mantra Analytics API
"""
from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # Database Configuration
    DB_SERVER: str
    DB_PORT: int = 1433
    DB_NAME: str
    DB_USER: str
    DB_PASSWORD: str
    DB_DRIVER: str = "ODBC Driver 18 for SQL Server"

    # JWT Configuration
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS Configuration
    ALLOWED_ORIGINS: str = "http://localhost:3000"
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
        """Generate SQLAlchemy database URL"""
        from urllib.parse import quote_plus
        # Use Windows Authentication (Integrated Security) if no user/password provided
        if not self.DB_USER or not self.DB_PASSWORD:
            conn_str = f"DRIVER={{{self.DB_DRIVER}}};SERVER={self.DB_SERVER};DATABASE={self.DB_NAME};Trusted_Connection=yes;TrustServerCertificate=yes"
            return f"mssql+pyodbc:///?odbc_connect={quote_plus(conn_str)}"
        else:
            # Use ODBC connection string format to safely handle special characters
            # in passwords (e.g. @) and MSSQL server notation (IP,port)
            conn_str = f"DRIVER={{{self.DB_DRIVER}}};SERVER={self.DB_SERVER},{self.DB_PORT};DATABASE={self.DB_NAME};UID={self.DB_USER};PWD={self.DB_PASSWORD};TrustServerCertificate=yes"
            return f"mssql+pyodbc:///?odbc_connect={quote_plus(conn_str)}"

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
