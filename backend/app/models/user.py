"""
User Model - SQLAlchemy ORM
"""
from sqlalchemy import Column, String, Boolean, DateTime, Enum
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.sql import func
from ..database import Base
import uuid


class User(Base):
    __tablename__ = "Users"

    Id = Column(UNIQUEIDENTIFIER, primary_key=True, default=uuid.uuid4)
    Name = Column(String(255), nullable=False)
    Email = Column(String(255), unique=True, nullable=False, index=True)
    PasswordHash = Column(String(255), nullable=False)
    Role = Column(
        String(50),
        nullable=False,
        index=True,
    )
    Avatar = Column(String(500), nullable=True)
    IsActive = Column(Boolean, default=True, index=True)
    CreatedAt = Column(DateTime, default=func.getdate())
    LastLogin = Column(DateTime, nullable=True)
    CreatedBy = Column(UNIQUEIDENTIFIER, nullable=True)
    UpdatedAt = Column(DateTime, default=func.getdate(), onupdate=func.getdate())

    def to_dict(self):
        """Convert model to dictionary (exclude password)"""
        return {
            "id": str(self.Id),
            "name": self.Name,
            "email": self.Email,
            "role": self.Role,
            "avatar": self.Avatar,
            "isActive": self.IsActive,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
            "lastLogin": self.LastLogin.isoformat() if self.LastLogin else None,
        }
