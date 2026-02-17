"""
UploadLog Model - SQLAlchemy ORM
Matches SQL table [dbo].[UploadLogs] in Script.sql
Tracks all file uploads (inventory, sales, POs, etc.)
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.mssql import UNIQUEIDENTIFIER
from sqlalchemy.sql import func
from ..database import Base


class UploadLog(Base):
    __tablename__ = "UploadLogs"

    Id = Column(Integer, primary_key=True, autoincrement=True)
    UploadType = Column(String(50), nullable=False, index=True)  # 'Inventory', 'AmazonSales', 'BlinkitSales', 'AmazonPO', 'BlinkitPO', 'EagleStock'
    Channel = Column(String(20), nullable=True, index=True)  # 'Amazon', 'Blinkit', null for inventory
    FileName = Column(String(255), nullable=False)
    FileSize = Column(Integer, nullable=True)  # File size in bytes
    UploadDate = Column(DateTime, default=func.getdate(), index=True)
    ProcessedAt = Column(DateTime, nullable=True)
    Status = Column(String(20), nullable=False, default='Pending')  # 'Pending', 'Processing', 'Success', 'Failed'
    TotalRows = Column(Integer, nullable=True)
    SuccessRows = Column(Integer, nullable=True)
    ErrorRows = Column(Integer, nullable=True)
    Errors = Column(Text, nullable=True)  # JSON string of error messages
    UploadedBy = Column(UNIQUEIDENTIFIER, ForeignKey("Users.Id"), nullable=True, index=True)

    def to_dict(self):
        return {
            "id": self.Id,
            "uploadType": self.UploadType,
            "channel": self.Channel,
            "fileName": self.FileName,
            "fileSize": self.FileSize,
            "uploadDate": self.UploadDate.isoformat() if self.UploadDate else None,
            "processedAt": self.ProcessedAt.isoformat() if self.ProcessedAt else None,
            "status": self.Status,
            "totalRows": self.TotalRows,
            "successRows": self.SuccessRows,
            "errorRows": self.ErrorRows,
            "errors": self.Errors,
            "uploadedBy": str(self.UploadedBy) if self.UploadedBy else None,
        }
