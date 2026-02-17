"""
Audit Log Model - SQLAlchemy ORM
Matches SQL table [dbo].[AuditLogs] in Script.sql
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.sql import func
from ..database import Base


class AuditLog(Base):
    __tablename__ = "AuditLogs"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    UserId = Column(UNIQUEIDENTIFIER, ForeignKey("Users.Id"), nullable=True, index=True)
    Action = Column(String(255), nullable=False, index=True)
    TableName = Column(String(100), nullable=True, index=True)
    RecordId = Column(String(50), nullable=True)
    OldValues = Column(String, nullable=True)
    NewValues = Column(String, nullable=True)
    IpAddress = Column(String(50), nullable=True)
    UserAgent = Column(String(500), nullable=True)
    CreatedAt = Column(DateTime, default=func.getdate(), index=True)

    def to_dict(self):
        return {
            "id": self.Id,
            "userId": str(self.UserId) if self.UserId else None,
            "action": self.Action,
            "tableName": self.TableName,
            "recordId": self.RecordId,
            "createdAt": self.CreatedAt.isoformat() if self.CreatedAt else None,
            "ipAddress": self.IpAddress,
        }
