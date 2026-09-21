"""
Database connection and session management — MySQL only.

This project has no Microsoft-product dependency (client requirement): no MSSQL,
no pyodbc, no ODBC Driver. See docs/MYSQL_MIGRATION_BRIEF.md for the migration
that removed the old SQL Server connection.
"""
import logging
import time

import pymysql
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
from .config import settings

logger = logging.getLogger(__name__)

# pymysql error codes that mean "the connection itself is bad" (reset while idle,
# server restarted mid-connection, etc.) rather than a real query/programming
# error — safe to retry a fresh connection for these.
_TRANSIENT_MYSQL_ERRORS = {
    2003,  # Can't connect to MySQL server
    2006,  # MySQL server has gone away
    2013,  # Lost connection to MySQL server during query
    2055,  # Lost connection to MySQL server at '%s', system error: %d
}


def _connect_with_retry(max_attempts: int = 3, base_delay: float = 1.0):
    """Open a fresh physical MySQL connection, retrying on a transient
    network-level failure instead of letting it surface as a 500.

    `pool_pre_ping` (below) only protects a connection that's already sitting
    in the pool — it pings before handing it out, and transparently discards
    it and tries the next one if the ping fails. It cannot help when the pool
    is empty and a brand-new connection has to be made (e.g. the first
    request after the app has been idle overnight): if *that* attempt hits a
    momentary reset from an intermediate firewall/NAT/load balancer, there's
    nothing to fall back to without a retry here. (This was a real recurring
    production issue — "TCP Provider: Error code 0x68 (104)" — before this fix.)
    """
    last_exc = None
    for attempt in range(1, max_attempts + 1):
        try:
            return pymysql.connect(
                host=settings.MYSQL_HOST,
                port=settings.MYSQL_PORT,
                user=settings.MYSQL_USER,
                password=settings.MYSQL_PASSWORD,
                database=settings.MYSQL_DB,
                charset="utf8mb4",
                connect_timeout=10,
            )
        except pymysql.err.OperationalError as exc:
            last_exc = exc
            code = exc.args[0] if exc.args else None
            if code not in _TRANSIENT_MYSQL_ERRORS or attempt == max_attempts:
                raise
            delay = base_delay * attempt
            logger.warning(
                f"DB connection attempt {attempt}/{max_attempts} failed "
                f"({code}: {exc}); retrying in {delay:.1f}s"
            )
            time.sleep(delay)
    raise last_exc  # pragma: no cover — loop always returns or raises above


# Create SQLAlchemy engine
engine = create_engine(
    settings.database_url,
    creator=_connect_with_retry,  # retries a fresh connection on a transient reset — see above
    echo=False,
    pool_pre_ping=True,   # detect dropped connections before handing to request
    pool_size=10,
    max_overflow=20,
    pool_recycle=300,     # proactively refresh connections well under typical firewall/NAT idle-connection timeouts
)
logger.info(f"Database engine: MySQL ({settings.MYSQL_HOST}/{settings.MYSQL_DB})")

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
