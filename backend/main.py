"""
ASG Mantra Analytics API - Main Application
FastAPI backend for multi-platform sales and inventory management
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import time
import logging
import asyncio
from datetime import datetime, timedelta

from app.config import settings
from app.utils.timeutil import now_ist
from app.database import test_connection, init_db
from app.routers import auth, dashboard, inventory, purchase_orders, products, warehouses, users, uploads, notifications, alerts, roles
from app.routers import amazon_data, blinkit_data, distributors, audit_logs, upload_logs

# Configure logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Reduce SQLAlchemy logging verbosity (hide all SQL queries)
logging.getLogger('sqlalchemy.engine').setLevel(logging.ERROR)
logging.getLogger('sqlalchemy.pool').setLevel(logging.ERROR)

# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Multi-platform sales and inventory analytics dashboard API",
    docs_url="/api/docs",  # Swagger UI
    redoc_url="/api/redoc",  # ReDoc
    openapi_url="/api/openapi.json",
    redirect_slashes=False,  # Disable automatic slash redirects (prevents 307)
)

# ===================================
# MIDDLEWARE CONFIGURATION
# ===================================

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_origin_regex=r"http://localhost:\d+",  # any localhost port — no hardcoding
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trusted Host Middleware (security)
# app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])


# Request timing middleware
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    """Add X-Process-Time header to all responses"""
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response


# ===================================
# EXCEPTION HANDLERS
# ===================================


def _cors_headers(request: Request) -> dict:
    """Return CORS headers for error responses so browsers don't double-fault."""
    origin = request.headers.get("origin", "")
    if not origin:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
    }


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "status": "error"},
        headers=_cors_headers(request),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors"""
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body, "status": "error"},
        headers=_cors_headers(request),
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Handle all other exceptions"""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "status": "error"},
        headers=_cors_headers(request),
    )


# ===================================
# STARTUP/SHUTDOWN EVENTS
# ===================================


AUDIT_LOG_RETENTION_DAYS = 60

async def _audit_log_cleanup_loop():
    """Delete audit logs older than AUDIT_LOG_RETENTION_DAYS every 24 hours."""
    from app.database import SessionLocal
    from app.models.audit_log import AuditLog
    while True:
        try:
            db = SessionLocal()
            cutoff = now_ist() - timedelta(days=AUDIT_LOG_RETENTION_DAYS)
            deleted = db.query(AuditLog).filter(AuditLog.CreatedAt < cutoff).delete()
            db.commit()
            db.close()
            if deleted:
                logger.info(f"Audit log cleanup: deleted {deleted} entries older than {AUDIT_LOG_RETENTION_DAYS} days")
        except Exception as e:
            logger.error(f"Audit log cleanup failed: {e}")
        await asyncio.sleep(86400)  # run once every 24 hours


@app.on_event("startup")
async def startup_event():
    """Execute on application startup"""
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"Debug mode: {settings.DEBUG}")

    # Test database connection
    if not test_connection():
        logger.error("Database connection failed! Please check your configuration.")
    else:
        logger.info("Database connection established successfully")

    # Initialize database (create tables if needed)
    # Note: Comment this out in production and use Alembic migrations instead
    if settings.DEBUG:
        try:
            init_db()  # Auto-create tables in debug mode
        except Exception as e:
            logger.error(f"Database initialization failed: {e}")

    # Start background audit log cleanup (runs once at startup, then every 24 h)
    asyncio.create_task(_audit_log_cleanup_loop())


@app.on_event("shutdown")
async def shutdown_event():
    """Execute on application shutdown"""
    logger.info("Shutting down application...")


# ===================================
# ROOT ENDPOINTS
# ===================================


@app.get("/", tags=["Root"])
async def root():
    """Root endpoint - API information"""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/api/docs",
        "redoc": "/api/redoc",
    }


@app.get("/health", tags=["Root"])
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "database": "connected" if test_connection() else "disconnected",
        "version": settings.APP_VERSION,
    }


# ===================================
# API ROUTERS
# ===================================

# Authentication
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])

# Dashboard
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])

# Inventory
app.include_router(inventory.router, prefix="/api/inventory", tags=["Inventory"])

# Purchase Orders
app.include_router(
    purchase_orders.router, prefix="/api/purchase-orders", tags=["Purchase Orders"]
)

# Products
app.include_router(products.router, prefix="/api/products", tags=["Products"])

# Warehouses
app.include_router(warehouses.router, prefix="/api/warehouses", tags=["Warehouses"])

# Users
app.include_router(users.router, prefix="/api/users", tags=["Users"])

# Roles
app.include_router(roles.router, prefix="/api/roles", tags=["Roles"])

# Uploads
app.include_router(uploads.router, prefix="/api/upload", tags=["Uploads"])

# Notifications
app.include_router(
    notifications.router, prefix="/api/notifications", tags=["Notifications"]
)

# Alerts
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])

# Dedicated Data Uploads (new dedicated tables)
app.include_router(
    amazon_data.router, prefix="/api/upload/amazon-data", tags=["Amazon Data Upload"]
)
app.include_router(
    blinkit_data.router, prefix="/api/upload/blinkit-data", tags=["Blinkit Data Upload"]
)

# Distributors, Facilities & ASG Warehouses
app.include_router(
    distributors.router, prefix="/api/distributors", tags=["Distributors"]
)

# Audit Logs (System)
app.include_router(audit_logs.router, prefix="/api/audit-logs", tags=["Audit Logs"])

# Upload Logs (System)
app.include_router(upload_logs.router, prefix="/api/upload-logs", tags=["Upload Logs"])

# ===================================
# RUN APPLICATION
# ===================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info" if not settings.DEBUG else "debug",
    )
