"""
Authentication utilities - JWT token handling
"""
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
import logging
import time

from ..config import settings
from ..database import get_db
from ..models.user import User
from ..schemas.user import TokenData

# Per-process user cache: avoids a DB round-trip on every API call.
# Key = raw JWT string; value = (User ORM object, expiry timestamp).
# TTL = 5 min (well below the 8-hour token expiry).
_user_cache: dict = {}
_USER_CACHE_TTL = 300  # seconds

logger = logging.getLogger(__name__)

# Security scheme
security = HTTPBearer()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create JWT access token

    Args:
        data: Data to encode in token (user_id, email, role)
        expires_delta: Token expiration time (default from settings)

    Returns:
        Encoded JWT token
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode.update({"exp": expire, "iat": datetime.utcnow()})

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


_MAX_REFRESH_AGE_SECONDS = 7 * 86400  # tokens older than 7 days cannot be refreshed

def verify_token_ignore_expiry(token: str) -> TokenData:
    """Decode a JWT without checking expiry — for the /refresh endpoint only."""
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"verify_exp": False},
        )
        # Reject tokens that are too old even if signature is valid — prevents
        # perpetual refresh from stale tokens found in logs or storage.
        iat = payload.get("iat")
        if iat is not None and (time.time() - iat) > _MAX_REFRESH_AGE_SECONDS:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token too old to refresh")
        user_id: str = payload.get("user_id")
        email: str = payload.get("email")
        role: str = payload.get("role")
        if not user_id or not email or not role:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing required fields")
        return TokenData(user_id=user_id, email=email, role=role)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def verify_token(token: str) -> TokenData:
    """
    Verify and decode JWT token

    Args:
        token: JWT token string

    Returns:
        TokenData with user information

    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("user_id")
        email: str = payload.get("email")
        role: str = payload.get("role")

        if user_id is None or email is None or role is None:
            logger.error(f"Token missing required fields - user_id: {user_id}, email: {email}, role: {role}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing required fields (user_id, email, or role)",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return TokenData(user_id=user_id, email=email, role=role)

    except JWTError as e:
        error_msg = str(e)
        if "expired" in error_msg.lower():
            logger.warning(f"Token expired - Error: {error_msg}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token has expired",
                headers={"WWW-Authenticate": "Bearer"},
            )
        else:
            logger.error(f"JWT validation error: {error_msg}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or malformed token",
                headers={"WWW-Authenticate": "Bearer"},
            )


def get_current_user_for_refresh(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """Like get_current_user but accepts expired tokens — only for use in /refresh."""
    token = credentials.credentials
    token_data = verify_token_ignore_expiry(token)
    user = db.query(User).filter(User.Id == token_data.user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.IsActive:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account is inactive")
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """
    Get current authenticated user from token.
    Caches the User object per-token for 5 minutes to avoid a DB round-trip
    on every single API call (User.Id is a PK lookup but still adds latency).
    """
    token = credentials.credentials

    # Fast path: serve from cache if not expired
    now = time.time()
    cached = _user_cache.get(token)
    if cached is not None:
        user, exp = cached
        if now < exp:
            # Re-check IsActive and Role so deactivated/demoted accounts are blocked quickly
            row = db.query(User.IsActive, User.Role).filter(User.Id == user.Id).first()
            if not row or not row[0]:
                del _user_cache[token]
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User account is inactive",
                )
            if row[1] != user.Role:
                # Role was changed — evict and fall through to fresh DB lookup
                del _user_cache[token]
            else:
                return user
        _user_cache.pop(token, None)

    token_data = verify_token(token)

    user = db.query(User).filter(User.Id == token_data.user_id).first()

    if user is None:
        logger.error(f"User not found - user_id: {token_data.user_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"User not found (user_id: {token_data.user_id})",
        )

    if not user.IsActive:
        logger.warning(f"Inactive user - user_id: {token_data.user_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is inactive",
        )

    # Evict a handful of stale entries to keep the dict small
    if len(_user_cache) > 50:
        stale = [k for k, (_, e) in _user_cache.items() if e < now]
        for k in stale:
            del _user_cache[k]

    _user_cache[token] = (user, now + _USER_CACHE_TTL)
    return user
