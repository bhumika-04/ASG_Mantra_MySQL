"""
Notification Model - SQLAlchemy ORM
Matches SQL table [dbo].[Notifications] in Script.sql
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.sql import func
from ..database import Base


class Notification(Base):
    __tablename__ = "Notifications"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    UserId = Column(UNIQUEIDENTIFIER, ForeignKey("Users.Id"), nullable=False, index=True)
    Title = Column(String(255), nullable=False)
    Message = Column(String, nullable=False)
    Type = Column(String(50), nullable=False, index=True)
    IsRead = Column(Boolean, default=False, index=True)
    CreatedAt = Column(DateTime, default=func.getdate())

    def to_dict(self):
        return {
            "id": self.Id,
            "userId": str(self.UserId),
            "type": self.Type,
            "title": self.Title,
            "message": self.Message,
            "isRead": self.IsRead,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
        }
