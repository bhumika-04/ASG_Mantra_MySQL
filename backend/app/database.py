"""Database connection and session management (MySQL)."""
import logging
import time

import pymysql
from sqlalchemy import create_engine, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
from .config import settings

logger = logging.getLogger(__name__)

# pymysql error codes meaning the connection itself failed (not a query error);
# a fresh connection can safely be retried for these.
_TRANSIENT_MYSQL_ERRORS = {
    2003,  # Can't connect to MySQL server
    2006,  # MySQL server has gone away
    2013,  # Lost connection to MySQL server during query
    2055,  # Lost connection to MySQL server at '%s', system error: %d
}


def _connect_with_retry(max_attempts: int = 3, base_delay: float = 1.0):
    """Open a new MySQL connection, retrying on transient network failures.

    `pool_pre_ping` only protects connections already in the pool. When the pool
    is empty (e.g. the first request after the app was idle overnight) a firewall
    or load balancer can reset the brand-new connection, so it is retried here
    instead of surfacing as a 500.
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
    """Create any missing tables (the production schema is managed with SQL scripts)."""
    import app.models  # noqa: F401  (importing registers every model with Base)

    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully!")


def test_connection() -> bool:
    """Return True when a trivial query succeeds."""
    try:
        from sqlalchemy import text
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
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
