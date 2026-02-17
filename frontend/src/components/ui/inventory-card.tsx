'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { GripVertical } from 'lucide-react';

interface InventoryCardProps {
  rowNumber: number;
  productName: string;
  asgSku: string;
  amazonId: string;
  blinkitId: string;
  gs1: string;
  packedQty: number;
  unpackedQty: number;
  amazonInv: number;
  blinkitInv: number;
  className?: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

export function InventoryCard({
  rowNumber,
  productName,
  asgSku,
  amazonId,
  blinkitId,
  gs1,
  packedQty,
  unpackedQty,
  amazonInv,
  blinkitInv,
  className,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: InventoryCardProps) {
  return (
    <div
      className={cn(
        'relative bg-card transition-all duration-200 hover:bg-muted/50 group',
        draggable && 'cursor-grab active:cursor-grabbing',
        className
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Drag Handle */}
      {draggable && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-50 transition-opacity">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      )}

      {/* Table-like Grid */}
      <div className="grid grid-cols-12 gap-3 p-3 text-sm items-center">
        {/* Row Number */}
        <div className="col-span-1 text-center">
          <span className="text-muted-foreground font-medium">{rowNumber}</span>
        </div>

        {/* Product Name */}
        <div className="col-span-2">
          <div className="font-medium truncate">{productName}</div>
        </div>

        {/* ASG SKU */}
        <div className="col-span-1">
          <code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">
            {asgSku}
          </code>
        </div>

        {/* Amazon ID */}
        <div className="col-span-1">
          {amazonId ? (
            <code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">
              {amazonId}
            </code>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>

        {/* Blinkit ID */}
        <div className="col-span-1">
          {blinkitId ? (
            <code className="text-xs bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">
              {blinkitId}
            </code>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>

        {/* GS-1 */}
        <div className="col-span-1">
          <span className="text-xs text-muted-foreground">{gs1}</span>
        </div>

        {/* Packed */}
        <div className="col-span-1 text-center">
          <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded font-semibold text-xs border border-emerald-200">
            {packedQty.toLocaleString()}
          </span>
        </div>

        {/* Unpacked */}
        <div className="col-span-1 text-center">
          <span className="bg-orange-50 text-orange-700 px-2 py-1 rounded font-semibold text-xs border border-orange-200">
            {unpackedQty.toLocaleString()}
          </span>
        </div>

        {/* Amazon Inv */}
        <div className="col-span-1 text-center">
          <div className="flex items-center justify-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-orange-500"></div>
            <span className={cn(
              "font-semibold text-xs",
              amazonInv > 0 ? "text-blue-600" : "text-muted-foreground"
            )}>
              {amazonInv.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Blinkit Inv */}
        <div className="col-span-1 text-center">
          <div className="flex items-center justify-center gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-yellow-400"></div>
            <span className={cn(
              "font-semibold text-xs",
              blinkitInv > 0 ? "text-yellow-600" : "text-muted-foreground"
            )}>
              {blinkitInv.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
