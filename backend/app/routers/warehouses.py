"""
Warehouses Router - Warehouse Management
Handles warehouse configuration for Amazon and Blinkit
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
import pandas as pd
import io

from app.database import get_db
from app.models.user import User
from app.models.warehouse import Warehouse
from app.schemas.warehouse import WarehouseCreate, WarehouseUpdate, WarehouseResponse
from app.utils.dependencies import get_current_user

router = APIRouter()


@router.get("", response_model=List[WarehouseResponse])
async def get_all_warehouses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all warehouses across all channels
    """
    warehouses = db.query(Warehouse).filter(
        Warehouse.IsActive == True
    ).order_by(Warehouse.Channel, Warehouse.WarehouseName).all()

    return [wh.to_dict() for wh in warehouses]


@router.get("/amazon", response_model=List[WarehouseResponse])
async def get_amazon_warehouses(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all Amazon warehouses (Fulfillment Centers)
    """
    warehouses = db.query(Warehouse).filter(
        Warehouse.Channel == "Amazon"
    ).order_by(Warehouse.CreatedAt.desc()).all()

    return [wh.to_dict() for wh in warehouses]


@router.get("/blinkit", response_model=List[WarehouseResponse])
async def get_blinkit_warehouses(
    warehouse_type: str = None,  # 'Frontend' or 'Backend' to filter
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get all Blinkit warehouses
    Optional filter by warehouse_type: Frontend (FE) or Backend (BE)
    """
    query = db.query(Warehouse).filter(Warehouse.Channel == "Blinkit")

    if warehouse_type:
        query = query.filter(Warehouse.WarehouseType == warehouse_type)

    warehouses = query.order_by(Warehouse.CreatedAt.desc()).all()

    return [wh.to_dict() for wh in warehouses]


@router.post("")
async def create_warehouse(
    warehouse_data: WarehouseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create a new warehouse (Amazon FC or Blinkit FE/BE)
    Admin only

    For Amazon: Requires fcType (Standard, Sortable, Large, Small)
    For Blinkit: Requires warehouseType (Frontend, Backend)
    """
    # Check permissions
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can create warehouses")

    # Validate Amazon-specific requirements
    if warehouse_data.channel == "Amazon" and not warehouse_data.fcType:
        raise HTTPException(status_code=400, detail="FC Type is required for Amazon warehouses")

    # Validate Blinkit-specific requirements
    if warehouse_data.channel == "Blinkit" and not warehouse_data.warehouseType:
        raise HTTPException(status_code=400, detail="Warehouse Type (Frontend/Backend) is required for Blinkit warehouses")

    # Check if warehouse code already exists
    existing = db.query(Warehouse).filter(
        Warehouse.WarehouseCode == warehouse_data.warehouseCode
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Warehouse code already exists")

    # Create new warehouse
    new_warehouse = Warehouse(
        WarehouseName=warehouse_data.warehouseName,
        WarehouseCode=warehouse_data.warehouseCode,
        Channel=warehouse_data.channel.value,
        Location=warehouse_data.location,
        City=warehouse_data.city,
        State=warehouse_data.state,
        Region=warehouse_data.region.value if warehouse_data.region else None,
        Address=warehouse_data.address,
        Pincode=warehouse_data.pincode,
        FCType=warehouse_data.fcType.value if warehouse_data.fcType else None,
        WarehouseType=warehouse_data.warehouseType.value if warehouse_data.warehouseType else None,
        ContactPerson=warehouse_data.contactPerson,
        ContactPhone=warehouse_data.contactPhone,
        ContactEmail=warehouse_data.contactEmail,
        Capacity=warehouse_data.capacity,
        IsActive=warehouse_data.isActive,
    )

    try:
        db.add(new_warehouse)
        db.commit()
        db.refresh(new_warehouse)

        return {
            "success": True,
            "message": f"{warehouse_data.channel.value} warehouse created successfully",
            "data": new_warehouse.to_dict()
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create warehouse: {str(e)}")


@router.put("/{warehouse_id}")
async def update_warehouse(
    warehouse_id: int,
    warehouse_data: WarehouseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update an existing warehouse
    Admin only
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can update warehouses")

    warehouse = db.query(Warehouse).filter(Warehouse.Id == warehouse_id).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    # Update fields if provided
    if warehouse_data.warehouseName is not None:
        warehouse.WarehouseName = warehouse_data.warehouseName
    if warehouse_data.location is not None:
        warehouse.Location = warehouse_data.location
    if warehouse_data.city is not None:
        warehouse.City = warehouse_data.city
    if warehouse_data.state is not None:
        warehouse.State = warehouse_data.state
    if warehouse_data.region is not None:
        warehouse.Region = warehouse_data.region.value
    if warehouse_data.address is not None:
        warehouse.Address = warehouse_data.address
    if warehouse_data.pincode is not None:
        warehouse.Pincode = warehouse_data.pincode
    if warehouse_data.fcType is not None:
        warehouse.FCType = warehouse_data.fcType.value
    if warehouse_data.warehouseType is not None:
        warehouse.WarehouseType = warehouse_data.warehouseType.value
    if warehouse_data.contactPerson is not None:
        warehouse.ContactPerson = warehouse_data.contactPerson
    if warehouse_data.contactPhone is not None:
        warehouse.ContactPhone = warehouse_data.contactPhone
    if warehouse_data.contactEmail is not None:
        warehouse.ContactEmail = warehouse_data.contactEmail
    if warehouse_data.capacity is not None:
        warehouse.Capacity = warehouse_data.capacity
    if warehouse_data.isActive is not None:
        warehouse.IsActive = warehouse_data.isActive

    try:
        db.commit()
        db.refresh(warehouse)
        return {
            "success": True,
            "message": "Warehouse updated successfully",
            "data": warehouse.to_dict()
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to update warehouse: {str(e)}")


@router.delete("/{warehouse_id}")
async def delete_warehouse(
    warehouse_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Delete a warehouse
    Admin only
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can delete warehouses")

    warehouse = db.query(Warehouse).filter(Warehouse.Id == warehouse_id).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")

    try:
        db.delete(warehouse)
        db.commit()
        return {"success": True, "message": "Warehouse deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete warehouse: {str(e)}")


@router.post("/amazon/upload")
async def upload_amazon_warehouses(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Batch upload Amazon Fulfillment Centers from Excel/CSV
    Expected columns: FC Code, FC Name, City, State, Region, FC Type, Status
    Admin only
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can upload warehouses")

    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(status_code=400, detail="Only Excel (.xlsx, .xls) or CSV files are allowed")

    try:
        contents = await file.read()
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))

        # Normalize column names
        df.columns = df.columns.str.strip()

        # Expected columns
        required_cols = ['FC Code', 'FC Name', 'State']
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(missing_cols)}")

        total_rows = len(df)
        uploaded_warehouses = []
        skipped_warehouses = []
        errors = []

        for idx, row in df.iterrows():
            try:
                fc_code = str(row.get('FC Code', '')).strip()
                fc_name = str(row.get('FC Name', '')).strip()
                state = str(row.get('State', '')).strip()

                if not fc_code or not fc_name or not state:
                    errors.append({
                        'row': idx + 2,
                        'error': 'Missing required fields (FC Code, FC Name, or State)'
                    })
                    continue

                # Check if already exists
                existing = db.query(Warehouse).filter(Warehouse.WarehouseCode == fc_code).first()
                if existing:
                    skipped_warehouses.append({
                        'warehouseCode': fc_code,
                        'warehouseName': fc_name,
                        'reason': 'Already exists in database'
                    })
                    continue

                # Map Status
                status_value = str(row.get('Status', 'Active')).strip().lower()
                is_active = status_value in ['active', 'yes', '1', 'true']

                new_warehouse = Warehouse(
                    WarehouseCode=fc_code,
                    WarehouseName=fc_name,
                    Channel="Amazon",
                    City=str(row.get('City', '')).strip() if pd.notna(row.get('City')) else None,
                    State=state,
                    Region=str(row.get('Region', '')).strip() if pd.notna(row.get('Region')) else None,
                    FCType=str(row.get('FC Type', 'Standard')).strip() if pd.notna(row.get('FC Type')) else 'Standard',
                    IsActive=is_active,
                )

                db.add(new_warehouse)
                uploaded_warehouses.append({
                    'warehouseCode': fc_code,
                    'warehouseName': fc_name,
                    'city': new_warehouse.City,
                    'state': state
                })

            except Exception as e:
                errors.append({
                    'row': idx + 2,
                    'error': str(e)
                })

        db.commit()

        return {
            "success": True,
            "message": f"Upload completed. {len(uploaded_warehouses)} warehouses added, {len(skipped_warehouses)} skipped",
            "summary": {
                "totalRows": total_rows,
                "uploaded": len(uploaded_warehouses),
                "skipped": len(skipped_warehouses),
                "errors": len(errors)
            },
            "uploadedWarehouses": uploaded_warehouses,
            "skippedWarehouses": skipped_warehouses,
            "errors": errors
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@router.post("/blinkit/upload/{warehouse_type}")
async def upload_blinkit_warehouses(
    warehouse_type: str,  # 'Frontend' or 'Backend'
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Batch upload Blinkit warehouses from Excel/CSV
    Expected columns for FE: FE Code, FE Name, City, State, Region, Status
    Expected columns for BE: BE Code, BE Name, City, State, Region, Status
    Admin only
    """
    if current_user.Role != "Admin":
        raise HTTPException(status_code=403, detail="Only admins can upload warehouses")

    if warehouse_type not in ['Frontend', 'Backend']:
        raise HTTPException(status_code=400, detail="Warehouse type must be 'Frontend' or 'Backend'")

    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(status_code=400, detail="Only Excel (.xlsx, .xls) or CSV files are allowed")

    try:
        contents = await file.read()
        if file.filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))

        # Normalize column names
        df.columns = df.columns.str.strip()

        # Expected columns based on type
        prefix = 'FE' if warehouse_type == 'Frontend' else 'BE'
        code_col = f'{prefix} Code'
        name_col = f'{prefix} Name'

        required_cols = [code_col, name_col, 'State']
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"Missing required columns: {', '.join(missing_cols)}")

        total_rows = len(df)
        uploaded_warehouses = []
        skipped_warehouses = []
        errors = []

        for idx, row in df.iterrows():
            try:
                wh_code = str(row.get(code_col, '')).strip()
                wh_name = str(row.get(name_col, '')).strip()
                state = str(row.get('State', '')).strip()

                if not wh_code or not wh_name or not state:
                    errors.append({
                        'row': idx + 2,
                        'error': f'Missing required fields ({code_col}, {name_col}, or State)'
                    })
                    continue

                # Check if already exists
                existing = db.query(Warehouse).filter(Warehouse.WarehouseCode == wh_code).first()
                if existing:
                    skipped_warehouses.append({
                        'warehouseCode': wh_code,
                        'warehouseName': wh_name,
                        'reason': 'Already exists in database'
                    })
                    continue

                # Map Status
                status_value = str(row.get('Status', 'Active')).strip().lower()
                is_active = status_value in ['active', 'yes', '1', 'true']

                new_warehouse = Warehouse(
                    WarehouseCode=wh_code,
                    WarehouseName=wh_name,
                    Channel="Blinkit",
                    WarehouseType=warehouse_type,
                    City=str(row.get('City', '')).strip() if pd.notna(row.get('City')) else None,
                    State=state,
                    Region=str(row.get('Region', '')).strip() if pd.notna(row.get('Region')) else None,
                    IsActive=is_active,
                )

                db.add(new_warehouse)
                uploaded_warehouses.append({
                    'warehouseCode': wh_code,
                    'warehouseName': wh_name,
                    'city': new_warehouse.City,
                    'state': state,
                    'warehouseType': warehouse_type
                })

            except Exception as e:
                errors.append({
                    'row': idx + 2,
                    'error': str(e)
                })

        db.commit()

        return {
            "success": True,
            "message": f"Upload completed. {len(uploaded_warehouses)} {warehouse_type} warehouses added, {len(skipped_warehouses)} skipped",
            "summary": {
                "totalRows": total_rows,
                "uploaded": len(uploaded_warehouses),
                "skipped": len(skipped_warehouses),
                "errors": len(errors)
            },
            "uploadedWarehouses": uploaded_warehouses,
            "skippedWarehouses": skipped_warehouses,
            "errors": errors
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")
