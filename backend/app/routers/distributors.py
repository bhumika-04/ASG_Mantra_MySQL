"""
Distributors Router
CRUD for: Distributors, DistributorFacilities, AsgWarehouses
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models.user import User
from app.models.distributor import Distributor
from app.models.distributor_facility import DistributorFacility
from app.models.asg_warehouse import AsgWarehouse
from app.utils.dependencies import get_current_user

router = APIRouter()


# ============================================================
# DISTRIBUTORS
# ============================================================

@router.get("", include_in_schema=False)
@router.get("/")
async def get_distributors(
    channel: Optional[str] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all distributors (optionally filtered by channel)."""
    query = db.query(Distributor)
    if active_only:
        query = query.filter(Distributor.Active == True)
    if channel:
        query = query.filter(Distributor.Channel == channel)
    items = query.order_by(Distributor.DistributorName).all()
    return {"items": [d.to_dict() for d in items], "total": len(items)}


@router.post("")
@router.post("/")
async def create_distributor(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new distributor."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    record = Distributor(
        DistributorName=data.get("distributorName", "").strip(),
        Channel=data.get("channel", "").strip(),
        ContactPerson=data.get("contactPerson"),
        Phone=data.get("phone"),
        Email=data.get("email"),
        Active=data.get("active", True),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"success": True, "item": record.to_dict()}


@router.put("/{distributor_id}")
async def update_distributor(
    distributor_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a distributor."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    record = db.query(Distributor).filter(Distributor.Id == distributor_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Distributor not found")

    if "distributorName" in data:
        record.DistributorName = data["distributorName"]
    if "channel" in data:
        record.Channel = data["channel"]
    if "contactPerson" in data:
        record.ContactPerson = data["contactPerson"]
    if "phone" in data:
        record.Phone = data["phone"]
    if "email" in data:
        record.Email = data["email"]
    if "active" in data:
        record.Active = data["active"]

    db.commit()
    db.refresh(record)
    return {"success": True, "item": record.to_dict()}


@router.delete("/{distributor_id}")
async def delete_distributor(
    distributor_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Soft-delete a distributor (set active=False)."""
    if current_user.Role != 'Admin':
        raise HTTPException(status_code=403, detail="Admin role required")

    record = db.query(Distributor).filter(Distributor.Id == distributor_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Distributor not found")

    record.Active = False
    db.commit()
    return {"success": True, "message": f"Distributor '{record.DistributorName}' deactivated"}


# ============================================================
# DISTRIBUTOR FACILITIES (Eagle BE/FE facilities)
# ============================================================

@router.get("/facilities")
async def get_facilities(
    distributor_id: Optional[int] = Query(None),
    facility_type: Optional[str] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List distributor facilities (optionally filtered)."""
    query = db.query(DistributorFacility)
    if active_only:
        query = query.filter(DistributorFacility.Active == True)
    if distributor_id:
        query = query.filter(DistributorFacility.DistributorId == distributor_id)
    if facility_type:
        query = query.filter(DistributorFacility.FacilityType == facility_type)
    items = query.order_by(DistributorFacility.FacilityName).all()
    return {"items": [f.to_dict() for f in items], "total": len(items)}


@router.post("/facilities")
async def create_facility(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new distributor facility."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    record = DistributorFacility(
        DistributorId=data.get("distributorId"),
        FacilityName=data.get("facilityName", "").strip(),
        FacilityType=data.get("facilityType", "Backend"),
        City=data.get("city"),
        State=data.get("state"),
        Active=data.get("active", True),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"success": True, "item": record.to_dict()}


@router.put("/facilities/{facility_id}")
async def update_facility(
    facility_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a distributor facility."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    record = db.query(DistributorFacility).filter(DistributorFacility.Id == facility_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Facility not found")

    for field, col in [("facilityName", "FacilityName"), ("facilityType", "FacilityType"),
                       ("city", "City"), ("state", "State"), ("active", "Active")]:
        if field in data:
            setattr(record, col, data[field])

    db.commit()
    db.refresh(record)
    return {"success": True, "item": record.to_dict()}


@router.delete("/facilities/{facility_id}")
async def delete_facility(
    facility_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Soft-delete a facility."""
    if current_user.Role != 'Admin':
        raise HTTPException(status_code=403, detail="Admin role required")

    record = db.query(DistributorFacility).filter(DistributorFacility.Id == facility_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Facility not found")

    record.Active = False
    db.commit()
    return {"success": True, "message": f"Facility '{record.FacilityName}' deactivated"}


# ============================================================
# ASG WAREHOUSES
# ============================================================

@router.get("/asg-warehouses")
async def get_asg_warehouses(
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List ASG internal warehouses."""
    query = db.query(AsgWarehouse)
    if active_only:
        query = query.filter(AsgWarehouse.Active == True)
    items = query.order_by(AsgWarehouse.WarehouseName).all()
    return {"items": [w.to_dict() for w in items], "total": len(items)}


@router.post("/asg-warehouses")
async def create_asg_warehouse(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new ASG warehouse."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    record = AsgWarehouse(
        WarehouseName=data.get("warehouseName", "").strip(),
        City=data.get("city"),
        State=data.get("state"),
        Active=data.get("active", True),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"success": True, "item": record.to_dict()}


@router.put("/asg-warehouses/{warehouse_id}")
async def update_asg_warehouse(
    warehouse_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update an ASG warehouse."""
    if current_user.Role not in ['Admin', 'Manager']:
        raise HTTPException(status_code=403, detail="Admin or Manager role required")

    record = db.query(AsgWarehouse).filter(AsgWarehouse.Id == warehouse_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    for field, col in [("warehouseName", "WarehouseName"), ("city", "City"),
                       ("state", "State"), ("active", "Active")]:
        if field in data:
            setattr(record, col, data[field])

    db.commit()
    db.refresh(record)
    return {"success": True, "item": record.to_dict()}


@router.delete("/asg-warehouses/{warehouse_id}")
async def delete_asg_warehouse(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Soft-delete an ASG warehouse."""
    if current_user.Role != 'Admin':
        raise HTTPException(status_code=403, detail="Admin role required")

    record = db.query(AsgWarehouse).filter(AsgWarehouse.Id == warehouse_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    record.Active = False
    db.commit()
    return {"success": True, "message": f"Warehouse '{record.WarehouseName}' deactivated"}
