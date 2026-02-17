"""
Role Model - SQLAlchemy ORM
Stores role definitions and permissions
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from ..database import Base


class Role(Base):
    __tablename__ = "Roles"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    Name = Column(String(100), unique=True, nullable=False, index=True)
    Description = Column(String(500), nullable=False)
    Permissions = Column(Text, nullable=False)  # JSON string of permissions array
    IsLocked = Column(Boolean, default=False, index=True)  # System roles cannot be edited/deleted
    CreatedAt = Column(DateTime, default=func.getdate())
    UpdatedAt = Column(DateTime, default=func.getdate(), onupdate=func.getdate())

    def to_dict(self):
        """Convert model to dictionary"""
        import json
        return {
            "id": str(self.Id),
            "name": self.Name,
            "description": self.Description,
            "permissions": json.loads(self.Permissions) if self.Permissions else [],
            "is_locked": self.IsLocked,
            "created_at": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
