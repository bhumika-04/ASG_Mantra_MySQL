"""
Database connection and session management
"""
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
import pyodbc
from .config import settings

# Create SQLAlchemy engine
engine = create_engine(
    settings.database_url,
    echo=False,  # Disable SQL query logging for cleaner output
    pool_pre_ping=True,  # Test connections before using them
    pool_size=10,  # Connection pool size
    max_overflow=20,  # Max connections beyond pool_size
)

# Create SessionLocal class
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create Base class for models
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    Dependency function to get database session
    Usage: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Initialize database - create tables if they don't exist
    Note: In production, use Alembic migrations instead
    """
    # Import all models here to register them with Base
    from .models import (
        user, product, inventory, purchase_order, sales, warehouse,
        alert, notification, audit_log, role,
        amazon_inventory, amazon_sales, amazon_po, amazon_po_item,
        blinkit_inventory, blinkit_sales, blinkit_po, blinkit_po_item,
    )

    # Create all tables
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully!")


def test_connection() -> bool:
    """
    Test database connection
    Returns True if connection is successful
    """
    try:
        from sqlalchemy import text
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1"))
            print("[OK] Database connection successful!")
            return True
    except Exception as e:
        print(f"[ERROR] Database connection failed: {e}")
        return False


# Event listener to handle database connection issues
@event.listens_for(engine, "connect")
def receive_connect(dbapi_conn, connection_record):
    """Event listener for new connections"""
    pass


@event.listens_for(engine, "checkout")
def receive_checkout(dbapi_conn, connection_record, connection_proxy):
    """Event listener for connection checkout from pool"""
    pass
